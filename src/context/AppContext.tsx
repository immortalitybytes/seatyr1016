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

// Simple state sanitization function
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
const MAX_TABLES_FREE = 20;
const MAX_GUESTS_FREE = 80;

interface AppAction {
  type: string;
  payload?: any;
}

function pairPayload(p: any) {
  const a = p?.a ?? p?.guest1;
  const b = p?.b ?? p?.guest2;
  return { a, b };
}

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

let baseDispatch: React.Dispatch<AppAction>; 

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
           return { ...action, payload: trimmed };
      }
      return action;
    }
    default:
      return action;
  }
}

const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case "ERROR": {
        console.error("DISPATCH ERROR:", action.payload);
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
        lastGeneratedPlanSig: null,
      };
    }

    case "SET_PLANS":
    case "SET_SEATING_PLANS": {
      const { plans = [], errors = [], planSig = null } = action.payload ?? {};
      
      const isPremiumNow = isPremiumSubscription(state.subscription, state.trial);
      
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

    // SURGICAL TASK 1: GENERATE_PLANS triggers async generation via flag
    case 'GENERATE_PLANS': {
      const premium = isPremiumSubscription(state.subscription, state.trial);
      const sig = computePlanSignature({
        guests: state.guests,
        tables: state.tables,
        constraints: state.constraints,
        adjacents: state.adjacents,
        assignments: state.assignments,
        isPremium: premium
      });
      
      // Set flag to trigger async generation in useEffect
      return {
        ...state,
        lastGeneratedPlanSig: sig,
        planErrors: [],
        warnings: [],
        // Flag that generation was requested
        _generateRequested: true
      };
    }

    // SURGICAL TASK 3: CYCLE_CONSTRAINT - Atomic 4-state cycle
    case 'CYCLE_CONSTRAINT': {
      const { a, b, force } = action.payload;
      if (!a || !b || a === b) return state;
      
      const isPrem = isPremiumSubscription(state.subscription, state.trial);
      
      const constraints: Constraints = {
        ...state.constraints,
        must: { ...(state.constraints.must || {}) },
        cannot: { ...(state.constraints.cannot || {}) }
      };
      const adjacents: Adjacents = { ...state.adjacents };

      // Clear any existing relationship first
      if (constraints.must?.[a]?.[b]) {
        delete constraints.must[a][b];
        if (Object.keys(constraints.must[a]).length === 0) delete constraints.must[a];
      }
      if (constraints.must?.[b]?.[a]) {
        delete constraints.must[b][a];
        if (Object.keys(constraints.must[b]).length === 0) delete constraints.must[b];
      }
      if (constraints.cannot?.[a]?.[b]) {
        delete constraints.cannot[a][b];
        if (Object.keys(constraints.cannot[a]).length === 0) delete constraints.cannot[a];
      }
      if (constraints.cannot?.[b]?.[a]) {
        delete constraints.cannot[b][a];
        if (Object.keys(constraints.cannot[b]).length === 0) delete constraints.cannot[b];
      }
      adjacents[a] = (adjacents[a] || []).filter((x: GuestID) => x !== b);
      adjacents[b] = (adjacents[b] || []).filter((x: GuestID) => x !== a);
      if (adjacents[a]?.length === 0) delete adjacents[a];
      if (adjacents[b]?.length === 0) delete adjacents[b];

      // Determine current state
      const curr = state.constraints.must?.[a]?.[b] ? 'must' :
                   state.constraints.cannot?.[a]?.[b] ? 'cannot' :
                   (state.adjacents[a]?.includes(b) || state.adjacents[b]?.includes(a)) ? 'adjacent' :
                   '';

      // Determine next state
      const next: 'must' | 'adjacent' | 'cannot' | '' =
        (force === 'adjacent' && isPrem) ? 'adjacent' :
        (curr === '') ? 'must' :
        (curr === 'must') ? (isPrem ? 'adjacent' : 'cannot') :
        (curr === 'adjacent') ? 'cannot' :
        (curr === 'cannot') ? '' : '';

      // Apply next state
      if (next === 'must') {
        if (!constraints.must[a]) constraints.must[a] = {};
        if (!constraints.must[b]) constraints.must[b] = {};
        constraints.must[a][b] = 'must';
        constraints.must[b][a] = 'must';
      } else if (next === 'cannot') {
        if (!constraints.cannot[a]) constraints.cannot[a] = {};
        if (!constraints.cannot[b]) constraints.cannot[b] = {};
        constraints.cannot[a][b] = 'cannot';
        constraints.cannot[b][a] = 'cannot';
      } else if (next === 'adjacent' && isPrem) {
        // Degree guard
        const tooMany = (adjacents[a]?.length || 0) >= 2 || (adjacents[b]?.length || 0) >= 2;
        if (tooMany) {
          return { ...state, warnings: [...state.warnings, `Max two adjacent partners per guest (${a}, ${b})`] };
        }
        adjacents[a] = [...(adjacents[a] || []), b];
        adjacents[b] = [...(adjacents[b] || []), a];
      }

      return { ...state, constraints, adjacents, seatingPlans: [], currentPlanIndex: 0 };
    }

    case "SET_CONSTRAINT": {
        const { a: g1, b: g2 } = pairPayload(action.payload);
        const type = action.payload?.type as "must" | "cannot" | undefined;
        const removeType = action.payload?.removeType as "must" | "cannot" | undefined;
        if (!g1 || !g2) return state;

        const nextConstraints: Constraints = {
            ...state.constraints,
            must: { ...(state.constraints.must || {}) },
            cannot: { ...(state.constraints.cannot || {}) },
        };

        const addPair = (map: Record<GuestID, Record<GuestID, 'must' | 'cannot'>>, gA: GuestID, gB: GuestID, val: 'must' | 'cannot') => {
            if (!map[gA]) map[gA] = {};
            if (!map[gB]) map[gB] = {};
            map[gA][gB] = val;
            map[gB][gA] = val;
        };
        const removePairInternal = (map?: Record<GuestID, Record<GuestID, 'must' | 'cannot'>>) => {
            if (!map) return;
            if (map[g1]?.[g2]) delete map[g1][g2];
            if (map[g2]?.[g1]) delete map[g2][g1];
            if (map[g1] && Object.keys(map[g1]).length === 0) delete map[g1];
            if (map[g2] && Object.keys(map[g2]).length === 0) delete map[g2];
        };

        if (removeType) removePairInternal(nextConstraints[removeType]);
        
        if (type === 'must') removePairInternal(nextConstraints['cannot']);
        if (type === 'cannot') removePairInternal(nextConstraints['must']);

        if (type) addPair(nextConstraints[type], g1, g2, type);

        return { ...state, constraints: nextConstraints, seatingPlans: [], currentPlanIndex: 0 };
    }

    case "SET_ADJACENT": {
      const { a: guest1, b: guest2 } = pairPayload(action.payload);
      if (!guest1 || !guest2) return state;

      let adjacents = { ...state.adjacents };
      let constraints = { ...state.constraints };
      
      const isMust = constraints.must?.[guest1]?.[guest2] || constraints.must?.[guest2]?.[guest1];
      const isCannot = constraints.cannot?.[guest1]?.[guest2] || constraints.cannot?.[guest2]?.[guest1];
      const isAdjacent = adjacents[guest1]?.includes(guest2) || adjacents[guest2]?.includes(guest1);

      const addPair = (map: Record<GuestID, GuestID[]>, gA: GuestID, gB: GuestID) => {
        const s1 = new Set(map[gA] || []); s1.add(gB); map[gA] = [...s1];
        const s2 = new Set(map[gB] || []); s2.add(gA); map[gB] = [...s2];
        return map;
      };

      if (isAdjacent) {
          adjacents = removePairFromMap(adjacents, guest1, guest2);
          if (!constraints.cannot[guest1]) constraints.cannot[guest1] = {};
          if (!constraints.cannot[guest2]) constraints.cannot[guest2] = {};
          constraints.cannot[guest1][guest2] = 'cannot';
          constraints.cannot[guest2][guest1] = 'cannot';
      } else if (isMust) {
         if (constraints.must[guest1]?.[guest2]) delete constraints.must[guest1][guest2];
         if (constraints.must[guest2]?.[guest1]) delete constraints.must[guest2][guest1];
         
         if (!wouldCloseInvalidRingExact({ guests: state.guests, tables: state.tables, adjacents: adjacents, newEdge: [guest1, guest2], })) {
              adjacents = addPair(adjacents, guest1, guest2);
         } else {
            baseDispatch({ type: 'ERROR', payload: `Adjacency between ${guest1} and ${guest2} blocked by ring guard.` });
         }
      } else if (isCannot) {
         if (constraints.cannot[guest1]?.[guest2]) delete constraints.cannot[guest1][guest2];
         if (constraints.cannot[guest2]?.[guest1]) delete constraints.cannot[guest2][guest1];
      } else {
        if (!constraints.must[guest1]) constraints.must[guest1] = {};
        if (!constraints.must[guest2]) constraints.must[guest2] = {};
        constraints.must[guest1][guest2] = 'must';
        constraints.must[guest2][guest1] = 'must';
      }

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
    
    case "CLEAR_ALL": {
        return { ...initialState, user: state.user, subscription: state.subscription, trial: state.trial };
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
    
    case "CLEAR_GENERATE_FLAG": {
      const { _generateRequested, ...rest } = state as any;
      return rest;
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
  baseDispatch = setBaseDispatch;

  const [showRecentModal, setShowRecentModal] = useState(false);
  const [mostRecentState, setMostRecentState] = useState<any | null>(null);

  const isPremium = useMemo(() => isPremiumSubscription(state.subscription, state.trial), [state.subscription, state.trial]);
  
  const dispatch: React.Dispatch<AppAction> = useCallback((action: AppAction) => {
    const guardedAction = dispatchGuardrail(state, action, isPremium);
    if (guardedAction && guardedAction.type === 'ERROR') {
        baseDispatch(guardedAction);
    } else if (guardedAction) {
        baseDispatch(guardedAction);
    }
  }, [state, isPremium]);

  // Handle async GENERATE_PLANS via useEffect
  useEffect(() => {
    if ((state as any)._generateRequested) {
      const runGeneration = async () => {
        const premium = isPremiumSubscription(state.subscription, state.trial);
        const maxPlans = premium ? 30 : 10;
        
        const sig = computePlanSignature({
          guests: state.guests,
          tables: state.tables,
          constraints: state.constraints,
          adjacents: state.adjacents,
          assignments: state.assignments,
          isPremium: premium
        });
        
        const { plans, errors } = await generateSeatingPlans({
          guests: state.guests,
          tables: state.tables,
          constraints: state.constraints,
          adjacents: state.adjacents,
          assignments: state.assignments,
          isPremium: premium,
        });
        
        const mustErrors = detectUnsatisfiableMustGroups(
          state.guests, 
          state.tables.map(t => ({...t, capacity: capOf(t)})), 
          state.constraints.must || {}, 
          state.assignments
        );
        
        const allErrors = [...mustErrors, ...errors];
        
        // Persist signature and index
        const userKey = state.user?.id || 'unsigned';
        localStorage.setItem(`seatyr_plan_${userKey}`, JSON.stringify({ sig, index: 0 }));
        
        dispatch({
          type: 'SET_SEATING_PLANS',
          payload: { plans, errors: allErrors, planSig: sig }
        });
        
        // Clear flag
        baseDispatch({ type: 'CLEAR_GENERATE_FLAG', payload: null });
      };
      
      runGeneration();
    }
  }, [(state as any)._generateRequested]);

  const debouncedGeneratePlans = useCallback(debounce(async () => {
    const isPremiumNow = isPremiumSubscription(state.subscription, state.trial);

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

  // SURGICAL TASK 7: Fix session loading races - await both before dispatching
  useEffect(() => {
    const loadSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session) {
        const userId = session.user.id;
        
        const [subResult, trialResult] = await Promise.allSettled([
          supabase.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(),
          supabase.from("trial_subscriptions").select("user_id, start_date, expires_on").eq("user_id", userId).maybeSingle()
        ]);
        
        const subscription = subResult.status === 'fulfilled' && subResult.value?.data ? subResult.value.data : null;
        const trial = trialResult.status === 'fulfilled' && trialResult.value?.data ? trialResult.value.data : null;
        
        baseDispatch({
          type: "SET_SESSION_DATA", 
          payload: { user: session.user, subscription, trial } 
        });

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
      } else {
        baseDispatch({ type: "SET_SESSION_DATA", payload: { user: null, subscription: null, trial: null } });
        try {
          const raw = localStorage.getItem("seatyr_app_state");
          if (raw) {
            const decompressed = LZString.decompressFromUTF16(raw);
            if (decompressed) {
              const saved = JSON.parse(decompressed);
            }
          }
        } catch {}
      }
    };
    
    loadSession();
    
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
          if (!session?.user?.id) return;
          
          const [subResult, trialResult] = await Promise.allSettled([
            supabase.from("subscriptions").select("*").eq("user_id", session.user.id).maybeSingle(),
            supabase.from("trial_subscriptions").select("user_id, start_date, expires_on").eq("user_id", session.user.id).maybeSingle()
          ]);
          
          const subscription = subResult.status === 'fulfilled' && subResult.value?.data ? subResult.value.data : null;
          const trial = trialResult.status === 'fulfilled' && trialResult.value?.data ? trialResult.value.data : null;
          
          baseDispatch({
            type: "SET_SESSION_DATA",
            payload: { user: session.user, subscription, trial }
          });
        } else if (event === 'SIGNED_OUT') {
          baseDispatch({ type: "SET_SESSION_DATA", payload: { user: null, subscription: null, trial: null } });
        }
      }
    );
    return () => authListener?.subscription.unsubscribe();
  }, []);
  
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
      clearMostRecentState(state.user?.id);
    }
  }, [mostRecentState, state.user, dispatch]);
  
  const handleKeepCurrent = useCallback(() => {
    setShowRecentModal(false);
    clearMostRecentState(state.user?.id);
  }, [state.user]);

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