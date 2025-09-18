import React, { createContext, useContext, useReducer, useEffect, useState, useMemo, ReactNode } from "react";
import { 
  Guest, Table, Assignments, AppState, GuestID, Constraints, Adjacents
} from "../types";
import { isPremiumSubscription } from "../utils/premium";
import { supabase } from "../lib/supabase";
import { getMostRecentState, clearMostRecentState, saveMostRecentState } from "../lib/mostRecentState";
import MostRecentChoiceModal from "../components/MostRecentChoiceModal";
import { migrateState, normalizeAssignmentInputToIdsWithWarnings, parseAssignmentIds, migrateAssignmentsToIdKeys } from '../utils/assignments';
import { detectConflicts } from '../utils/conflicts';
import { computePlanSignature } from '../utils/planSignature';
import { countHeads } from '../utils/formatters';
import { detectConstraintConflicts, generateSeatingPlans } from "../utils/seatingAlgorithm";

const defaultTables: Table[] = Array.from({ length: 10 }, (_, i) => ({ 
  id: i + 1, seats: 8 
}));

const DEFAULT_TABLE_CAPACITY = 8;

interface AppAction {
  type: string;
  payload?: any;
}

function isAssignedToTable(t: Table, assignments: Assignments): boolean {
  const tName = (t.name ?? '').trim().toLowerCase();
  for (const raw of Object.values(assignments)) {
    if (!raw) continue;
    const tokens = raw.split(',').map(s => s.trim()).filter(Boolean);
    for (const token of tokens) {
      const num = Number(token);
      if (!Number.isNaN(num) && num === t.id) return true;
      if (tName && token.toLowerCase() === tName) return true;
    }
  }
  return false;
}

function isTableLocked(t: Table, assignments: Assignments): boolean {
  const named = !!(t.name && t.name.trim());
  const capChanged = t.seats !== DEFAULT_TABLE_CAPACITY;
  const hasAssign = isAssignedToTable(t, assignments);
  return named || capChanged || hasAssign;
}

function totalSeatsNeeded(guests: Guest[]): number {
  return guests.reduce((sum, g) => sum + Math.max(1, g.count), 0);
}

function reconcileTables(tables: Table[], guests: Guest[], assignments: Assignments, userSetTables: boolean): Table[] {
  if (userSetTables) return tables;
  const needed = totalSeatsNeeded(guests);
  let lockedCap = 0;
  for (const t of tables) {
    if (isTableLocked(t, assignments)) lockedCap += t.seats;
  }
  const remaining = Math.max(0, needed - lockedCap);
  const untouched = tables.filter(t => !isTableLocked(t, assignments) && t.seats === DEFAULT_TABLE_CAPACITY);
  const delta = Math.ceil(remaining / DEFAULT_TABLE_CAPACITY) - untouched.length;
  if (delta <= 0) return tables;
  const maxId = Math.max(...tables.map(t => t.id), 0);
  const newTables = Array.from({ length: delta }, (_, i) => ({
    id: maxId + i + 1,
    seats: DEFAULT_TABLE_CAPACITY,
  }));
  return [...tables, ...newTables];
}

// P-1: Sanitize and migrate full state on load
function sanitizeAndMigrateAppState(state: AppState): AppState {
  const guests = state.guests.filter(g => g.id && g.name);
  const guestNameToId = new Map<string, GuestID>();
  guests.forEach(g => guestNameToId.set(g.name.toLowerCase(), g.id));
  const guestIdToName = new Map<GuestID, string>();
  guests.forEach(g => guestIdToName.set(g.id, g.name));

  const migratedConstraints: Constraints = {};
  Object.entries(state.constraints ?? {}).forEach(([key1, val1]) => {
    const id1 = guestNameToId.get(key1.toLowerCase()) || key1;
    if (!guestIdToName.has(id1)) return;
    Object.entries(val1).forEach(([key2, val2]) => {
      const id2 = guestNameToId.get(key2.toLowerCase()) || key2;
      if (!guestIdToName.has(id2) || id1 === id2) return;
      if (val2 === 'must' || val2 === 'cannot' || val2 === '') {
        migratedConstraints[id1] = { ...migratedConstraints[id1], [id2]: val2 };
      }
    });
  });

  const migratedAdjacents: Adjacents = {};
  Object.entries(state.adjacents ?? {}).forEach(([key1, val1]) => {
    const id1 = guestNameToId.get(key1.toLowerCase()) || key1;
    if (!guestIdToName.has(id1)) return;
    const partners = (val1 as GuestID[]).map(key2 => guestNameToId.get(key2.toLowerCase()) || key2).filter(id2 => id2 !== id1 && guestIdToName.has(id2));
    if (partners.length > 0) {
      migratedAdjacents[id1] = partners.slice(0, 2);
    }
  });

  const normalizedAssignments: Assignments = {};
  Object.entries(state.assignments ?? {}).forEach(([key, raw]) => {
    const guestId = guestNameToId.get(key.toLowerCase()) || key;
    if (!guestIdToName.has(guestId)) return;
    const { idsCsv } = normalizeAssignmentInputToIdsWithWarnings(raw, state.tables);
    normalizedAssignments[guestId] = idsCsv;
  });

  return {
    ...state,
    guests,
    constraints: migratedConstraints,
    adjacents: migratedAdjacents,
    assignments: normalizedAssignments
  };
}

const reducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case "SET_GUESTS":
      return { ...state, guests: action.payload, duplicateGuests: action.payload.duplicateGuests ?? [] };
    case "ADD_GUEST": {
      const guests = [...state.guests, action.payload];
      return {
        ...state,
        guests,
        duplicateGuests: state.duplicateGuests?.filter(name => name !== action.payload.name) ?? [],
      };
    }
    case "REMOVE_GUEST": {
      const id = action.payload;
      const guests = state.guests.filter(g => g.id !== id);
      const assignments = { ...state.assignments };
      const constraints = { ...state.constraints };
      const adjacents = { ...state.adjacents };
      delete assignments[id];
      delete constraints[id];
      delete adjacents[id];
      Object.keys(constraints).forEach(key => delete constraints[key][id]);
      Object.keys(adjacents).forEach(key => adjacents[key] = adjacents[key].filter(aid => aid !== id));
      return { ...state, guests, assignments, constraints, adjacents, seatingPlans: [], currentPlanIndex: 0 };
    }
    case "RENAME_GUEST": {
      const { id, name } = action.payload;
      const guests = state.guests.map(g => g.id === id ? { ...g, name, count: countHeads(name) } : g);
      return { ...state, guests, seatingPlans: [], currentPlanIndex: 0 };
    }
    case "CLEAR_ALL": {
      return {
        ...state,
        guests: [],
        constraints: {},
        adjacents: {},
        assignments: {},
        seatingPlans: [],
        currentPlanIndex: 0,
        warnings: []
      };
    }
    case "UPDATE_ASSIGNMENT": {
      const { payload } = action;
      const { guestId, raw } = payload;
      const { idCsv, warnings } = normalizeAssignmentInputToIdsWithWarnings(raw, state.tables);
      const newAssignments = { ...state.assignments, [guestId]: idCsv };
      const signature = JSON.stringify(Object.entries(newAssignments).sort((a, b) => a[0].localeCompare(b[0])));
      const conflictWarnings = detectConflicts(newAssignments, state.constraints);
      const ids = parseAssignmentIds(idCsv);
      const allValid = ids.every(id => state.tables.some(t => t.id === id));
      if (state.userSetTables && idCsv && !allValid) {
        return { ...state, warnings: [...new Set([...state.warnings, `Invalid table assignment for guest ${guestId}`])] };
      }
      return {
        ...state,
        assignments: newAssignments,
        assignmentSignature: signature,
        seatingPlans: [],
        warnings: [...new Set([...state.warnings, ...warnings, ...conflictWarnings])]
      };
    }
    case "SET_CONSTRAINT": {
      const { guest1, guest2, value } = action.payload;
      const constraints = { ...state.constraints };
      constraints[guest1] = { ...constraints[guest1], [guest2]: value };
      constraints[guest2] = { ...constraints[guest2], [guest1]: value };
      
      // P-4: Detect conflicts after constraint change
      const conflicts = detectConstraintConflicts(state.guests, state.tables, constraints, true, state.adjacents);
      const constraintErrors = conflicts.filter(c => c.type === 'error' && (c.message.toLowerCase().includes('must') || c.message.toLowerCase().includes('cannot')));
      return {
        ...state,
        constraints,
        seatingPlans: [],
        currentPlanIndex: 0,
        conflictWarnings: constraintErrors.length > 0 ? constraintErrors.map(e => e.message) : state.conflictWarnings
      };
    }
    case "SET_TABLES":
      return { ...state, tables: action.payload, userSetTables: true };
    case "ADD_TABLE":
      return { ...state, tables: [...state.tables, action.payload], userSetTables: true };
    case "REMOVE_TABLE": {
      const id = action.payload;
      const tables = state.tables.filter(t => t.id !== id);
      const assignments = { ...state.assignments };
      Object.keys(assignments).forEach(key => {
        const ids = (assignments[key] as string).split(',').map(Number).filter(n => !Number.isNaN(n) && n !== id);
        assignments[key] = ids.sort((a, b) => a - b).join(',');
      });
      return { ...state, tables, assignments, seatingPlans: [], currentPlanIndex: 0, userSetTables: true };
    }
    case "UPDATE_TABLE":
      return {
        ...state,
        tables: state.tables.map(t => t.id === action.payload.id ? { ...t, ...action.payload } : t),
        userSetTables: true,
      };
    case "SET_SEATING_PLANS":
      return { ...state, seatingPlans: action.payload, currentPlanIndex: 0 };
    case "SET_CURRENT_PLAN_INDEX":
      return { ...state, currentPlanIndex: action.payload };
    case "SET_USER":
      return { ...state, user: action.payload };
    case "SET_SUBSCRIPTION":
      return { ...state, subscription: action.payload };
    case "SET_LOADED_SAVED_SETTING":
      return { ...state, loadedSavedSetting: action.payload };
    case "SET_USER_SET_TABLES":
      return { ...state, userSetTables: action.payload };
    case "SET_WARNING": {
      const { payload } = action;
      return { ...state, warnings: [...new Set([...state.warnings, ...(Array.isArray(payload) ? payload : [payload])])] };
    }
    case "CLEAR_WARNINGS":
      return { ...state, warnings: [] };
    case "SET_PLANS": {
      const { payload } = action;
      const { plans, errors = [], planSig } = payload;
      const toText = (e: any) => (typeof e === 'string' ? e : e?.message ?? JSON.stringify(e));
      return {
        ...state,
        seatingPlans: plans,
        lastGeneratedSignature: state.assignmentSignature,
        lastGeneratedPlanSig: planSig ?? computePlanSignature(state),
        warnings: [...new Set([...state.warnings, ...errors.map(toText)])]
      };
    }
    case "PURGE_PLANS": {
      return { ...state, seatingPlans: [] };
    }
    case "AUTO_RECONCILE_TABLES":
      return { ...state, tables: reconcileTables(state.tables, state.guests, state.assignments, state.userSetTables) };
    case "LOAD_MOST_RECENT":
    case "LOAD_SAVED_SETTING": {
      const { payload } = action;
      const { constraints, adjacents } = migrateState(payload);
      const idKeyed = migrateAssignmentsToIdKeys(payload.assignments || {}, payload.guests || []);
      const normAssignments = Object.fromEntries(
        Object.entries(idKeyed).map(([k, v]) => [
          k,
          normalizeAssignmentInputToIdsWithWarnings(v, payload.tables || []).idCsv
        ])
      );
      const assignmentSignature = JSON.stringify(
        Object.entries(normAssignments).sort((a, b) => a[0].localeCompare(b[0]))
      );
      return {
        ...state,
        ...payload,
        constraints,
        adjacents,
        assignments: normAssignments,
        assignmentSignature,
        seatingPlans: [],
        lastGeneratedPlanSig: null,
        warnings: []
      };
    }
    case "RESET_APP_STATE":
      return {
        ...initialState,
        user: null,
        subscription: null
      };
    case "SET_DUPLICATE_GUESTS":
      return { ...state, duplicateGuests: action.payload };
    default:
      return state;
  }
};

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [showRecentModal, setShowRecentModal] = useState(false);
  const [mostRecentState, setMostRecentState] = useState<AppState | null>(null);
  const [recentFetched, setRecentFetched] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authChanged, setAuthChanged] = useState(false);
  
  // P-0: Init effect
  useEffect(() => {
    const init = async () => {
      setSessionLoading(true);
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (data.session?.user) {
          dispatch({ type: "SET_USER", payload: data.session.user });
          const recent = await getMostRecentState(data.session.user.id);
          if (recent) {
            setMostRecentState(recent);
            setShowRecentModal(true);
          }
        }
      } catch (err) {
        console.error("Init error:", err);
        setRecentError("Failed to load recent state.");
      } finally {
        setSessionLoading(false);
        setRecentFetched(true);
      }
    };
    init();
  }, []);

  // P-0: Subscription effect
  useEffect(() => {
    if (!state.user || !authChanged) return;
    supabase.from("subscriptions").select("*").eq("user_id", state.user.id).single().then(({ data, error }) => {
      if (error) console.error("Subscription error:", error);
      else dispatch({ type: "SET_SUBSCRIPTION", payload: data });
    });
  }, [state.user, authChanged]);

  // P-3: Auto-reconcile tables
  useEffect(() => {
    if (!state.userSetTables) {
      dispatch({ type: "AUTO_RECONCILE_TABLES" });
    }
  }, [state.guests, state.tables, state.assignments, state.userSetTables, dispatch]);

  // P-5: Debounced save
  const saveDebounced = useMemo(() => {
    return (stateToSave: AppState) => {
      if (stateToSave.user) {
        saveMostRecentState(stateToSave.user.id, { ...stateToSave, loadedSavedSetting: false }, isPremiumSubscription(stateToSave.subscription)).catch(console.error);
      }
    };
  }, []);
  
  useEffect(() => {
    saveDebounced(state);
  }, [state, saveDebounced]);

  // P-5: Debounced plan generation
  const debouncedGeneratePlans = useMemo(() => {
    return async () => {
      console.time("SeatingGeneration");
      dispatch({ type: "CLEAR_WARNINGS" });
      const { plans, errors: validationErrors } = await generateSeatingPlans(
        state.guests,
        state.tables,
        state.constraints,
        state.adjacents,
        state.assignments,
        isPremiumSubscription(state.subscription)
      );
      if (validationErrors.length > 0) {
        dispatch({ type: "SET_WARNING", payload: validationErrors.map(e => e.message) });
      }
      if (plans.length > 0) {
        dispatch({ type: "SET_SEATING_PLANS", payload: plans });
      } else {
        dispatch({ type: "SET_SEATING_PLANS", payload: [] });
      }
      console.timeEnd("SeatingGeneration");
    };
  }, [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.subscription, dispatch]);

  // P-5: Trigger generation effect
  useEffect(() => {
    if (state.guests.length > 0 && state.tables.length > 0 && !state.loadedSavedSetting) {
      debouncedGeneratePlans();
    }
  }, [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.loadedSavedSetting, debouncedGeneratePlans]);

  // P-0: Auth change listener
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") setAuthChanged(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleKeepCurrent = async () => {
    setShowRecentModal(false);
    if (state.user) clearMostRecentState(state.user.id).catch(console.error);
  };

  const handleRestoreRecent = () => {
    if (!mostRecentState) {
      setRecentError("No recent data available.");
      return;
    }
    setShowRecentModal(false);
    dispatch({ type: "LOAD_MOST_RECENT", payload: mostRecentState });
  };

  const handleRetryRecent = async () => {
    if (!state.user) return;
    setRecentError(null);
    try {
      const recent = await getMostRecentState(state.user.id);
      if (recent) {
        setMostRecentState(recent);
        setShowRecentModal(true);
      }
    } catch (err) {
      setRecentError("Failed to load recent state.");
    }
  };

  const value = useMemo(() => ({ state, dispatch }), [state, dispatch]);

  return (
    <AppContext.Provider value={value}>
      {children}
      {showRecentModal && state.user && isPremiumSubscription(state.subscription) && (
        <MostRecentChoiceModal
          userId={state.user.id}
          isPremium={isPremiumSubscription(state.subscription)}
          recentTimestamp={mostRecentState?.timestamp}
          onClose={() => setShowRecentModal(false)}
          onRestoreRecent={handleRestoreRecent}
          onKeepCurrent={handleKeepCurrent}
          onRetryFetch={handleRetryRecent}
          error={recentError}
          loading={!recentFetched && sessionLoading}
        />
      )}
    </AppContext.Provider>
  );
};

export const useApp = (): { state: AppState, dispatch: React.Dispatch<AppAction> } => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppProvider");
  return context;
};

const AppContext = createContext<{ state: AppState, dispatch: React.Dispatch<AppAction> } | undefined>(undefined);

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
  lastGeneratedSignature: null,
  lastGeneratedPlanSig: null,
};
