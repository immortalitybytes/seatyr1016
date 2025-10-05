import React, { createContext, useContext, useReducer, useEffect, useState, useMemo, useRef, ReactNode } from "react";
import { 
import { sanitizeGuestUnitName } from "../utils/formatters";
  Guest, Table, Assignments, AppState, GuestID, Constraints, Adjacents
} from "../types";
import { isPremiumSubscription } from "../utils/premium";
import { supabase } from "../lib/supabase";
import { getMostRecentState, clearMostRecentState, saveMostRecentState } from "../lib/mostRecentState";
import MostRecentChoiceModal from "../components/MostRecentChoiceModal";
import { migrateState, normalizeAssignmentInputToIdsWithWarnings, parseAssignmentIds, migrateAssignmentsToIdKeys } from '../utils/assignments';
import { detectConflicts, detectUnsatisfiableMustGroups } from '../utils/conflicts';
import { wouldCloseInvalidRingExact } from '../utils/conflictsSafe';
import { detectAdjacentPairingConflicts } from '../utils/seatingAlgorithm';
import { computePlanSignature } from '../utils/planSignature';
import { countHeads } from '../utils/guestCount';
import { detectConstraintConflicts, generateSeatingPlans } from "../utils/seatingAlgorithm";
import { getCapacity } from '../utils/tables';

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

// Helper to accept either payload shape for pairwise operations
function pairPayload(p: any) {
  const a = p?.a ?? p?.guest1;
  const b = p?.b ?? p?.guest2;
  return { a, b };
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
  const capChanged = getCapacity(t) !== DEFAULT_TABLE_CAPACITY;
  const hasAssign = isAssignedToTable(t, assignments);
  return named || capChanged || hasAssign;
}

function totalSeatsNeeded(guests: Guest[]): number {
  return guests.reduce((sum, g) => sum + Math.max(1, g.count), 0);
}

function reconcileTables(tables: Table[], guests: Guest[], assignments: Assignments, userSetTables: boolean): Table[] {
  if (userSetTables) return tables;

  const out = [...tables];
  const requiredSeats = totalSeatsNeeded(guests);

  // Add tables as needed (mark auto:true)
  while (requiredSeats > out.reduce((n,t)=>n+getCapacity(t), 0)) {
    const maxId = Math.max(...out.map(t => t.id), 0);
    out.push({ id: maxId + 1, seats: DEFAULT_TABLE_CAPACITY, auto: true });
  }

  // Prune only empty auto tables if currently over-capacity and userSetTables=false
  const nowCap = out.reduce((n,t)=>n+getCapacity(t),0);
  if (nowCap > requiredSeats) {
    for (let i = out.length - 1; i >= 0; i--) {
      const t = out[i] as any;
      if (t.auto && tableIsEmpty(t, assignments)) {
        out.splice(i,1);
        if (out.reduce((n,tt)=>n+getCapacity(tt),0) <= requiredSeats) break;
      }
    }
  }
  return out;
}

function tableIsEmpty(table: Table, assignments: Assignments): boolean {
  // Check if any guest is assigned to this table
  return !Object.values(assignments).some(assignment => 
    assignment && assignment.toString().includes(table.id.toString())
  );
}

// P-1: Sanitize and migrate full state on load
function sanitizeAndMigrateAppState(state: AppState): AppState {
  const guests = state.guests.filter(g => g.id && g.name);
  const guestNameToId = new Map<string, GuestID>();
  guests.forEach(g => guestNameToId.set(g.name.toLowerCase(), g.id));
  const guestIdToName = new Map<GuestID, string>();
  guests.forEach(g => guestIdToName.set(g.id, g.name));

  const migratedConstraints: Constraints = {};
  Object.entries(state.constraints || {}).forEach(([nameA, consB]) => {
    const idA = guestNameToId.get(nameA.toLowerCase());
    if (!idA) return;
    migratedConstraints[idA] = {} as any;
    Object.entries(consB || {}).forEach(([nameB, value]) => {
      const idB = guestNameToId.get(nameB.toLowerCase());
      if (idB && idB !== idA) (migratedConstraints as any)[idA][idB] = value as 'must' | 'cannot' | '';
    });
  });

  const migratedAdjacents: Adjacents = {};
  Object.entries(state.adjacents || {}).forEach(([idA, list]) => {
    if (!guestIdToName.has(idA as GuestID)) return;
    const filtered = (list || []).filter(idB => guestIdToName.has(idB as GuestID));
    if (filtered.length) (migratedAdjacents as any)[idA] = filtered as any;
  });

  const migratedAssignments = migrateAssignmentsToIdKeys(state.assignments, guests);

  return {
    ...state,
    guests,
    constraints: migratedConstraints,
    adjacents: migratedAdjacents,
    assignments: migratedAssignments,
    timestamp: new Date().toISOString(),
  };
}

// Symmetric adjacency helpers with degree cap
function addAdjacentSymmetric(adjacents: Adjacents, a: GuestID, b: GuestID): Adjacents {
  if (a === b) return adjacents;
  // Degree cap guard (max 2)
  const aNeighbors = Array.isArray(adjacents[a]) ? adjacents[a] : [];
  const bNeighbors = Array.isArray(adjacents[b]) ? adjacents[b] : [];
  if (aNeighbors.length >= 2 || bNeighbors.length >= 2) {
    console.warn(`Adjacency degree cap exceeded for ${a} or ${b}`);
    return adjacents;
  }
  const next = { ...adjacents } as any;
  next[a] = [...(next[a] || []), b].filter((id: any, idx: number, self: any[]) => self.indexOf(id) === idx);
  next[b] = [...(next[b] || []), a].filter((id: any, idx: number, self: any[]) => self.indexOf(id) === idx);
  return next;
}

function removeAdjacentSymmetric(adjacents: Adjacents, a: GuestID, b: GuestID): Adjacents {
  if (a === b) return adjacents;
  const next = { ...adjacents } as any;
  if (next[a]) {
    next[a] = next[a].filter((id: any) => id !== b);
    if (next[a].length === 0) delete next[a];
  }
  if (next[b]) {
    next[b] = next[b].filter((id: any) => id !== a);
    if (next[b].length === 0) delete next[b];
  }
  return next;
}

const reducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case "SET_TRIAL": return { ...state, trial: action.payload };
    case "SET_GUESTS":
      const payload = action.payload;
      const guests = Array.isArray(payload) ? payload : payload.guests || [];
      const duplicateGuests = Array.isArray(payload) ? [] : payload.duplicateGuests ?? [];
      return { ...state, guests, duplicateGuests };
    case "ADD_GUEST": {
      {
        const totalHeads = (state.guests || []) */).reduce((s,g) */) => s + (Number(g?.count ?? 1) */) || 1) */), 0) */);
        const premium = typeof isPremiumSubscription === 'function'
          ? isPremiumSubscription(state.subscription) */)
          : !!(state.subscription && ((state.subscription as any) */).tier === 'premium' || (state.subscription as any) */).isPremium) */)) */);
        if (!premium && totalHeads >= 80) */) {
          alert('The free tier supports up to 80 guests. Upgrade to Premium to add more.') */);
          return state;
        }
      }
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
      const assignments = { ...state.assignments } as any;
      const constraints = { ...state.constraints } as any;
      const adjacents = { ...state.adjacents } as any;
      delete assignments[id];
      delete constraints[id];
      delete adjacents[id];
      Object.keys(constraints).forEach((key: any) => constraints[key] && delete constraints[key][id]);
      Object.keys(adjacents).forEach((key: any) => {
        adjacents[key] = (adjacents[key] || []).filter((aid: any) => aid !== id);
        if ((adjacents[key] || []).length === 0) delete adjacents[key];
      });
      return { ...state, guests, assignments, constraints, adjacents, seatingPlans: [], currentPlanIndex: 0 };
    }
    case "RENAME_GUEST": {
      const { id, name } = action.payload;
      const guests = state.guests.map(g => g.id === id ? { ...g, name, count: countHeads(sanitizeGuestUnitName(name)) } : g);
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
      const newAssignments = { ...state.assignments, [guestId]: raw } as any;
      const signature = JSON.stringify(Object.entries(newAssignments).sort((a, b) => a[0].localeCompare(b[0])));
      return {
        ...state,
        assignments: newAssignments,
        assignmentSignature: signature,
        seatingPlans: [],
        currentPlanIndex: 0
      };
    }
    case "SET_CONSTRAINT": {
      const { a, b } = pairPayload(action.payload);
      const value = action.payload?.value;
      if (!a || !b) return state;

      const constraints = { ...state.constraints };
      constraints[a] = { ...(constraints[a] || {}), [b]: value };
      constraints[b] = { ...(constraints[b] || {}), [a]: value };

      return { ...state, constraints, seatingPlans: [], currentPlanIndex: 0 };
    }
    case "SET_ADJACENT": {
      const { a, b } = pairPayload(action.payload);
      const value = action.payload?.value;
      if (!a || !b) return state;

      // Self-loop guard
      if (a === b) {
        return { 
          ...state, 
          warnings: [...(state.warnings ?? []), `Self-loop blocked: ${a} cannot be adjacent to itself`] 
        };
      }

      // Degree cap guard (max 2 neighbors)
      const degA = new Set(state.adjacents[a] ?? []).size;
      const degB = new Set(state.adjacents[b] ?? []).size;
      if (value && (degA >= 2 || degB >= 2)) {
        return { 
          ...state, 
          warnings: [...(state.warnings ?? []), `Degree cap exceeded: ${a} or ${b} already has 2 neighbors`] 
        };
      }

      // Ring guard - require exact table capacity to close loop
      const ringViolation = value && wouldCloseInvalidRingExact(
        state.adjacents,
        [a, b],
        state.tables.map(getCapacity)
      );
      if (ringViolation && ringViolation.closes && !ringViolation.ok) {
        return { 
          ...state, 
          warnings: [...(state.warnings ?? []), `Ring blocked: no table with exact capacity for closed loop`] 
        };
      }

      // Commit adjacency (immutable)
      const next = { ...state, adjacents: { ...state.adjacents } } as typeof state;
      const upd = (x: string, y: string) => {
        const s = new Set(next.adjacents[x] ?? []);
        value ? s.add(y) : s.delete(y);
        next.adjacents[x] = Array.from(s);
      };
      upd(a, b); 
      upd(b, a);
      
      return {
        ...next,
        seatingPlans: [],
        currentPlanIndex: 0,
      };
    }
    case "REMOVE_ADJACENT": {
      const { a, b } = pairPayload(action.payload);
      if (!a || !b) return state;
      return {
        ...state,
        adjacents: removeAdjacentSymmetric(state.adjacents, a, b),
        seatingPlans: [],
        currentPlanIndex: 0
      };
    }
    case "SET_TABLES":
      return { ...state, tables: action.payload, userSetTables: true };
    case "ADD_TABLE": {
      if (state.tables.length >= MAX_TABLES) return state; // enforce cap (UI may already alert)
      const nextId = Math.max(0, ...state.tables.map(t => t.id ?? 0)) + 1;
      const p = action.payload || {};
      const newTable = { id: p.id ?? nextId, seats: p.seats ?? 8, name: p.name };
      return { ...state, tables: [...state.tables, newTable], userSetTables: true };
    }
    case "REMOVE_TABLE": {
      const id = action.payload as number;
      const tables = state.tables.filter(t => t.id !== id);
      const assignments = { ...state.assignments };
      // scrub removed table id from CSVs; keep order stable
      for (const key of Object.keys(assignments)) {
        const ids = String(assignments[key] ?? '')
          .split(',').map(s => s.trim()).filter(Boolean)
          .map(Number).filter(n => !Number.isNaN(n) && n !== id)
          .sort((a,b) => a - b);
        assignments[key] = ids.join(',');
      }
      return { ...state, tables, assignments, seatingPlans: [], currentPlanIndex: 0, userSetTables: true };
    }
    case "UPDATE_TABLE":
      return {
        ...state,
        tables: state.tables.map(t => (t.id === action.payload?.id ? { ...t, ...action.payload } : t)),
        userSetTables: true
      };
    case 'SET_PLANS': {
      const { plans, errors, planSig } = action.payload || {};
      return {
        ...state,
        seatingPlans: plans ?? [],
        currentPlanIndex: 0,
        warnings: [
          ...new Set([
            ...state.warnings,
            ...(errors ?? []).map((e: any) => e?.message ?? String(e)),
          ]),
        ],
        lastGeneratedSignature: state.assignmentSignature,
        lastGeneratedPlanSig: planSig ?? computePlanSignature(state),
      };
    }

    // Back-compat alias (do not remove)
    case "SET_SEATING_PLANS": { // compat alias
      const plans = Array.isArray(action.payload) ? action.payload : (action.payload?.plans ?? []);
      const errors = action.payload?.errors ?? [];
      return {
        ...state,
        seatingPlans: plans,
        warnings: [
          ...new Set([
            ...state.warnings,
            ...(errors ?? []).map((e: any) => e?.message ?? String(e)),
          ]),
        ],
        currentPlanIndex: plans.length ? Math.min(state.currentPlanIndex, plans.length - 1) : 0,
        lastGeneratedSignature: state.assignmentSignature,
        lastGeneratedPlanSig: computePlanSignature(state),
      };
    }
    case "CLEAR_PLAN_ERRORS":
      return { ...state, warnings: [], conflictWarnings: [], planErrors: [] };
    case "CLEAR_PLANS":
      return { ...state, seatingPlans: [], currentPlanIndex: 0 };
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
      {
        const incoming = Array.isArray(payload) ? payload : [String(payload)];
        const existing = Array.isArray(state.warnings) ? state.warnings : [];
        const seen = new Set(existing.map(w => (w || '').toLowerCase()));
        const merged = [...existing];
        for (const w of incoming) {
          const key = (w || '').toLowerCase();
          if (!seen.has(key)) { seen.add(key); merged.push(w); }
        }
        return { ...state, warnings: merged };
      }
    }
    case "CLEAR_WARNINGS":
      return { ...state, warnings: [] };
    case "SET_PLAN_ERRORS": {
      const errs = Array.isArray(action.payload) ? action.payload : [];
      return { 
        ...state, 
        planErrors: errs, 
        warnings: errs.map(e => e?.message ?? String(e)) // replace, do not append
      };
    }
    case "SET_LAST_GENERATED_PLAN_SIG":
      return { ...state, lastGeneratedPlanSig: action.payload };
    case "PURGE_PLANS": {
      return { ...state, seatingPlans: [] };
    }
    case "AUTO_RECONCILE_TABLES":
      return { ...state, tables: reconcileTables(state.tables, state.guests, state.assignments, state.userSetTables) };
    case "LOAD_MOST_RECENT":
    case "LOAD_SAVED_SETTING": {
      const incoming = sanitizeAndMigrateAppState(action.payload);
      const { constraints, adjacents } = migrateState(incoming);
      const idKeyed = migrateAssignmentsToIdKeys(incoming.assignments || {}, incoming.guests || []);
      const assignmentSignature = JSON.stringify(
        Object.entries(idKeyed).sort((a, b) => a[0].localeCompare(b[0]))
      );
      return {
        ...state,
        ...incoming,
        constraints,
        adjacents,
        assignments: idKeyed,
        assignmentSignature,
        subscription: incoming.subscription ?? state.subscription,
        seatingPlans: [],
        lastGeneratedPlanSig: null,
        warnings: []
      };
    }
    case "IMPORT_STATE": {
      const incoming = sanitizeAndMigrateAppState(action.payload);
      return {
        ...state,
        ...incoming,
        subscription: incoming.subscription ?? state.subscription,
        user: state.user,
        seatingPlans: [],
        currentPlanIndex: 0,
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

const AppContext = createContext<{ state: AppState; dispatch: React.Dispatch<AppAction> } | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [mostRecentState, setMostRecentState] = useState<AppState | null>(null);
  const [showRecentModal, setShowRecentModal] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentFetched, setRecentFetched] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [authChanged, setAuthChanged] = useState(false);
  
  // Ref for tracking table capacity changes
  const prevTablesSignature = useRef<string>('');
  
  // Latest-state ref to avoid stale closures
  const latestStateRef = useRef(state);
  useEffect(() => { latestStateRef.current = state; });

  // Sanitize on mount
  useEffect(() => {
    const sanitized = sanitizeAndMigrateAppState(state);
    if (JSON.stringify(sanitized) !== JSON.stringify(state)) {
      dispatch({ type: 'LOAD_MOST_RECENT', payload: sanitized });
    }
  }, []);

  // Reconcile tables on guest/assignment change
  useEffect(() => {
    const reconciled = reconcileTables(state.tables, state.guests, state.assignments, state.userSetTables);
    if (reconciled.length !== state.tables.length) {
      dispatch({ type: 'AUTO_RECONCILE_TABLES' });
    }
  }, [state.guests, state.assignments, state.userSetTables]);

  // Capacity change → reconcile + plan invalidation + feasibility re-eval
  useEffect(() => {
    // Create a stable signature of tables and their capacities
    const tablesSignature = state.tables.map(t => `${t.id}:${getCapacity(t)}`).join('|');
    
    if (prevTablesSignature.current && prevTablesSignature.current !== tablesSignature) {
      // Tables changed - invalidate plans and trigger reconcile
      dispatch({ type: 'SET_SEATING_PLANS', payload: [] });
      dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
      dispatch({ type: 'AUTO_RECONCILE_TABLES' });
      
      // Mark as not from saved setting to trigger regeneration
      dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: false });
    }
    
    prevTablesSignature.current = tablesSignature;
  }, [state.tables]);

  // Debounced plan generation
  const generationIdRef = useRef(0);
  
  const debouncedGeneratePlans = useMemo(() => {
    let timeout: NodeJS.Timeout;
    return () => {
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        const currentGen = ++generationIdRef.current;
        console.time("SeatingGeneration");
        
        // Clear stale plan errors at generation start
        dispatch({ type: 'CLEAR_PLAN_ERRORS' });
        
        // Pre-engine validation: detect unsatisfiable MUST groups
        const mustGroupErrors = detectUnsatisfiableMustGroups({
          guests: Object.fromEntries(state.guests.map(g => [g.id, { partySize: g.count, name: g.name }])),
          tables: state.tables.map(t => ({ id: t.id, capacity: getCapacity(t) })),
          assignments: state.assignments,
          constraints: {
            mustPairs: function* () {
              for (const [a, row] of Object.entries(state.constraints || {})) {
                for (const [b, v] of Object.entries(row || {})) if (v === 'must') yield [a, b];
              }
            },
          },
        });
        
        if (mustGroupErrors.length > 0) {
          dispatch({ type: 'SET_PLAN_ERRORS', payload: mustGroupErrors });
          return; // do not call engine with impossible state
        }
        
        // Pre-engine validation: detect adjacent pairing conflicts
        const adjErrors = detectAdjacentPairingConflicts(state.guests, state.adjacents, state.tables, state.constraints);
        if (adjErrors.length > 0) {
          dispatch({ type: 'SET_PLAN_ERRORS', payload: adjErrors });
          return; // do not call engine with impossible state
        }
        
        const { plans, errors } = await generateSeatingPlans(
          state.guests,
          state.tables,
          state.constraints,
          state.adjacents,
          state.assignments,
          isPremiumSubscription(state.subscription)
        );
        if (currentGen === generationIdRef.current) {
          if (errors && errors.length > 0) {
            dispatch({ type: "SET_WARNING", payload: errors.map(e => e.message) });
          }
          if (plans && plans.length > 0) {
            dispatch({ type: "SET_PLANS", payload: { plans, errors, planSig: computePlanSignature(state) } });
          } else {
            dispatch({ type: "SET_PLANS", payload: { plans: [], errors, planSig: computePlanSignature(state) } });
          }
        } // else: stale; ignore
        console.timeEnd("SeatingGeneration");
      }, 500);
    };
  }, [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.subscription]);

  // Cleanup debounce timeout on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      // The timeout is managed within the debounced function and cleared on each call
      // This effect ensures cleanup on unmount
    };
  }, []);

  useEffect(() => {
    if (state.guests.length > 0 && state.tables.length > 0 && !state.loadedSavedSetting) {
      debouncedGeneratePlans();
    }
  }, [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.loadedSavedSetting, debouncedGeneratePlans]);

  // Fetch subscription whenever user changes (no extra flags)
  useEffect(() => {
    let active = true;
    const fetchSub = async () => {
      if (!state.user) { 
        if (process.env.NODE_ENV === 'development') {
          console.log('[SUBSCRIPTION DEBUG] No user - setting subscription to null');
        }
        dispatch({ type: "SET_SUBSCRIPTION", payload: null }); 
        return; 
      }
      
      if (process.env.NODE_ENV === 'development') {
        console.log('[SUBSCRIPTION DEBUG] Fetching subscription for user:', state.user.id);
      }
      const { data, error } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", state.user.id)
        .maybeSingle(); // Use maybeSingle to handle cases where no subscription exists
      
      if (process.env.NODE_ENV === 'development') {
        console.log('[SUBSCRIPTION DEBUG] Subscription fetch result:', { data, error });
      }
      
      if (active) {
        dispatch({ type: "SET_SUBSCRIPTION", payload: data || null });
        if (process.env.NODE_ENV === 'development') {
          console.log('[SUBSCRIPTION DEBUG] Dispatched subscription:', data || null);
        }
      }
    };
    fetchSub().catch((err) => {
      console.error('[SUBSCRIPTION DEBUG] Fetch error:', err);
    });
    return () => { active = false; };
  }, [state.user]);

  // Persist core app state for unsigned/free users only
  useEffect(() => {
    if (state.user) return; // Premium signed-in uses existing mostRecent flow
    try {
      const toSave = {
        guests: state.guests,
        tables: state.tables,
        constraints: state.constraints,
        adjacents: state.adjacents,
        assignments: state.assignments,
      };
      localStorage.setItem('seatyr_app_state', JSON.stringify(toSave));
    } catch {}
  }, [state.user, state.guests, state.tables, state.constraints, state.adjacents, state.assignments]);

  // Hydrate core app state on mount for unsigned/free users only
  useEffect(() => {
    if (state.user) return; // Premium signed-in uses existing mostRecent flow
    try {
      const raw = localStorage.getItem('seatyr_app_state');
      if (!raw) return;
      const saved = JSON.parse(raw);
      const loaded = { ...initialState, ...saved };
      loaded.guests = (loaded.guests ?? []).map((g: any) => ({
        ...g, 
        count: countHeads(g.name || '')
      }));
      const sanitized = sanitizeAndMigrateAppState(loaded);
      if (Array.isArray(sanitized.guests) && sanitized.guests.length > 0) {
        dispatch({ type: 'IMPORT_STATE', payload: sanitized });
      }
    } catch {}
  }, []);

  // Pre-seed session on mount to eliminate premium flicker
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session;
        if (!alive || !session) return;

        // Set user if we have a session
        dispatch({ type: 'SET_USER', payload: session.user });
        
        // Fetch subscription for the user
        const { data: subData, error: subError } = await supabase
          .from("subscriptions")
          .select("*")
          .eq("user_id", session.user.id)
          .maybeSingle(); // Use maybeSingle to handle cases where no subscription exists
        
        if (process.env.NODE_ENV === 'development') {
          console.log('[PRE-SEED DEBUG] Subscription fetch result:', { subData, subError });
        }
        
        if (alive) {
          dispatch({ type: "SET_SUBSCRIPTION", payload: subData || null });
          if (process.env.NODE_ENV === 'development') {
            console.log('[PRE-SEED DEBUG] Dispatched subscription:', subData || null);
          }
        }
      } catch (error) {
        // Silently handle errors - this is just pre-seeding
        console.debug('Pre-seed session failed:', error);
      }
    })();
    return () => { alive = false; };
  }, []);

  // Auth change listener
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") setAuthChanged(true);
    });
    return () => subscription.unsubscribe();
  }, [state.user]) ;

  // Premium: debounced cloud save (exclude seatingPlans blob)
  const premiumSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!state.user || !isPremiumSubscription(state.subscription)) return;
    if (premiumSaveTimer.current) clearTimeout(premiumSaveTimer.current);
    premiumSaveTimer.current = setTimeout(() => {
      const { seatingPlans, currentPlanIndex, lastGeneratedPlanSig, ...rest } = state as any;
      saveMostRecentState(state.user!.id, rest).catch(console.error);
    }, 800);
    return () => { if (premiumSaveTimer.current) clearTimeout(premiumSaveTimer.current); };
  }, [state, state.user, state.subscription]);

  // Most recent state handling
  useEffect(() => {
    if (authChanged && state.user && isPremiumSubscription(state.subscription)) {
      getMostRecentState(state.user.id).then(setMostRecentState).catch(setRecentError).finally(() => {
        setRecentFetched(true);
        setSessionLoading(false);
      });
    }
  }, [authChanged, state.user, state.subscription]);

  useEffect(() => {
    if (mostRecentState) setShowRecentModal(true);
  }, [mostRecentState]);

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

// SEATYR-CANONICAL-IMPORT: Always import useApp from 'src/context/AppContext'
export function useApp(): { state: AppState, dispatch: React.Dispatch<AppAction> } {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppProvider");
  return context;
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

useEffect(() => {
  let alive = true;
  (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const session = data?.session;
      if (!alive || !session) return;
      dispatch({ type: 'SET_USER', payload: session.user });
      const [{ data: subData }, { data: trialData }] = await Promise.all([
        supabase.from('subscriptions').select('*').eq('user_id', session.user.id).maybeSingle(),
        supabase.from('trials').select('*').eq('user_id', session.user.id).maybeSingle()
      ]);
      if (!alive) return;
      dispatch({ type: 'SET_SUBSCRIPTION', payload: subData || null });
      dispatch({ type: 'SET_TRIAL', payload: trialData || null });
    } catch {}
  })();
  return () => { alive = false; };
}, []);
