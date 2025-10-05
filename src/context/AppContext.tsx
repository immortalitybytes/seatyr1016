import React, { createContext, useContext, useReducer, useEffect, useState, useMemo, useRef, ReactNode } from "react";
import { Guest, Table, Assignments, AppState, GuestID, Constraints, Adjacents, TrialSubscription } from "../types";
import { isPremiumSubscription } from "../utils/premium";
import { supabase } from "../lib/supabase";
import { saveMostRecentState } from "../lib/mostRecentState";
import { parseAssignmentIds, migrateAssignmentsToIdKeys } from "../utils/assignments";
import { detectUnsatisfiableMustGroups, formatPlanErrorsWithAssignments } from "../utils/conflicts";
import { wouldCloseInvalidRingExact } from "../utils/conflictsSafe";
import { computePlanSignature } from "../utils/planSignature";
import { countHeads } from "../utils/guestCount";
import { sanitizeGuestUnitName } from "../utils/formatters";
import { generateSeatingPlans } from "../utils/seatingAlgorithm";
import { getCapacity as _getCapacity } from "../utils/tables";

const DEFAULT_TABLE_CAPACITY = 8;
const ADJACENCY_MAX_DEGREE = 2;
const MAX_TABLES = 100;

/** Safe capacity reader that never throws at import/boot time. */
function capOf(t: { seats?: number; capacity?: number } & Record<string, any>): number {
  // Prefer the utility if available, but never rely on the bare global symbol
  try {
    if (typeof _getCapacity === 'function') {
      return Number(_getCapacity(t)) || DEFAULT_TABLE_CAPACITY;
    }
  } catch {}
  // Fallbacks if the util isn't ready or was tree-shaken:
  if (Number.isFinite(t.capacity)) return Number(t.capacity);
  if (Number.isFinite(t.seats)) return Number(t.seats);
  return DEFAULT_TABLE_CAPACITY;
}

const defaultTables: Table[] = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, seats: DEFAULT_TABLE_CAPACITY }));

interface AppAction { type: string; payload?: any; }
function pairPayload(p: any) { const a = p?.a ?? p?.guest1; const b = p?.b ?? p?.guest2; return { a, b }; }

function isAssignedToTable(t: Table, assignments: Assignments): boolean {
  const tName = (t.name ?? "").trim().toLowerCase();
  for (const raw of Object.values(assignments)) {
    if (!raw) continue;
    const tokens = String(raw).split(",").map(s => s.trim()).filter(Boolean);
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
  const capChanged = capOf(t) !== DEFAULT_TABLE_CAPACITY;
  const hasAssign = isAssignedToTable(t, assignments);
  return named || capChanged || hasAssign;
}
function totalSeatsNeeded(guests: Guest[]): number {
  return guests.reduce((sum, g) => sum + Math.max(1, g.count ?? 1), 0);
}

// Auto-reconcile with safe reduction of untouched default tables
function reconcileTables(tables: Table[], guests: Guest[], assignments: Assignments, userSetTables: boolean): Table[] {
  if (userSetTables) return tables;

  const needed = totalSeatsNeeded(guests);
  const locked: Table[] = [];
  const untouched: Table[] = [];
  let lockedCap = 0;

  for (const t of tables) {
    if (isTableLocked(t, assignments)) {
      locked.push(t);
      lockedCap += capOf(t);
    } else {
      untouched.push(t);
    }
  }

  const remainingNeededSeats = Math.max(0, needed - lockedCap);
  const neededUntouchedCount = Math.ceil(remainingNeededSeats / DEFAULT_TABLE_CAPACITY);
  const delta = neededUntouchedCount - untouched.length;

  if (delta > 0) {
    const maxId = tables.reduce((m, t) => Math.max(m, t.id), 0);
    const add = Array.from({ length: delta }, (_, i) => ({ id: maxId + i + 1, seats: DEFAULT_TABLE_CAPACITY }));
    return [...locked, ...untouched, ...add];
  }
  if (delta < 0) {
    const dropCount = Math.min(untouched.length, Math.abs(delta));
    const kept = [...untouched].sort((a, b) => b.id - a.id).slice(dropCount);
    return [...locked, ...kept];
  }
  return tables;
}

// Migration helpers (name→id keying)
function sanitizeAndMigrateAppState(state: AppState): AppState {
  const guests = state.guests.filter(g => g.id && g.name);
  const nameToId = new Map<string, GuestID>(guests.map(g => [g.name.toLowerCase(), g.id]));
  const idToName = new Map<GuestID, string>(guests.map(g => [g.id, g.name]));

  const migratedConstraints: Constraints = {};
  Object.entries(state.constraints || {}).forEach(([nameA, consB]) => {
    const idA = nameToId.get(nameA.toLowerCase());
    if (!idA) return;
    migratedConstraints[idA] = {} as any;
    Object.entries(consB || {}).forEach(([nameB, v]) => {
      const idB = nameToId.get(nameB.toLowerCase());
      if (idB && idB !== idA) (migratedConstraints as any)[idA][idB] = v as any;
    });
  });

  const migratedAdjacents: Adjacents = {};
  Object.entries(state.adjacents || {}).forEach(([idA, list]) => {
    if (!idToName.has(idA as GuestID)) return;
    const filtered = (list || []).filter(idB => idToName.has(idB as GuestID));
    if (filtered.length) (migratedAdjacents as any)[idA] = filtered as any;
  });

  const migratedAssignments = migrateAssignmentsToIdKeys(state.assignments, guests);

  return { ...state, guests, constraints: migratedConstraints, adjacents: migratedAdjacents, assignments: migratedAssignments, timestamp: new Date().toISOString() };
}

function addAdjacentSymmetric(adjacents: Adjacents, a: GuestID, b: GuestID): Adjacents {
  if (a === b) return adjacents;
  const next = { ...adjacents } as any;
  next[a] = [...(next[a] || []), b].filter((id: any, i: number, s: any[]) => s.indexOf(id) === i);
  next[b] = [...(next[b] || []), a].filter((id: any, i: number, s: any[]) => s.indexOf(id) === i);
  return next;
}
function removeAdjacentSymmetric(adjacents: Adjacents, a: GuestID, b: GuestID): Adjacents {
  if (a === b) return adjacents;
  const next = { ...adjacents } as any;
  if (next[a]) next[a] = next[a].filter((id: any) => id !== b);
  if (next[b]) next[b] = next[b].filter((id: any) => id !== a);
  return next;
}

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "LOAD_MOST_RECENT": {
      const m = action.payload || {};
      return { ...state, guests: m.guests || state.guests, tables: m.tables || state.tables, constraints: m.constraints || state.constraints, adjacents: m.adjacents || state.adjacents, assignments: m.assignments || state.assignments, seatingPlans: m.seatingPlans || [], currentPlanIndex: 0, lastGeneratedSignature: null, loadedSavedSetting: false, trial: m.trial || state.trial };
    }
    case "SET_USER": return { ...state, user: action.payload };
    case "SET_SUBSCRIPTION": return { ...state, subscription: action.payload };
    case "SET_TRIAL": return { ...state, trial: action.payload };
    case "SET_SUBSCRIPTION_AND_TRIAL": 
      return { 
        ...state, 
        subscription: action.payload.subscription, 
        trial: action.payload.trial 
      };

    case "ADD_GUEST": {
      const id = crypto.randomUUID();
      const rawName = action.payload || `Guest ${state.guests.length + 1}`;
      const name = sanitizeGuestUnitName(rawName);                 // SSOT sanitize first
      const count = countHeads(name);                              // then count
      return { ...state, guests: [...state.guests, { id, name, count }] };
    }
    case "REMOVE_GUEST": {
      const id = action.payload;
      const guests = state.guests.filter(g => g.id !== id);
      const constraints = { ...state.constraints }; delete constraints[id]; Object.values(constraints).forEach(m => delete (m as any)[id]);
      const adjacents = { ...state.adjacents }; delete adjacents[id]; Object.values(adjacents).forEach(list => { const i = (list as any).indexOf(id); if (i >= 0) (list as any).splice(i, 1); });
      const assignments = { ...state.assignments }; delete assignments[id];
      return { ...state, guests, constraints, adjacents, assignments };
    }
    case "UPDATE_GUEST": {
      const { id, name: rawName } = action.payload;
      const name = sanitizeGuestUnitName(rawName);                 // SSOT sanitize first
      const guests = state.guests.map(g => g.id !== id ? g : { ...g, name, count: countHeads(name) }); // then count
      return { ...state, guests };
    }

    case "SET_CONSTRAINT": {
      const { a, b, value } = pairPayload(action.payload);
      if (!a || !b || a === b) return state;
      const next = { ...state.constraints };
      (next as any)[a] = { ...(next as any)[a] ?? {} };
      (next as any)[a][b] = value;
      (next as any)[b] = { ...(next as any)[b] ?? {} };
      (next as any)[b][a] = value;
      return { ...state, constraints: next };
    }
    case "SET_ADJACENT": {
      const { a, b } = pairPayload(action.payload);
      if (!a || !b || a === b) return state;
      const degA = (state.adjacents[a] ?? []).length, degB = (state.adjacents[b] ?? []).length;
      if (degA >= ADJACENCY_MAX_DEGREE || degB >= ADJACENCY_MAX_DEGREE) return { ...state, warnings: [...(state.warnings ?? []), { kind: "adjacency_degree_cap", a, b }] };
      if (wouldCloseInvalidRingExact(state.adjacents, [a, b], state.tables.map(capOf))) return { ...state, warnings: [...(state.warnings ?? []), { kind: "invalid_ring_closure", a, b }] };
      return { ...state, adjacents: addAdjacentSymmetric(state.adjacents, a, b) };
    }
    case "REMOVE_ADJACENT": {
      const { a, b } = pairPayload(action.payload);
      if (!a || !b) return state;
      return { ...state, adjacents: removeAdjacentSymmetric(state.adjacents, a, b) };
    }

    case "SET_ASSIGNMENT": {
      const { guestId, assignment } = action.payload;
      if (!guestId) return state;
      const assignments = { ...state.assignments, [guestId]: assignment };
      const signature = Object.entries(assignments).sort().map(([k, v]) => `${k}:${v}`).join("|");
      return { ...state, assignments, assignmentSignature: signature };
    }
    case "UPDATE_ASSIGNMENTS": {
      const assignments = { ...state.assignments, ...action.payload };
      const signature = Object.entries(assignments).sort().map(([k, v]) => `${k}:${v}`).join("|");
      return { ...state, assignments, assignmentSignature: signature };
    }

    case "ADD_TABLE": {
      if (state.tables.length >= MAX_TABLES) return state;
      const maxId = Math.max(...state.tables.map(t => t.id), 0);
      const table = { id: maxId + 1, seats: DEFAULT_TABLE_CAPACITY, ...action.payload };
      return { ...state, tables: [...state.tables, table], userSetTables: true };
    }
    case "UPDATE_TABLE": {
      const { id, ...updates } = action.payload;
      const tables = state.tables.map(t => t.id !== id ? t : { ...t, ...updates });
      return { ...state, tables, userSetTables: true };
    }
    case "REMOVE_TABLE": {
      const id = action.payload;
      const tables = state.tables.filter(t => t.id !== id);
      const assignments = { ...state.assignments };
      Object.keys(assignments).forEach(k => {
        const assignedIds = String(assignments[k]).split(",").map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);
        assignments[k] = assignedIds.filter(tid => tid !== id).join(",");
        if (!assignments[k]) delete assignments[k];
      });
      return { ...state, tables, assignments, userSetTables: true };
    }

    case "AUTO_RECONCILE_TABLES": {
      const tables = reconcileTables(state.tables, state.guests, state.assignments, state.userSetTables);
      return { ...state, tables };
    }

    case "SET_PLANS":
    case "SET_SEATING_PLANS": {
      const { plans = [], errors = [], planSig = null } = action.payload ?? {};
      return { ...state, seatingPlans: plans, planErrors: errors, currentPlanIndex: plans.length ? Math.min(state.currentPlanIndex, plans.length - 1) : 0, lastGeneratedPlanSig: planSig ?? state.lastGeneratedPlanSig };
    }
    case "SET_PLAN_ERRORS": {
      const errs = action.payload ?? [];
      return { ...state, planErrors: errs, warnings: errs.map((e: any) => e.message ?? String(e)) };
    }
    case "CLEAR_PLAN_ERRORS": return { ...state, planErrors: [], warnings: [] };
    case "SET_CURRENT_PLAN_INDEX": return { ...state, currentPlanIndex: action.payload };
    case "IMPORT_STATE": {
      const imported = action.payload || {};
      const sanitized = sanitizeAndMigrateAppState(imported);
      return { ...state, ...sanitized, seatingPlans: [], currentPlanIndex: 0, loadedSavedSetting: true, lastGeneratedSignature: null };
    }
    case "SET_HIDE_TABLE_REDUCTION_NOTICE": return { ...state, hideTableReductionNotice: action.payload };
    default: return state;
  }
}

const AppContext = createContext<{ state: AppState; dispatch: React.Dispatch<AppAction> } | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [, setSessionLoading] = useState(true);
  const mostRecentRef = useRef<AppState | null>(null);

  useEffect(() => { mostRecentRef.current = state; }, [state]);

  // Debounced generation
  useEffect(() => {
    const needsGen = state.lastGeneratedSignature !== computePlanSignature(state);
    if (!needsGen) return;
    const timer = setTimeout(async () => {
      dispatch({ type: "CLEAR_PLAN_ERRORS" });
      const params = {
        guests: state.guests.map(g => ({ id: g.id, name: g.name ?? "", partySize: g.count ?? countHeads(g.name ?? "") })),
        tables: state.tables.map(t => ({ id: t.id, capacity: capOf(t) })),
        assignments: state.assignments,
        constraints: state.constraints,
        adjacents: state.adjacents,
      };
      const guestsById = new Map(state.guests.map(g => [String(g.id), g.name]));
      const tablesById = new Map(state.tables.map(t => [String(t.id), t.name ? `${t.id} (${t.name})` : `Table ${t.id}`]));
      const mustErrors = detectUnsatisfiableMustGroups(params);
      if (mustErrors.length) {
        const enrichedMust = formatPlanErrorsWithAssignments(mustErrors, state.assignments, guestsById, tablesById);
        dispatch({ type: "SET_PLAN_ERRORS", payload: enrichedMust.map(msg => ({ message: msg })) });
        return;
      }
      try {
        const { plans, errors } = await generateSeatingPlans(params);
        const rawMsgs = (errors ?? []).map((e: any) => e?.message ?? String(e));
        const enriched = formatPlanErrorsWithAssignments(rawMsgs, state.assignments, guestsById, tablesById);
        const planSig = computePlanSignature(state);
        dispatch({ type: "SET_PLANS", payload: { plans, errors: enriched.map(msg => ({ message: msg })), planSig } });
      } catch {
        dispatch({ type: "SET_PLAN_ERRORS", payload: [{ message: "Seating generation failed due to an unknown error." }] });
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.lastGeneratedSignature, state.trial]);

  // Premium/trial users: save Most Recent State
  useEffect(() => {
    if (!state.user) return;
    
    // Use robust premium detection with fallbacks
    const isPremium = isPremiumSubscription(state.subscription, state.trial) || 
                     (state.user && state.subscription && (state.subscription as any).status === 'active');
    
    if (!isPremium) return;
    saveMostRecentState(state.user.id, state).catch(() => {});
  }, [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.user, state.subscription, state.trial]);

  // Pre-seed session → subscription + trial
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session;
        if (!alive || !session) return;
        dispatch({ type: "SET_USER", payload: session.user });
        // Fetch subscription and trial data with robust error handling
        const [subResult, trialResult] = await Promise.allSettled([
          supabase.from("subscriptions").select("*").eq("user_id", session.user.id).maybeSingle(),
          supabase.from("trials").select("*").eq("user_id", session.user.id).maybeSingle(),
        ]);
        
        const subData = subResult.status === 'fulfilled' ? subResult.value.data : null;
        const subError = subResult.status === 'fulfilled' ? subResult.value.error : subResult.reason;
        const trialData = trialResult.status === 'fulfilled' ? trialResult.value.data : null;
        const trialError = trialResult.status === 'fulfilled' ? trialResult.value.error : trialResult.reason;
        if (!alive) return;
        
        // Atomic state update to prevent race conditions
        dispatch({ 
          type: "SET_SUBSCRIPTION_AND_TRIAL", 
          payload: { subscription: subData || null, trial: trialData || null }
        });
      } finally {
        if (alive) setSessionLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);
  
  // Free/unsigned users: persist a core subset to localStorage
  const core = useMemo(() => ({
    guests: state.guests,
    tables: state.tables,
    constraints: state.constraints,
    adjacents: state.adjacents,
    assignments: state.assignments,
  }), [state.guests, state.tables, state.constraints, state.adjacents, state.assignments]);

  useEffect(() => {
    // Only use localStorage for non-premium users
    const isPremium = isPremiumSubscription(state.subscription, state.trial) || 
                     (state.user && state.subscription && (state.subscription as any).status === 'active');
    
    if (state.user || isPremium) return;
    try { localStorage.setItem("seatyr_app_state", JSON.stringify(core)); } catch {}
  }, [state.user, core, state.subscription, state.trial]);

  useEffect(() => {
    // Only load from localStorage for non-premium users
    const isPremium = isPremiumSubscription(state.subscription, state.trial) || 
                     (state.user && state.subscription && (state.subscription as any).status === 'active');
    
    if (state.user || isPremium) return;
    try {
      const raw = localStorage.getItem("seatyr_app_state");
      if (!raw) return;
      const saved = JSON.parse(raw);
      const loaded = { ...initialState, ...saved };
      loaded.guests = (loaded.guests ?? []).map((g: any) => ({ ...g, count: countHeads(g.name || "") }));
      const sanitized = sanitizeAndMigrateAppState(loaded);
      if (Array.isArray(sanitized.guests) && sanitized.guests.length > 0) {
        // hydrate
      }
    } catch {}
  }, [state.user, state.subscription, state.trial]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <AppContext.Provider value={value}>{/* modals as needed */}{children}</AppContext.Provider>;
};

export function useApp(): { state: AppState; dispatch: React.Dispatch<AppAction> } {
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
  lastGeneratedSignature: null,
  lastGeneratedPlanSig: null,
  trial: null,
};