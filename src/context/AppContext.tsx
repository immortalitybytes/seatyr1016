import React, { createContext, useContext, useReducer, useEffect, useState, useMemo, useRef, ReactNode, useCallback } from "react";
import { 
  Guest, Table, Assignments, AppState, GuestID, Constraints, Adjacents, TrialSubscription
} from "../types";
import { isPremiumSubscription } from "../utils/premium";
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
import LZString from 'lz-string';
// Chrome Quota Fix: Import LZString
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
const ADJACENCY_MAX_DEGREE = 2;
const MAX_TABLES = 100;

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


const appReducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case "SET_SESSION_DATA": {
      const { user, subscription, trial } = action.payload;
      return { 
        ...state, 
        user, 
        subscription, 
        trial, 
        // SSoT #2 Fix: Do NOT store isPremium in state, derive it on access.
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
      };
    }

    case "SET_PLANS":
    case "SET_SEATING_PLANS": {
      const { plans = [], errors = [], planSig = null } = action.payload ?? {};
      // C6 Fix: Robustly compute the signature
      const finalPlanSig = planSig || computePlanSignature({
        guests: state.guests, tables: state.tables, constraints: state.constraints, adjacents: state.adjacents, assignments: state.assignments, subscription: state.subscription, trial: state.trial
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

    // FIX Blocker 2: Robust SET_CONSTRAINT logic for pairwise array manipulation
    case "SET_CONSTRAINT": {
        const { a: g1, b: g2 } = pairPayload(action.payload);
        const type = action.payload?.type as "must" | "cannot";
        const removeType = action.payload?.removeType as "must" | "cannot" | undefined;
        if (!g1 || !g2 || (type !== "must" && type !== "cannot")) return state;

        const next = {
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

        if (removeType) removePairInternal(next[removeType]);
        addPair(next[type], g1, g2);

        return { ...state, constraints: next, seatingPlans: [], currentPlanIndex: 0 };
    }


    // FIX C5/Blocker 3: Correct SET_ADJACENT logic for array checks and de-duping
    case "SET_ADJACENT": {
      const { a: guest1, b: guest2 } = pairPayload(action.payload);
      if (!guest1 || !guest2) return state;

      let adjacents = { ...state.adjacents };
      let constraints = { ...state.constraints };
      
      const currentMusts = constraints.must?.[guest1]?.includes(guest2);
      // FIX Blocker 3: Use .includes() for array check
      const currentAdj = (adjacents[guest1]?.includes(guest2)) || (adjacents[guest2]?.includes(guest1));

      if (currentAdj) {
          // Case 1: Currently ADJACENT PAIRED -> NONE (remove both)
          adjacents = removePairFromMap(adjacents, guest1, guest2);
      } else if (currentMusts) {
          // Case 2: Currently MUST -> ADJACENT PAIRED (remove MUST, add ADJACENT PAIRED)
          
          // 1. Remove MUST constraint for both guests
          constraints.must = removePairFromMap(constraints.must || {}, guest1, guest2);
          
          // 2. Add the ADJACENT constraint (with ring/degree guards enforced by the underlying logic)
          if (!wouldCloseInvalidRingExact({
              guests: state.guests,
              tables: state.tables,
              adjacents: adjacents,
              newEdge: [guest1, guest2],
          })) {
              // FIX Blocker 3: Use Set logic to add/prevent dupes
              adjacents[guest1] = Array.from(new Set([...(adjacents[guest1] || []), guest2]));
              adjacents[guest2] = Array.from(new Set([...(adjacents[guest2] || []), guest1]));
          } else {
            console.warn(`Adjacency between ${guest1} and ${guest2} blocked by ring guard.`);
          }
      } else {
        // Case 3: Currently NONE -> ADJACENT PAIRED (add only ADJACENT PAIRED)
        if (!wouldCloseInvalidRingExact({
            guests: state.guests,
            tables: state.tables,
            adjacents: adjacents,
            newEdge: [guest1, guest2],
        })) {
            // FIX Blocker 3: Use Set logic to add/prevent dupes
            adjacents[guest1] = Array.from(new Set([...(adjacents[guest1] || []), guest2]));
            adjacents[guest2] = Array.from(new Set([...(adjacents[guest2] || []), guest1]));
        } else {
            console.warn(`Adjacency between ${guest1} and ${guest2} blocked by ring guard.`);
        }
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
    case "SET_TABLES":
    case "ADD_TABLE":
    case "UPDATE_TABLE":
    case "REMOVE_TABLE":
    case "AUTO_RECONCILE_TABLES": {
      const newState = { ...state, ...action.payload, seatingPlans: [], currentPlanIndex: 0 };
      return newState;
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
  const [state, dispatch] = useReducer(appReducer, { ...initialState });
  // SSoT #2 Fix: sessionLoading is no longer a state variable in AppContext but can be used for UI
  // const [sessionLoading, setSessionLoading] = useState(true);
  const [showRecentModal, setShowRecentModal] = useState(false);
  const [mostRecentState, setMostRecentState] = useState<any | null>(null);

  // SSoT #2 Fix: Derived isPremium (used by debouncedGeneratePlans and localStorage effect)
  const isPremium = useMemo(() => isPremiumSubscription(state.subscription, state.trial), [state.subscription, state.trial]);
  
  // FIX C6/Blocker 1: Use computePlanSignature for dedupe
  const debouncedGeneratePlans = useCallback(debounce(async () => {
    // SSoT #2 Fix: isPremium is now derived here
    const isPremiumNow = isPremiumSubscription(state.subscription, state.trial);

    const currentPlanSig = computePlanSignature({
      guests: state.guests,
      tables: state.tables,
      constraints: state.constraints,
      adjacents: state.adjacents,
      assignments: state.assignments,
      // SSoT #2 Fix: Must include premium status in signature for dedupe consistency
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
  // SSoT #2 Fix: Dependencies must include premium related state
  }, 300), [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.subscription, state.trial, state.lastGeneratedPlanSig]);


  // Auth & Subscription Effect (Fix C4: .maybeSingle())
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        Promise.allSettled([
          // C4 Fix: Use .maybeSingle() to prevent 404 crash
          supabase.from("subscriptions").select("*").eq("user_id", session.user.id).maybeSingle(),
          supabase.from("trials").select("*").eq("user_id", session.user.id).maybeSingle(),
        ]).then(([subResult, trialResult]) => {
          const subscription = subResult.status === 'fulfilled' && subResult.value?.data ? subResult.value.data : null;
          const trial = trialResult.status === 'fulfilled' && trialResult.value?.data ? trialResult.value.data : null;
          
          dispatch({ 
            type: "SET_SESSION_DATA", 
            payload: { user: session.user, subscription, trial } 
          });
          // setSessionLoading(false); // SSoT #2 Fix: Removed

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
        dispatch({ type: "SET_SESSION_DATA", payload: { user: null, subscription: null, trial: null } });
        // setSessionLoading(false); // SSoT #2 Fix: Removed
        try {
          // Chrome Quota Fix: Read compressed state from localStorage
          const raw = localStorage.getItem("seatyr_app_state");
          if (raw) {
            const decompressed = LZString.decompressFromUTF16(raw);
            if (decompressed) {
              const saved = JSON.parse(decompressed);
              const loaded = { ...initialState, ...saved };
              // Hydrate logic for free users remains here if necessary
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
              supabase.from("trials").select("*").eq("user_id", session?.user.id).maybeSingle()
            ]).then(([subResult, trialResult]) => {
              const subscription = subResult.status === 'fulfilled' && subResult.value?.data ? subResult.value.data : null;
              const trial = trialResult.status === 'fulfilled' && trialResult.value?.data ? trialResult.value.data : null;
              dispatch({
                type: "SET_SESSION_DATA",
                payload: { user: session?.user, subscription, trial }
              });
            });
        } else if (event === 'SIGNED_OUT') {
          dispatch({ type: "SET_SESSION_DATA", payload: { user: null, subscription: null, trial: null } });
        }
      }
    );
    return () => authListener?.subscription.unsubscribe();
  // SSoT #2 Fix: Added subscription/trial to dependencies for effects related to premium features
  }, [state.subscription, state.trial]);
  // eslint-disable-line react-hooks/exhaustive-deps
  

  useEffect(() => {
    debouncedGeneratePlans();
    
    // Chrome Quota Fix: Use derived isPremium
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
    } else {
       try {
        // Chrome Quota Fix: Save compressed state to localStorage
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
    }
  }, [mostRecentState]);
  const handleKeepCurrent = useCallback(() => {
    setShowRecentModal(false);
  }, []);

  // SSoT #2 Fix: Expose derived isPremium
  const value = useMemo(() => ({ state, dispatch, isPremium }), [state, isPremium]);

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
  // SSoT #2 Fix: Removed isPremium from state
  lastGeneratedSignature: null,
  lastGeneratedPlanSig: null,
};