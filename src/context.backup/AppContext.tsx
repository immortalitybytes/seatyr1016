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
const ADJACENCY_MAX_DEGREE = 2;

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
  const capChanged = (t.seats ?? t.capacity) !== DEFAULT_TABLE_CAPACITY;
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
    if (isTableLocked(t, assignments)) lockedCap += t.seats ?? t.capacity ?? DEFAULT_TABLE_CAPACITY;
  }
  const remaining = Math.max(0, needed - lockedCap);
  const untouched = tables.filter(t => !isTableLocked(t, assignments) && (t.seats ?? t.capacity) === DEFAULT_TABLE_CAPACITY);
  const delta = Math.ceil(remaining / DEFAULT_TABLE_CAPACITY) - untouched.length;
  if (delta <= 0) return tables;
  const maxId = Math.max(...tables.map(t => t.id), 0);
  const newTables = Array.from({ length: delta }, (_, i) => ({
    id: maxId + i + 1,
    seats: DEFAULT_TABLE_CAPACITY,
  }));
  return [...tables, ...newTables];
}

// Complete migration with all edge cases handled
function sanitizeAndMigrateAppState(state: AppState): AppState {
  const guests = state.guests.filter(g => g.id && g.name);
  const guestNameToId = new Map<string, GuestID>();
  guests.forEach(g => guestNameToId.set(g.name.toLowerCase(), g.id));
  const guestIdToName = new Map<GuestID, string>();
  guests.forEach(g => guestIdToName.set(g.id, g.name));
  const migratedConstraints: Constraints = {};
  Object.entries(state.constraints || {}).forEach(([nameA, consB]) => {
    const idA = guestNameToId.get(nameA.toLowerCase()) || nameA;
    if (!guestIdToName.has(idA as GuestID)) return;
    migratedConstraints[idA] = {};
    Object.entries(consB || {}).forEach(([nameB, value]) => {
      const idB = guestNameToId.get(nameB.toLowerCase()) || nameB;
      if (idB && idB !== idA && guestIdToName.has(idB as GuestID)) {
        migratedConstraints[idA][idB] = value as 'must' | 'cannot' | '';
      }
    });
  });
  const migratedAdjacents: Adjacents = {};
  Object.entries(state.adjacents || {}).forEach(([idA, list]) => {
    if (!guestIdToName.has(idA as GuestID)) return;
    const validPartners = (list || []).filter(idB => 
      idB !== idA && guestIdToName.has(idB as GuestID)
    ).slice(0, ADJACENCY_MAX_DEGREE);
    if (validPartners.length > 0) migratedAdjacents[idA] = validPartners;
  });
  // Force 'must' for all adjacency pairs (bidirectional)
  for (const idA in migratedAdjacents) {
    for (const idB of migratedAdjacents[idA]) {
      if (!migratedConstraints[idA]) migratedConstraints[idA] = {};
      if (!migratedConstraints[idB]) migratedConstraints[idB] = {};
      migratedConstraints[idA][idB] = 'must';
      migratedConstraints[idB][idA] = 'must';
    }
  }

  // Clean up empty objects
  for (const id in migratedConstraints) {
    if (Object.keys(migratedConstraints[id]).length === 0) delete migratedConstraints[id];
  }
  for (const id in migratedAdjacents) {
    if (migratedAdjacents[id].length === 0) delete migratedAdjacents[id];
  }

  const migratedAssignments = migrateAssignmentsToIdKeys(state.assignments || {}, guests);
  const { normalized, warnings } = normalizeAssignmentInputToIdsWithWarnings(migratedAssignments, state.tables, guests);
  const finalAssignments = normalized;
  const uniqueWarnings = [...new Set([...(state.warnings || []), ...warnings].map(w => w.toLowerCase()))].map(lower => 
    (state.warnings || []).find(w => w.toLowerCase() === lower) || warnings.find(w => w.toLowerCase() === lower)!
  );
  return {
    ...state,
    guests,
    constraints: migratedConstraints,
    adjacents: migratedAdjacents,
    assignments: finalAssignments,
    warnings: uniqueWarnings,
    timestamp: new Date().toISOString(),
  };
}

function addAdjacentSymmetric(adjacents: Adjacents, a: GuestID, b: GuestID): Adjacents {
  if (a === b) return adjacents;
  const next = { ...adjacents };
  const listA = [...(next[a] || [])];
  const listB = [...(next[b] || [])];
  if (!listA.includes(b) && listA.length >= ADJACENCY_MAX_DEGREE) return adjacents;
  if (!listB.includes(a) && listB.length >= ADJACENCY_MAX_DEGREE) return adjacents;
  if (!listA.includes(b)) listA.push(b);
  if (!listB.includes(a)) listB.push(a);
  next[a] = listA;
  next[b] = listB;
  return next;
}

function removeAdjacentSymmetric(adjacents: Adjacents, a: GuestID, b: GuestID): Adjacents {
  if (a === b) return adjacents;
  const next = { ...adjacents };
  if (next[a]) {
    next[a] = next[a].filter(id => id !== b);
    if (next[a].length === 0) delete next[a];
  }
  if (next[b]) {
    next[b] = next[b].filter(id => id !== a);
    if (next[b].length === 0) delete next[b];
  }
  return next;
}

const AppContext = createContext<{ state: AppState; dispatch: React.Dispatch<AppAction> } | null>(null);

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
  lastGeneratedSignature: null,
  lastGeneratedPlanSig: null,
};

const reducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case "SET_GUESTS":
      const payload = action.payload;
      const guests = Array.isArray(payload) ? payload : payload.guests || [];
      const duplicateGuests = Array.isArray(payload) ? [] : payload.duplicateGuests ?? [];
      return { ...state, guests, duplicateGuests };
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
      const guests = state.guests.map(g => g.id === id ? { ...g, name } : g);
      return { ...state, guests, seatingPlans: [], currentPlanIndex: 0 };
    }
    case "UPDATE_ASSIGNMENT": {
      const { guestId, raw } = action.payload;
      const assignments = { ...state.assignments, [guestId]: raw };
      return { ...state, assignments, seatingPlans: [], currentPlanIndex: 0 };
    }
    case "SET_CONSTRAINT": {
      const { guest1, guest2, value } = action.payload;
      const constraints = { ...state.constraints };
      if (!constraints[guest1]) constraints[guest1] = {};
      if (!constraints[guest2]) constraints[guest2] = {};
      constraints[guest1][guest2] = value;
      constraints[guest2][guest1] = value;
      return { ...state, constraints, seatingPlans: [], currentPlanIndex: 0 };
    }
    case "SET_ADJACENT": {
      const { guest1, guest2 } = action.payload;
      return { ...state, adjacents: addAdjacentSymmetric(state.adjacents, guest1, guest2) };
    }
    case "REMOVE_ADJACENT": {
      const { guest1, guest2 } = action.payload;
      return { ...state, adjacents: removeAdjacentSymmetric(state.adjacents, guest1, guest2) };
    }
    case "SET_TABLES":
      return { ...state, tables: action.payload, userSetTables: true };
    case "ADD_TABLE":
      return { ...state, tables: [...state.tables, action.payload], userSetTables: true };
    case "REMOVE_TABLE": {
      const id = action.payload;
      const tables = state.tables.filter(t => t.id !== id);
      return { ...state, tables, userSetTables: true };
    }
    case "UPDATE_TABLE": {
      const tables = state.tables.map(t => t.id === action.payload.id ? { ...t, ...action.payload } : t);
      return { ...state, tables, userSetTables: true };
    }
    case "SET_SEATING_PLANS":
      return { ...state, seatingPlans: action.payload };
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
      const newWarnings = Array.isArray(action.payload) ? action.payload : [action.payload];
      const warnings = [...new Set([...state.warnings, ...newWarnings].map(w => w.toLowerCase()))].map(lower => 
        state.warnings.find(w => w.toLowerCase() === lower) || newWarnings.find(w => w.toLowerCase() === lower)!
      );
      return { ...state, warnings };
    }
    case "CLEAR_WARNINGS":
      return { ...state, warnings: [] };
    case "RESET_APP_STATE":
      return initialState;
    case "SET_DUPLICATE_GUESTS":
      return { ...state, duplicateGuests: action.payload };
    case "AUTO_RECONCILE_TABLES":
      return { ...state, tables: reconcileTables(state.tables, state.guests, state.assignments, state.userSetTables) };
    case "LOAD_MOST_RECENT":
    case "IMPORT_STATE": {
      const importedState = action.payload;
      return {
        ...state,
        ...importedState,
        subscription: state.subscription,
        user: state.user,
        seatingPlans: [],
        currentPlanIndex: 0,
        lastGeneratedPlanSig: null,
        warnings: []
      };
    }
    default:
      return state;
  }
};

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [mostRecentState, setMostRecentState] = useState<AppState | null>(null);
  const [showRecentModal, setShowRecentModal] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentFetched, setRecentFetched] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authChanged, setAuthChanged] = useState(false);

  // Init session
  useEffect(() => {
    const init = async () => {
      setSessionLoading(true);
      try {
        const { data } = await supabase.auth.getSession();
        dispatch({ type: "SET_USER", payload: data.session?.user ?? null });
        if (data.session?.user) {
          const recent = await getMostRecentState(data.session.user.id);
          if (recent) {
            setMostRecentState(recent);
            setShowRecentModal(true);
          }
        }
      } catch (err) {
        setRecentError("Failed to load recent state.");
      } finally {
        setSessionLoading(false);
        setRecentFetched(true);
      }
    };
    init();
  }, []);

  // Subscription fetch on auth change
  useEffect(() => {
    if (state.user && authChanged) {
      supabase.from("subscriptions").select("*").eq("user_id", state.user.id).single().then(({ data }) => {
        dispatch({ type: "SET_SUBSCRIPTION", payload: data });
      });
    }
  }, [state.user, authChanged]);

  // Auto-reconcile tables
  useEffect(() => {
    if (!state.userSetTables) {
      dispatch({ type: "AUTO_RECONCILE_TABLES" });
    }
  }, [state.guests, state.tables, state.assignments, state.userSetTables]);

  // Debounced save
  const saveDebounced = useMemo(() => {
    let timeout: NodeJS.Timeout;
    return (stateToSave: AppState) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (stateToSave.user) {
          saveMostRecentState(stateToSave.user.id, { ...stateToSave, loadedSavedSetting: false }, isPremiumSubscription(stateToSave.subscription)).catch(console.error);
        }
      }, 500);
    };
  }, []);

  useEffect(() => {
    saveDebounced(state);
  }, [state, saveDebounced]);

  // Debounced plan generation
  const debouncedGeneratePlans = useMemo(() => {
    let timeout: NodeJS.Timeout;
    return async () => {
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
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
        dispatch({ type: "SET_SEATING_PLANS", payload: plans || [] });
        console.timeEnd("SeatingGeneration");
      }, 300);
    };
  }, [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.subscription]);

  // Trigger generation effect
  useEffect(() => {
    if (state.guests.length > 0 && state.tables.length > 0 && !state.loadedSavedSetting) {
      debouncedGeneratePlans();
    }
  }, [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.loadedSavedSetting, debouncedGeneratePlans]);

  // Auth change listener
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