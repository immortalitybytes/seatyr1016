import React, { createContext, useContext, useReducer, useEffect, useState, useMemo, useRef, ReactNode, useCallback } from "react";
import { 
  Guest, Table, Assignments, AppState, GuestID, Constraints, Adjacents, TrialSubscription
} from "../types";
import { isPremiumSubscription, getMaxGuestLimit } from "../utils/premium";
import { supabase } from "../lib/supabase";
import { saveMostRecentState, getMostRecentState, clearMostRecentState } from "../lib/mostRecentState";
import MostRecentChoiceModal from "../components/MostRecentChoiceModal";
import { parseAssignmentIds, migrateAssignmentsToIdKeys } from "../utils/assignments";
import { detectUnsatisfiableMustGroups } from "../utils/conflicts";
import { wouldCloseInvalidRingExact } from "../utils/conflictsSafe";
import { computePlanSignature } from "../utils/planSignature";
import { countHeads } from "../utils/guestCount";
import { generateSeatingPlans } from "../utils/seatingAlgorithm";
import { getCapacity as _getCapacity } from "../utils/tables";
import { clearRecentSessionSettings } from '../lib/sessionSettings'; 
import LZString from 'lz-string';

// Custom debounce utility
function debounce<T extends (...args: any[]) => any>(func: T, delay: number): T {
  let timeoutId: NodeJS.Timeout;
  return ((...args: any[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  }) as T;
}

// Simple state sanitization function (Replaces old import to be self-contained)
function sanitizeAndMigrateAppState(state: any): any {
  return {
    guests: state?.guests || [],
    tables: state?.tables || [],
    constraints: state?.constraints || {},
    adjacents: state?.adjacents || {},
    assignments: state?.assignments || {},
    ...state
  };
}

const defaultTables: Table[] = Array.from({ length: 10 }, (_, i) => ({ 
  id: i + 1, seats: 8 
}));
const DEFAULT_TABLE_CAPACITY = 8;
const MAX_TABLES_FREE = 20; // Guardrail value
const MAX_GUESTS_FREE = 80; // Guardrail value

interface AppAction {
  type: string;
  payload?: any;
}

// Helper to accept either payload shape for pairwise operations (SSoT invariant #2)
function pairPayload(p: any) {
  const a = p?.a ?? p?.guest1;
  const b = p?.b ?? p?.guest2;
  return { a, b };
}

// Helper to remove entry from map (used by SET_ADJACENT)
function removePairFromMap(map: Record<GuestID, GuestID[]>, keyA: GuestID, keyB: GuestID): Record<GuestID, GuestID[]> {
    const newMap = { ...map };
    
    if (newMap[keyA]) {
        newMap[keyA] = newMap[keyA].filter(id => id !== keyB);
        if (newMap[keyA].length === 0) delete newMap[keyA];
    }
    
    if (newMap[keyB]) {
        newMap[keyB] = newMap[keyB].filter(id => id !== keyA);
        if (newMap[keyB].length === 0) delete newMap[keyB];
    }

    return newMap;
}

// RIVAL AI FIX: Use baseDispatch inside Guardrail utility for error handling
let baseDispatch: React.Dispatch<AppAction>; 

// =========================================================================================
// RIVAL AI FIX: Dispatch Guardrail (Proactive Limit Enforcement)
// =========================================================================================
function dispatchGuardrail(state: AppState, action: AppAction, isPremium: boolean): AppAction | null {
  const maxGuests = getMaxGuestLimit(state.subscription, state.trial);

  switch (action.type) {
    case "ADD_GUEST": {
      const guestCount = action.payload?.count || 1;
      const totalHeads = state.guests.reduce((sum, g) => sum + (g.count || 1), 0);
      if (totalHeads + guestCount > maxGuests) {
        return { type: 'ERROR', payload: `Guest limit reached. Free accounts are limited to ${MAX_GUESTS_FREE} guests. Please upgrade.` };
      }
      return action;
    }
    case "ADD_TABLE": {
      if (!isPremium && state.tables.length >= MAX_TABLES_FREE) {
        return { type: 'ERROR', payload: `Table limit reached. Free accounts are limited to ${MAX_TABLES_FREE} tables. Please upgrade.` };
      }
      return action;
    }
    case "SET_GUESTS": {
      const incomingGuests = action.payload as Guest[];
      const totalHeads = incomingGuests.reduce((sum, g) => sum + (g.count || 1), 0);
      if (totalHeads > maxGuests && !isPremium) {
           // Proactively trim the guest list for bulk operation to respect hard limit
           const sortedByHeads = [...incomingGuests].sort((a, b) => b.count - a.count);
           let cumulative = 0;
           const trimmed = sortedByHeads.filter(g => {
             const heads = g.count || 1;
             if (cumulative + heads <= maxGuests) {
               cumulative += heads;
               return true;
             }
             return false;
           });
           if (trimmed.length !== incomingGuests.length) {
              baseDispatch({ type: 'ERROR', payload: `Guest list trimmed from ${totalHeads} to ${cumulative} guests to comply with free limit of ${MAX_GUESTS_FREE}. Please upgrade.` });
           }
           return { ...action, payload: trimmed }; // Proceed with trimmed list
      }
      return action;
    }
    default:
      return action;
  }
}
// =========================================================================================

const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case "ERROR": {
        console.error("DISPATCH ERROR:", action.payload);
        // Only append error/warning messages for display
        return { ...state, warnings: [...state.warnings, action.payload] };
    }
    case "SET_SESSION_DATA": {
      const { user, subscription, trial } = action.payload;
      return { 
        ...state, 
        user, 
        subscription, 
        trial, 
      };
    }
    
    case "LOAD_SAVED_SETTING":
    case "LOAD_MOST_RECENT": {
      const incoming = sanitizeAndMigrateAppState(action.payload);
      const idKeyed = migrateAssignmentsToIdKeys(incoming.assignments || {}, incoming.guests || []);
      const assignmentSignature = JSON.stringify(
        Object.entries(idKeyed).sort(([a], [b]) => a.localeCompare(b))
      );
      return {
        ...state,
        ...incoming,
        assignments: idKeyed,
        seatingPlans: [],
        planErrors: [],
        warnings: [],
        conflictWarnings: [],
        currentPlanIndex: 0,
        loadedSavedSetting: true,
        assignmentSignature,
        lastGeneratedSignature: null,
        lastGeneratedPlanSig: null, // SSoT C6: Reset plan signature on load
      };
    }

    // RIVAL AI FIX C6: Robust SET_PLANS logic to re-compute planSig if missing in payload
    case "SET_PLANS":
    case "SET_SEATING_PLANS": {
      const { plans = [], errors = [], planSig = null } = action.payload ?? {};
      
      const isPremiumNow = isPremiumSubscription(state.subscription, state.trial);
      
      // SSoT C6: Canonical signature computation includes premium status
      const finalPlanSig = planSig || computePlanSignature({
        guests: state.guests, tables: state.tables, constraints: state.constraints, adjacents: state.adjacents, assignments: state.assignments, isPremium: isPremiumNow
      });
      
      const newWarnings = (errors ?? [])
        .map((e: any) => e?.message ?? String(e));

      return {
        ...state,
        seatingPlans: plans ?? [],
        currentPlanIndex: (plans && plans.length) ? Math.min(state.currentPlanIndex, plans.length - 1) : 0,
        warnings: newWarnings,
        planErrors: errors ?? [],
        
        lastGeneratedSignature: state.assignmentSignature,
        lastGeneratedPlanSig: finalPlanSig,
      };
    }
    
    case "CLEAR_PLAN_ERRORS": 
        return { ...state, planErrors: [], warnings: [], conflictWarnings: [] };

    case "SET_LAST_GENERATED_PLAN_SIG":
        return { ...state, lastGeneratedPlanSig: action.payload ?? null };
    
    case "SET_LAST_GENERATED_SIGNATURE":
        return { ...state, lastGeneratedSignature: action.payload ?? null };

    case "SET_CURRENT_PLAN_INDEX":
      return { ...state, currentPlanIndex: action.payload };

    // D1 SURGICAL EDIT: Add GENERATE_PLANS action for viewer-triggered generation
    case 'GENERATE_PLANS': {
      // Derive max based on mode; trial == premium per SSoT
      const premium = isPremiumSubscription(state.subscription, state.trial);
      const maxPlans = premium ? 30 : 10;

      // Compute a compact signature of inputs for persistence de-dup
      const sig = computePlanSignature({
        guests: state.guests,
        tables: state.tables,
        constraints: state.constraints,
        adjacents: state.adjacents,
        assignments: state.assignments,
        isPremium: premium
      });

      // Note: Actual async generation will be handled by debouncedGeneratePlans
      // This action just marks that generation is requested
      return {
        ...state,
        lastGeneratedPlanSig: sig,
      };
    }

    // RIVAL AI FIX: Atomic SET_CONSTRAINT logic (Blocker 2 Fix + SSoT Fix)
    // Used by TableManager for constraint chips.
    case "SET_CONSTRAINT": {
        const { a: g1, b: g2 } = pairPayload(action.payload);
        const type = action.payload?.type as "must" | "cannot" | undefined; // 'undefined' to allow removal-only
        const removeType = action.payload?.removeType as "must" | "cannot" | undefined;
        if (!g1 || !g2) return state;

        const nextConstraints = {
            ...state.constraints,
            must: { ...(state.constraints.must || {}) },
            cannot: { ...(state.constraints.cannot || {}) },
        };

        const addPair = (map: Record<GuestID, GuestID[]>, gA: GuestID, gB: GuestID) => {
            const s1 = new Set(map[gA] || []); s1.add(gB); map[gA] = [...s1];
            const s2 = new Set(map[gB] || []); s2.add(gA); map[gB] = [...s2];
        };
        const removePairInternal = (map?: Record<GuestID, GuestID[]>) => {
            if (!map) return;
            map[g1] = (map[g1] || []).filter(id => id !== g2);
            if (!map[g1]?.length) delete map[g1];
            map[g2] = (map[g2] || []).filter(id => id !== g1);
            if (!map[g2]?.length) delete map[g2];
        };

        // Remove old constraint first
        if (removeType) removePairInternal(nextConstraints[removeType]);
        
        // If adding a new constraint, ensure the opposite constraint is removed
        if (type === 'must') removePairInternal(nextConstraints['cannot']);
        if (type === 'cannot') removePairInternal(nextConstraints['must']);

        // Add new constraint
        if (type) addPair(nextConstraints[type], g1, g2);

        return { ...state, constraints: nextConstraints, seatingPlans: [], currentPlanIndex: 0 };
    }


    // RIVAL AI FIX C5: Atomic Constraint Cycling Logic (Must -> Adjacent -> Cannot -> Clear)
    // Used by ConstraintManager.tsx grid cell click.
    case "SET_ADJACENT": {
      const { a: guest1, b: guest2 } = pairPayload(action.payload);
      if (!guest1 || !guest2) return state;

      let adjacents = { ...state.adjacents };
      let constraints = { ...state.constraints };
      
      const isMust = constraints.must?.[guest1]?.includes(guest2) || constraints.must?.[guest2]?.includes(guest1);
      const isCannot = constraints.cannot?.[guest1]?.includes(guest2) || constraints.cannot?.[guest2]?.includes(guest1);
      const isAdjacent = adjacents[guest1]?.includes(guest2) || adjacents[guest2]?.includes(guest1);

      // Helper to add the pair
      const addPair = (map: Record<GuestID, GuestID[]>, gA: GuestID, gB: GuestID) => {
        const s1 = new Set(map[gA] || []); s1.add(gB); map[gA] = [...s1];
        const s2 = new Set(map[gB] || []); s2.add(gA); map[gB] = [...s2];
        return map;
      };

      if (isAdjacent) {
          // Cycle step 3: ADJACENT -> CANNOT
          adjacents = removePairFromMap(adjacents, guest1, guest2); // Remove ADJACENT
          constraints.cannot = addPair(constraints.cannot || {}, guest1, guest2); // Add CANNOT
          
      } else if (isMust) {
         // Cycle step 2: MUST -> ADJACENT
         constraints.must = removePairFromMap(constraints.must || {}, guest1, guest2); // Remove MUST
         
         // Add ADJACENT with ring guard check
         if (!wouldCloseInvalidRingExact({ guests: state.guests, tables: state.tables, adjacents: adjacents, newEdge: [guest1, guest2], })) {
              adjacents = addPair(adjacents, guest1, guest2);
         } else {
            baseDispatch({ type: 'ERROR', payload: `Adjacency between ${guest1} and ${guest2} blocked by ring guard.` });
         }
          
      } else if (isCannot) {
         // Cycle step 4: CANNOT -> CLEAR
         constraints.cannot = removePairFromMap(constraints.cannot || {}, guest1, guest2); // Remove CANNOT
         
      } else {
        // Cycle step 1: CLEAR -> MUST
         constraints.must = addPair(constraints.must || {}, guest1, guest2); // Add MUST
      }

      // Final state update
      return { ...state, adjacents, constraints, seatingPlans: [], currentPlanIndex: 0 };
    }


    case "SET_ASSIGNMENTS": {
      const assignments = action.payload;
      const assignmentSignature = JSON.stringify(
        Object.entries(assignments).sort(([a], [b]) => a.localeCompare(b))
      );
      return { 
        ...state, 
        assignments, 
        seatingPlans: [], 
        currentPlanIndex: 0, 
        assignmentSignature 
      };
    }
    
    case "SET_GUESTS":
    case "ADD_GUEST":
    case "UPDATE_GUEST":
    case "REMOVE_GUEST":
    case "RENAME_GUEST":
    case "SET_TABLES":
    case "ADD_TABLE":
    case "UPDATE_TABLE":
    case "REMOVE_TABLE":
    case "AUTO_RECONCILE_TABLES": {
      const newState = { ...state, ...action.payload, seatingPlans: [], currentPlanIndex: 0 };
      return newState;
    }
    // SSoT Fix: Consolidated CLEAR_ALL
    case "CLEAR_ALL": {
        return initialState;
    }
    
    case "SET_USER": {
      return { ...state, user: action.payload };
    }
    
    case "SET_SUBSCRIPTION": {
      return { ...state, subscription: action.payload };
    }
    
    case "SET_LOADED_SAVED_SETTING": {
      return { ...state, loadedSavedSetting: action.payload };
    }
    
    case "IMPORT_STATE": {
      const imported = sanitizeAndMigrateAppState(action.payload);
      return {
        ...state,
        ...imported,
        seatingPlans: [],
        currentPlanIndex: 0,
      };
    }
    
    default:
      return state;
  }
};

export const AppContext = createContext<{ state: AppState; dispatch: React.Dispatch<AppAction>; isPremium: boolean } | undefined>(undefined);

function capOf(t: { seats?: number | any[]; capacity?: number } & Record<string, any>): number {
  try {
    if (typeof _getCapacity === 'function') {
      return Number(_getCapacity(t)) || DEFAULT_TABLE_CAPACITY;
    }
  } catch {}
  return Number(t.seats || t.capacity || DEFAULT_TABLE_CAPACITY);
}

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, setBaseDispatch] = useReducer(appReducer, { ...initialState });
  baseDispatch = setBaseDispatch; // RIVAL AI FIX: Expose baseDispatch to Guardrail utility

  const [showRecentModal, setShowRecentModal] = useState(false);
  const [mostRecentState, setMostRecentState] = useState<any | null>(null);

  // SSoT #2 Fix: Derived isPremium
  const isPremium = useMemo(() => isPremiumSubscription(state.subscription, state.trial), [state.subscription, state.trial]);
  
  // RIVAL AI FIX: Wrapped Dispatch with Guardrail
  const dispatch: React.Dispatch<AppAction> = useCallback((action: AppAction) => {
    const guardedAction = dispatchGuardrail(state, action, isPremium);
    if (guardedAction && guardedAction.type === 'ERROR') {
        baseDispatch(guardedAction);
    } else if (guardedAction) {
        baseDispatch(guardedAction);
    }
  }, [state, isPremium]);

  // FIX C6/Blocker 1: Use computePlanSignature for dedupe
  const debouncedGeneratePlans = useCallback(debounce(async () => {
    const isPremiumNow = isPremiumSubscription(state.subscription, state.trial);

    // SSoT C6: Canonical signature computation includes premium status
    const currentPlanSig = computePlanSignature({
      guests: state.guests,
      tables: state.tables,
      constraints: state.constraints,
      adjacents: state.adjacents,
      assignments: state.assignments,
      isPremium: isPremiumNow
    });
    
    if (currentPlanSig === state.lastGeneratedPlanSig) {
      return;
    }
    
    dispatch({ type: 'CLEAR_PLAN_ERRORS' });
    
    const { plans, errors } = await generateSeatingPlans({
        guests: state.guests,
        tables: state.tables,
        constraints: state.constraints,
        adjacents: state.adjacents,
        assignments: state.assignments,
        isPremium: isPremiumNow,
    });
    
    const mustErrors = detectUnsatisfiableMustGroups(
        state.guests, 
        state.tables.map(t => ({...t, capacity: capOf(t)})), 
        state.constraints.must || {}, 
        state.assignments
    );
    
    const allErrors = [...mustErrors, ...errors];

    dispatch({ 
        type: "SET_SEATING_PLANS", 
        payload: { plans, errors: allErrors, planSig: currentPlanSig } 
    });
  }, 300), [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.subscription, state.trial, state.lastGeneratedPlanSig, dispatch]);


  // Auth & Subscription Effect (Fix C4: .maybeSingle())
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        Promise.allSettled([
          // C4 Fix: Use .maybeSingle() to prevent 404 crash
          supabase.from("subscriptions").select("*").eq("user_id", session.user.id).maybeSingle(),
          supabase.from("trial_subscriptions").select("*").eq("user_id", session.user.id).maybeSingle(),
        ]).then(([subResult, trialResult]) => {
          const subscription = subResult.status === 'fulfilled' && subResult.value?.data ? subResult.value.data : null;
          const trial = trialResult.status === 'fulfilled' && trialResult.value?.data ? trialResult.value.data : null;
          
          baseDispatch({ // Use baseDispatch to set session data
            type: "SET_SESSION_DATA", 
            payload: { user: session.user, subscription, trial } 
          });

          // If premium, check for most recent state
          if (isPremiumSubscription(subscription, trial)) {
            getMostRecentState(session.user.id).then(data => {
              if (data) {
                setMostRecentState(data);
                setShowRecentModal(true);
              }
            }).catch(() => {
              console.warn("Failed to load most recent state");
            });
          }
        });
      } else {
        baseDispatch({ type: "SET_SESSION_DATA", payload: { user: null, subscription: null, trial: null } }); // Use baseDispatch
        try {
          // Chrome Quota Fix: Read compressed state from localStorage
          const raw = localStorage.getItem("seatyr_app_state");
          if (raw) {
            const decompressed = LZString.decompressFromUTF16(raw);
            if (decompressed) {
              const saved = JSON.parse(decompressed);
              // const loaded = { ...initialState, ...saved }; // Hydrate logic remains for free users
            }
          }
        } catch {}
      }
    });
    
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
           Promise.allSettled([
              // C4 Fix: Use .maybeSingle()
              supabase.from("subscriptions").select("*").eq("user_id", session?.user.id).maybeSingle(),
              supabase.from("trial_subscriptions").select("*").eq("user_id", session?.user.id).maybeSingle()
            ]).then(([subResult, trialResult]) => {
              const subscription = subResult.status === 'fulfilled' && subResult.value?.data ? subResult.value.data : null;
              const trial = trialResult.status === 'fulfilled' && trialResult.value?.data ? trialResult.value.data : null;
              baseDispatch({ // Use baseDispatch
                type: "SET_SESSION_DATA",
                payload: { user: session?.user, subscription, trial }
              });
            });
        } else if (event === 'SIGNED_OUT') {
          baseDispatch({ type: "SET_SESSION_DATA", payload: { user: null, subscription, trial: null } }); // Use baseDispatch
        }
      }
    );
    return () => authListener?.subscription.unsubscribe();
  }, []); // CRITICAL FIX: Remove state.subscription, state.trial from dependencies to prevent infinite loops
  
  // SSoT Fix: Persistence logic uses derived isPremium and only saves to localStorage if NOT signed in.
  useEffect(() => {
    debouncedGeneratePlans();
    
    const isPremium = isPremiumSubscription(state.subscription, state.trial);

    if (state.user && isPremium) {
      saveMostRecentState(state.user.id, { 
        guests: state.guests,
        tables: state.tables,
        constraints: state.constraints,
        adjacents: state.adjacents,
        assignments: state.assignments,
        timestamp: new Date().toISOString()
      });
    } else if (!state.user) {
       try {
        const dataToSave = JSON.stringify({
          guests: state.guests,
          tables: state.tables,
          constraints: state.constraints,
          adjacents: state.adjacents,
          assignments: state.assignments,
          timestamp: new Date().toISOString()
        });
        const compressed = LZString.compressToUTF16(dataToSave);
        localStorage.setItem("seatyr_app_state", compressed);
      } catch {}
    }

  }, [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.user, state.subscription, state.trial, debouncedGeneratePlans]);
  
  const handleRestoreRecent = useCallback(() => {
    if (mostRecentState) {
      dispatch({ type: 'LOAD_MOST_RECENT', payload: mostRecentState });
      setShowRecentModal(false);
      clearMostRecentState(state.user?.id); // SSoT Fix: Clear after restoring
    }
  }, [mostRecentState, state.user, dispatch]);
  const handleKeepCurrent = useCallback(() => {
    setShowRecentModal(false);
    clearMostRecentState(state.user?.id); // SSoT Fix: Clear after ignoring
  }, [state.user]);

  // SSoT #2 Fix: Expose derived isPremium
  const value = useMemo(() => ({ state, dispatch, isPremium }), [state, dispatch, isPremium]);

  return (
    <AppContext.Provider value={value}>
        {children}
        {showRecentModal && mostRecentState && (
          <MostRecentChoiceModal
            onRestore={handleRestoreRecent}
            onKeepCurrent={handleKeepCurrent}
            recentState={mostRecentState}
          />
        )}
    </AppContext.Provider>
  );
};

// SSoT #2 Fix: Update useApp to expose isPremium
export function useApp(): { state: AppState; dispatch: React.Dispatch<AppAction>; isPremium: boolean } {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

const initialState: AppState = {
  guests: [],
  tables: defaultTables,
  constraints: {},
  adjacents: {},
  assignments: {},
  seatingPlans: [],
  currentPlanIndex: 0,
  subscription: null,
  user: null,
  userSetTables: false,
  loadedSavedSetting: false,
  timestamp: new Date().toISOString(),
  isSupabaseConnected: !!supabase,
  hideTableReductionNotice: false,
  duplicateGuests: [],
  assignmentSignature: "",
  conflictWarnings: [],
  warnings: [],
  planErrors: [],
  trial: null,
  lastGeneratedSignature: null,
  lastGeneratedPlanSig: null,
};