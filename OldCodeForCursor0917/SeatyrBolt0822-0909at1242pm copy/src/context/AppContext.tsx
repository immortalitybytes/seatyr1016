import React, { createContext, useContext, useReducer, useEffect, useState, useMemo, ReactNode } from "react";
import { 
  Guest, Table, Assignments, AppState 
} from "../types";
import { isPremiumSubscription } from "../utils/premium";
import { supabase } from "../lib/supabase";
import { getMostRecentState, clearMostRecentState, saveMostRecentState } from "../lib/mostRecentState";
import MostRecentChoiceModal from "../components/MostRecentChoiceModal";
import { mergeAssignments, normalizeAssignmentInputToIdsWithWarnings } from "../utils/assignments";
import { calculateTotalCapacity } from "../utils/tables";

const defaultTables: Table[] = Array.from({ length: 10 }, (_, i) => ({ 
  id: i + 1, seats: 8 
}));
const DEFAULT_TABLE_CAPACITY = 8;

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

interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<any>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);
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
};
const reducer = (state: AppState, action: any): AppState => {
  switch (action.type) {
    case "SET_GUESTS":
      return { ...state, guests: action.payload, duplicateGuests: action.duplicateGuests ?? [] };
    case "ADD_GUEST": {
      const guests = [...state.guests, action.payload];
      const sig = JSON.stringify(Object.entries(state.assignments).sort(([a], [b]) => a.localeCompare(b)));
      return {
        ...state,
        guests,
        duplicateGuests: state.duplicateGuests?.filter(name => name !== action.payload.name) ?? [],
        assignmentSignature: sig,
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
      const sig = JSON.stringify(Object.entries(assignments).sort(([a], [b]) => a.localeCompare(b)));
      return { ...state, guests, assignments, constraints, adjacents, seatingPlans: [], currentPlanIndex: 0, assignmentSignature: sig };
    }
    case "UPDATE_ASSIGNMENT": {
      const assignments = { ...state.assignments, [action.payload.name]: action.payload.tables };
      const sig = JSON.stringify(Object.entries(assignments).sort(([a], [b]) => a.localeCompare(b)));
      return { ...state, assignments, assignmentSignature: sig };
    }
    case "MERGE_ASSIGNMENTS": {
      const merged = mergeAssignments(Object.values(state.assignments));
      const newAssignments = { ...state.assignments };
      Object.keys(newAssignments).forEach(key => newAssignments[key] = merged);
      const sig = JSON.stringify(Object.entries(newAssignments).sort(([a], [b]) => a.localeCompare(b)));
      return { ...state, assignments: newAssignments, assignmentSignature: sig };
    }
    case "UPDATE_CONSTRAINTS": {
      const constraints = { ...state.constraints };
      const guestCons = { ...(constraints[action.payload.guestName] ?? {}) };
      action.payload.constraints.forEach((name: string) => guestCons[name] = action.payload.kind);
      constraints[action.payload.guestName] = guestCons;
      return { ...state, constraints, seatingPlans: [], currentPlanIndex: 0 };
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
        const ids = assignments[key].split(',').map(Number).filter(n => !Number.isNaN(n) && n !== id);
        assignments[key] = ids.sort((a, b) => a - b).join(',');
      });
      const sig = JSON.stringify(Object.entries(assignments).sort(([a], [b]) => a.localeCompare(b)));
      return { ...state, tables, assignments, seatingPlans: [], currentPlanIndex: 0, userSetTables: true, assignmentSignature: sig };
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
    case "SET_WARNING":
      return { ...state, conflictWarnings: [...(state.conflictWarnings ?? []), action.payload] };
    case "CLEAR_WARNING":
      return { ...state, conflictWarnings: [] };
    case "AUTO_RECONCILE_TABLES":
      return { ...state, tables: reconcileTables(state.tables, state.guests, state.assignments, state.userSetTables) };
    case "LOAD_MOST_RECENT": {
      const loaded = action.payload;
      const normalizedAssignments: Assignments = {};
      Object.entries(loaded.assignments ?? {}).forEach(([key, raw]) => {
        if (raw) {
          const norm = normalizeAssignmentInputToIdsWithWarnings(raw, loaded.tables ?? []);
          normalizedAssignments[key] = norm.idsCsv;
        } else {
          normalizedAssignments[key] = '';
        }
      });
      const sig = JSON.stringify(Object.entries(normalizedAssignments).sort(([a], [b]) => a.localeCompare(b)));
      return {
        ...state,
        ...loaded,
        assignments: normalizedAssignments,
        assignmentSignature: sig,
        loadedSavedSetting: false,
      };
    }
    case "LOAD_SAVED_SETTING": {
      const loaded = action.payload;
      const normalizedAssignments: Assignments = {};
      let loadWarns: string[] = [];
      Object.entries(loaded.assignments ?? {}).forEach(([key, raw]) => {
        if (raw) {
          const norm = normalizeAssignmentInputToIdsWithWarnings(raw, loaded.tables ?? []);
          normalizedAssignments[key] = norm.idsCsv;
          if (norm.unknownTokens.length > 0) {
            loadWarns.push(`Unknown tables for ${key}: ${norm.unknownTokens.join(', ')}`);
          }
        } else {
          normalizedAssignments[key] = '';
        }
      });
      const sig = JSON.stringify(Object.entries(normalizedAssignments).sort(([a], [b]) => a.localeCompare(b)));
      if (loadWarns.length > 0) {
        return {
          ...state,
          ...loaded,
          assignments: normalizedAssignments,
          assignmentSignature: sig,
          loadedSavedSetting: true,
          conflictWarnings: [...(state.conflictWarnings ?? []), ...loadWarns],
        };
      }
      return {
        ...state,
        ...loaded,
        assignments: normalizedAssignments,
        assignmentSignature: sig,
        loadedSavedSetting: true,
      };
    }
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

  useEffect(() => {
    if (!state.user || !authChanged) return;
    supabase.from("subscriptions").select("*").eq("user_id", state.user.id).single().then(({ data, error }) => {
      if (error) console.error("Subscription error:", error);
      else dispatch({ type: "SET_SUBSCRIPTION", payload: data });
    });
  }, [state.user, authChanged]);

  useEffect(() => {
    const totalNeeded = totalSeatsNeeded(state.guests);
    const totalCap = calculateTotalCapacity(state.tables);
    const short = totalCap < totalNeeded;
    if (short && state.userSetTables) {
      dispatch({ type: "SET_WARNING", payload: `Capacity short (${totalCap} seats for ${totalNeeded} guests). Add tables or adjust.` });
    } else if (!short) {
      dispatch({ type: "CLEAR_WARNING" });
    } else if (short && !state.userSetTables) {
      dispatch({ type: "AUTO_RECONCILE_TABLES" });
    }
  }, [state.guests, state.tables, state.userSetTables, dispatch]);

  useEffect(() => {
    if (!state.userSetTables) {
      dispatch({ type: "AUTO_RECONCILE_TABLES" });
    }
  }, [state.guests, state.tables, state.assignments, state.userSetTables, dispatch]);

  useEffect(() => {
    if (!state.user) return;
    saveMostRecentState(state.user.id, { ...state, loadedSavedSetting: false }).catch(console.error);
  }, [state, state.user]);

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

export const useApp = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppProvider");
  return context;
};