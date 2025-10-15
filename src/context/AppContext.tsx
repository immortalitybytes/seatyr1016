import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useState,
  useMemo,
  useRef,
  ReactNode,
} from "react";

import type { AppState, Guest, Table, Assignments } from "../types";
import { supabase } from "../lib/supabase";
import { isPremiumSubscription, deriveMode, type Mode } from "../utils/premium";
import {
  getMostRecentState,
  clearMostRecentState,
  saveMostRecentState,
} from "../lib/mostRecentState";
import { countHeads } from "../utils/formatters";
import { getCapacity } from "../utils/tables";
import {
  migrateState,
  migrateAssignmentsToIdKeys,
} from "../utils/assignments";
import MostRecentChoiceModal from "../Components/MostRecentChoiceModal";
import { generateSeatingPlans as engineGenerate } from "../utils/seatingAlgorithm";

/**
 * NOTE:
 * - This file implements only the orchestration/safety fixes demanded by the rival reviews.
 * - No UI changes. No tier weakening. All effects are stable, top-level hooks.
 * - All Supabase reads for optional rows are via `.maybeSingle()` to avoid 406.
 */

type AppAction = { type: string; payload?: any };

// ---------- Local helpers (kept minimal & safe) ----------

const DEFAULT_TABLE_CAPACITY = 8;

const defaultTables: Table[] = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  seats: DEFAULT_TABLE_CAPACITY,
}));

function totalSeatsNeeded(guests: Guest[]): number {
  return guests.reduce((sum, g) => sum + Math.max(1, g.count || 1), 0);
}

function isAssignedToTable(assignments: Assignments, t: Table): boolean {
  const tName = (t.name || "").trim().toLowerCase();
  for (const raw of Object.values(assignments || {})) {
    if (!raw) continue;
    const tokens = String(raw)
      .split(/[,\s.]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    for (const token of tokens) {
      const n = Number(token);
      if (!Number.isNaN(n) && n === t.id) return true;
      if (tName && token.toLowerCase() === tName) return true;
    }
  }
  return false;
}

function isTableLocked(t: Table, assignments: Assignments): boolean {
  const named = !!(t.name && t.name.trim());
  const capChanged = getCapacity(t) !== DEFAULT_TABLE_CAPACITY;
  const hasAssign = isAssignedToTable(assignments, t);
  return named || capChanged || hasAssign;
}

function reconcileTables(
  tables: Table[],
  guests: Guest[],
  assignments: Assignments,
  userSetTables: boolean,
): Table[] {
  if (userSetTables) return tables;
  const needed = totalSeatsNeeded(guests);

  let lockedCap = 0;
  for (const t of tables) if (isTableLocked(t, assignments)) lockedCap += getCapacity(t);

  const remaining = Math.max(0, needed - lockedCap);
  const untouched = tables.filter(
    (t) => !isTableLocked(t, assignments) && getCapacity(t) === DEFAULT_TABLE_CAPACITY,
  );
  const delta = Math.ceil(remaining / DEFAULT_TABLE_CAPACITY) - untouched.length;
  if (delta <= 0) return tables;

  const maxId = Math.max(0, ...tables.map((t) => t.id || 0));
  const add: Table[] = Array.from({ length: delta }, (_, i) => ({
    id: maxId + i + 1,
    seats: DEFAULT_TABLE_CAPACITY,
  }));
  return [...tables, ...add];
}

function sanitizeAndMigrateAppState(s: AppState): AppState {
  const guests = (s.guests || []).filter((g) => g && g.id && g.name);
  const migrated = migrateAssignmentsToIdKeys(s.assignments || {}, guests);
  const { constraints, adjacents } = migrateState({ guests, constraints: s.constraints, adjacents: s.adjacents });

  return {
    ...s,
    guests,
    assignments: migrated,
    constraints,
    adjacents,
    timestamp: new Date().toISOString(),
  };
}

// ---------- Reducer (kept compatible; adds SET_TRIAL) ----------

const reducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case "SET_TRIAL":
      return { ...state, trial: action.payload };

    case "SET_GUESTS": {
      const payload = action.payload;
      const guests: Guest[] = Array.isArray(payload) ? payload : payload?.guests || [];
      const duplicateGuests = Array.isArray(payload) ? [] : payload?.duplicateGuests || [];
      return { ...state, guests, duplicateGuests };
    }

    case "ADD_GUEST": {
      const totalHeads = (state.guests || []).reduce((s, g) => s + (Number(g?.count ?? 1) || 1), 0);
      const premium = isPremiumSubscription(state.subscription);
      if (!premium && totalHeads >= 80) {
        alert("The free tier supports up to 80 guests. Upgrade to Premium to add more.");
        return state;
      }
      const guest: Guest = action.payload;
      return {
        ...state,
        guests: [...state.guests, guest],
        duplicateGuests: (state.duplicateGuests || []).filter((n) => n !== guest.name),
      };
    }

    case "REMOVE_GUEST": {
      const id = action.payload;
      const guests = state.guests.filter((g) => g.id !== id);
      const assignments = { ...(state.assignments || {}) };
      const constraints = { ...(state.constraints || {}) };
      const adjacents = { ...(state.adjacents || {}) };

      delete assignments[id];
      delete constraints[id];
      delete adjacents[id];

      Object.keys(constraints).forEach((k) => constraints[k] && delete constraints[k][id]);
      Object.keys(adjacents).forEach((k) => {
        adjacents[k] = (adjacents[k] || []).filter((x: string) => x !== id);
        if ((adjacents[k] || []).length === 0) delete adjacents[k];
      });

      return {
        ...state,
        guests,
        assignments,
        constraints,
        adjacents,
        seatingPlans: [],
        currentPlanIndex: 0,
      };
    }

    case "RENAME_GUEST": {
      const { id, name } = action.payload;
      const guests = state.guests.map((g) =>
        g.id === id ? { ...g, name, count: countHeads(name) } : g,
      );
      return { ...state, guests, seatingPlans: [], currentPlanIndex: 0 };
    }

    case "CLEAR_ALL":
      return {
        ...state,
        guests: [],
        constraints: {},
        adjacents: {},
        assignments: {},
        seatingPlans: [],
        currentPlanIndex: 0,
        warnings: [],
      };

    case "UPDATE_ASSIGNMENT": {
      const { guestId, raw } = action.payload || {};
      const assignments = { ...(state.assignments || {}), [guestId]: raw ?? "" };
      const signature = JSON.stringify(
        Object.entries(assignments).sort((a, b) => a[0].localeCompare(b[0])),
      );
      return {
        ...state,
        assignments,
        assignmentSignature: signature,
        seatingPlans: [],
        currentPlanIndex: 0,
      };
    }

    case "SET_TABLES":
      return { ...state, tables: action.payload, userSetTables: true };

    case "ADD_TABLE": {
      const nextId = Math.max(0, ...state.tables.map((t) => t.id)) + 1;
      const p = action.payload || {};
      const newTable: Table = { id: p.id ?? nextId, seats: p.seats ?? DEFAULT_TABLE_CAPACITY, name: p.name };
      return { ...state, tables: [...state.tables, newTable], userSetTables: true };
    }

    case "REMOVE_TABLE": {
      const id = action.payload as number;
      const tables = state.tables.filter((t) => t.id !== id);
      const assignments = { ...(state.assignments || {}) };
      for (const key of Object.keys(assignments)) {
        const ids = String(assignments[key] ?? "")
          .split(/[,\s.]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map(Number)
          .filter((n) => !Number.isNaN(n) && n !== id)
          .sort((a, b) => a - b);
        assignments[key] = ids.join(",");
      }
      return {
        ...state,
        tables,
        assignments,
        seatingPlans: [],
        currentPlanIndex: 0,
        userSetTables: true,
      };
    }

    case "UPDATE_TABLE":
      return {
        ...state,
        tables: state.tables.map((t) =>
          t.id === action.payload?.id ? { ...t, ...action.payload } : t,
        ),
        userSetTables: true,
      };

    case "SET_SEATING_PLANS": {
      const plans = Array.isArray(action.payload) ? action.payload : action.payload?.plans ?? [];
      const errors = action.payload?.errors ?? [];
      return {
        ...state,
        seatingPlans: plans,
        warnings: [
          ...new Set([
            ...(state.warnings || []),
            ...errors.map((e: any) => e?.message ?? String(e)),
          ]),
        ],
        currentPlanIndex: plans.length
          ? Math.min(state.currentPlanIndex, plans.length - 1)
          : 0,
        lastGeneratedSignature: state.assignmentSignature,
      };
    }

    case "SET_CURRENT_PLAN_INDEX":
      return { ...state, currentPlanIndex: action.payload };

    case "SET_USER":
      return { ...state, user: action.payload };

    case "SET_SUBSCRIPTION":
      // distinguish "loaded but null" from "not loaded": set to null explicitly
      return { ...state, subscription: action.payload ?? null };

    case "SET_LOADED_SAVED_SETTING":
      return { ...state, loadedSavedSetting: action.payload };

    case "SET_USER_SET_TABLES":
      return { ...state, userSetTables: action.payload };

    case "SET_WARNING": {
      const incoming = Array.isArray(action.payload) ? action.payload : [String(action.payload)];
      const existing = Array.isArray(state.warnings) ? state.warnings : [];
      const seen = new Set(existing.map((w) => (w || "").toLowerCase()));
      const merged = [...existing];
      for (const w of incoming) {
        const key = (w || "").toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(w);
        }
      }
      return { ...state, warnings: merged };
    }

    case "CLEAR_WARNINGS":
      return { ...state, warnings: [] };

    case "PURGE_PLANS":
      return { ...state, seatingPlans: [] };

    case "AUTO_RECONCILE_TABLES":
      return {
        ...state,
        tables: reconcileTables(state.tables, state.guests, state.assignments, state.userSetTables),
      };

    case "LOAD_MOST_RECENT":
    case "LOAD_SAVED_SETTING": {
      const incoming = sanitizeAndMigrateAppState(action.payload);
      const { constraints, adjacents } = migrateState(incoming);
      const idKeyed = migrateAssignmentsToIdKeys(incoming.assignments || {}, incoming.guests || []);
      const assignmentSignature = JSON.stringify(
        Object.entries(idKeyed).sort((a, b) => a[0].localeCompare(b[0])),
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
        lastGeneratedSignature: null,
        warnings: [],
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
        lastGeneratedSignature: null,
        warnings: [],
      };
    }

    case "RESET_APP_STATE":
      return {
        ...initialState,
        user: null,
        subscription: null,
      };

    default:
      return state;
  }
};

// ---------- Initial State (assert to AppState to avoid over-constraining compile) ----------

const initialState = {
  guests: [],
  tables: defaultTables,
  constraints: {},
  adjacents: {},
  assignments: {},
  seatingPlans: [],
  currentPlanIndex: 0,
  subscription: undefined, // important: distinguish "not loaded" from null
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
} as unknown as AppState;

// ---------- Context ----------

const AppContext = createContext<
  { state: AppState; dispatch: React.Dispatch<AppAction>; mode: Mode } | undefined
>(undefined);

// ---------- Provider ----------

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState as unknown as AppState);
  const [mostRecentState, setMostRecentState] = useState<AppState | null>(null);
  const [showRecentModal, setShowRecentModal] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);
  const [recentFetched, setRecentFetched] = useState(false);

  // sessionLoading is THE gate that must always be released
  const [sessionLoading, setSessionLoading] = useState(true);

  // used by auth listener to re-run pre-seed follow-ups
  const [authChanged, setAuthChanged] = useState(false);

  // ---------- Table reconciliation (safe) ----------
  const prevTablesSignature = useRef<string>("");

  useEffect(() => {
    const sig = state.tables.map((t) => `${t.id}:${getCapacity(t)}`).join("|");
    if (prevTablesSignature.current && prevTablesSignature.current !== sig) {
      dispatch({ type: "SET_SEATING_PLANS", payload: [] });
      dispatch({ type: "SET_CURRENT_PLAN_INDEX", payload: 0 });
      dispatch({ type: "AUTO_RECONCILE_TABLES" });
      dispatch({ type: "SET_LOADED_SAVED_SETTING", payload: false });
    }
    prevTablesSignature.current = sig;
  }, [state.tables]);

  useEffect(() => {
    const reconciled = reconcileTables(state.tables, state.guests, state.assignments, state.userSetTables);
    if (reconciled.length !== state.tables.length) {
      dispatch({ type: "AUTO_RECONCILE_TABLES" });
    }
  }, [state.guests, state.assignments, state.userSetTables]);

  // ---------- Debounced plan generation (unchanged behavior) ----------

  const generationIdRef = useRef(0);
  const genTimerRef = useRef<number | null>(null);

  const debouncedGeneratePlans = useMemo(() => {
    return () => {
      if (genTimerRef.current != null) {
        clearTimeout(genTimerRef.current);
        genTimerRef.current = null;
      }
      genTimerRef.current = window.setTimeout(async () => {
        const currentGen = ++generationIdRef.current;
        const startTime = performance.now();

        const { plans, errors } = await engineGenerate(
          state.guests,
          state.tables,
          state.constraints,
          state.adjacents,
          state.assignments,
          isPremiumSubscription(state.subscription),
        );

        if (currentGen === generationIdRef.current) {
          if (errors && errors.length > 0) {
            dispatch({
              type: "SET_WARNING",
              payload: errors.map((e: any) => e.message),
            });
          }
          dispatch({
            type: "SET_SEATING_PLANS",
            payload: { plans: plans ?? [], errors: errors ?? [] },
          });
        }

        const duration = performance.now() - startTime;
        console.log(`SeatingGeneration: ${duration.toFixed(0)}ms`);
      }, 500);
      genTimerRef.current = null;
    };
  }, [
    state.guests,
    state.tables,
    state.constraints,
    state.adjacents,
    state.assignments,
    state.subscription,
  ]);

  useEffect(() => {
    if (state.guests.length > 0 && state.tables.length > 0 && !state.loadedSavedSetting) {
      debouncedGeneratePlans();
    }
  }, [
    state.guests,
    state.tables,
    state.constraints,
    state.adjacents,
    state.assignments,
    state.loadedSavedSetting,
    debouncedGeneratePlans,
  ]);

  useEffect(() => {
    return () => {
      if (genTimerRef.current != null) {
        clearTimeout(genTimerRef.current);
        genTimerRef.current = null;
      }
    };
  }, []);

  // ---------- Hydration for unsigned (runs ONLY after session resolved) ----------

  useEffect(() => {
    console.log("[HYDRATION CHECK] sessionLoading:", sessionLoading, "state.user:", !!state.user);

    if (sessionLoading) {
      console.log("[HYDRATION BLOCKED] Session still resolving…");
      return;
    }
    if (state.user) {
      console.log("[HYDRATION SKIP] Signed in; using Supabase recent state");
      return;
    }

    try {
      const raw = localStorage.getItem("seatyr_app_state");
      console.log("[HYDRATION] localStorage raw:", raw ? `${raw.length} chars` : "NOT FOUND");
      if (!raw) return;
      const saved = JSON.parse(raw);

      if (!saved.guests && !saved.tables) {
        console.log("[HYDRATION SKIP] Missing guests/tables");
        return;
      }

      const healedGuests: Guest[] = (saved.guests || []).map((g: any) => ({
        ...g,
        count: countHeads(g.name || ""),
      }));

      const sanitized = sanitizeAndMigrateAppState({
        ...(initialState as AppState),
        ...saved,
        guests: healedGuests,
      });

      dispatch({ type: "IMPORT_STATE", payload: sanitized });
      console.log("[HYDRATION SUCCESS]");
    } catch (e) {
      console.error("[HYDRATION ERROR]", e);
    }
  }, [sessionLoading, state.user]);

  // ---------- Pre-seed session (authoritative, dedup fetchers; may set user/subscription/trial) ----------

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const session = data?.session;
        if (!alive) return;

        if (!session) {
          // unsigned
          console.log("[PRE-SEED] No session (unsigned)");
          setSessionLoading(false); // CRITICAL: Unblock hydration for unsigned users
          return;
        }

        // set user
        const uid = session.user.id;
        dispatch({ type: "SET_USER", payload: session.user });
        console.log("[PRE-SEED] User set:", uid);

        // subscription via limit(1) to handle multiple records gracefully
        const { data: subData, error: subError } = await supabase
          .from("subscriptions")
          .select("*")
          .eq("user_id", uid)
          .order("current_period_end", { ascending: false })
          .limit(1);
        
        const sub = subData?.[0] || null;
        
        if (subError) {
          console.error("[PRE-SEED] Subscription query error:", subError);
        }
        if (alive) {
          dispatch({ type: "SET_SUBSCRIPTION", payload: sub || null });
          console.log("[PRE-SEED] Subscription:", sub ? "FOUND" : "NONE");
          if (sub) {
            console.log("[PRE-SEED] Subscription details:", {
              status: sub.status,
              current_period_end: sub.current_period_end,
              cancel_at_period_end: sub.cancel_at_period_end
            });
          }
        }

        // trial via limit(1) to handle multiple records gracefully
        const { data: trialData, error: trialError } = await supabase
          .from("trial_subscriptions")
          .select("expires_on, expires_at")
          .eq("user_id", uid)
          .order("expires_on", { ascending: false })
          .limit(1);
        
        const trial = trialData?.[0] || null;
        
        if (trialError) {
          console.error("[PRE-SEED] Trial query error:", trialError);
        }
        if (alive) {
          dispatch({ type: "SET_TRIAL", payload: trial || null });
          console.log("[PRE-SEED] Trial:", trial ? "ACTIVE" : "NONE");
        }
      } catch (error) {
        console.warn("[PRE-SEED] Error during session setup:", error);
      } finally {
        if (alive) {
          setSessionLoading(false); // always unblock
          console.log("[PRE-SEED] Complete → sessionLoading=false");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [authChanged]); // re-run if auth state changes

  // ---------- Auth change listener (clears unsigned localStorage on SIGNED_IN) ----------

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        try {
          localStorage.removeItem("seatyr_app_state");
        } catch (e) {
          console.warn("Failed to clear localStorage on sign-in:", e);
        }
        setAuthChanged(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  // ---------- Trial expiry timer (standalone top-level effect; NO hook violations) ----------

  useEffect(() => {
    const raw = state.trial?.expires_on || state.trial?.expires_at;
    if (!raw) return;
    const expiryTime = new Date(raw).getTime();
    if (!expiryTime || expiryTime <= Date.now()) return;

    const timer = setTimeout(() => {
      dispatch({ type: "SET_TRIAL", payload: null });
      console.log("[TRIAL] Expired mid-session → mode reverts to free");
    }, expiryTime - Date.now());

    return () => clearTimeout(timer);
  }, [state.trial?.expires_on, state.trial?.expires_at]);

  // ---------- Premium recent-state fetch (only when user+subscription resolved) ----------

  useEffect(() => {
    if (sessionLoading || !state.user) return;
    if (typeof state.subscription === "undefined") return; // wait until pre-seed sets it (null or row)
    if (recentFetched) return;

    if (!isPremiumSubscription(state.subscription)) {
      setRecentFetched(true);
      return;
    }

    getMostRecentState(state.user.id)
      .then((data) => setMostRecentState(data))
      .catch((err) => setRecentError(err?.message || String(err)))
      .finally(() => {
        setRecentFetched(true);
      });
  }, [state.user, state.subscription, recentFetched, sessionLoading]);

  useEffect(() => {
    if (mostRecentState) setShowRecentModal(true);
  }, [mostRecentState]);

  // ---------- Auto-save premium → Supabase (debounced) ----------

  useEffect(() => {
    if (!state.user || !isPremiumSubscription(state.subscription)) return;
    if (state.guests.length === 0 && state.seatingPlans.length === 0) return;

    const timer = setTimeout(() => {
      saveMostRecentState(state.user!.id, state, true).catch((err) => {
        console.error("Auto-save to Supabase failed:", err);
      });
    }, 2000);

    return () => clearTimeout(timer);
  }, [
    state.guests,
    state.tables,
    state.constraints,
    state.adjacents,
    state.assignments,
    state.seatingPlans,
    state.user,
    state.subscription,
  ]);

  // ---------- Auto-save unsigned → localStorage (debounced) ----------

  useEffect(() => {
    if (state.user) return;
    if (
      state.guests.length === 0 &&
      state.constraints &&
      Object.keys(state.constraints).length === 0
    ) {
      return;
    }

    const timer = setTimeout(() => {
      try {
        const stateToSave = {
          guests: state.guests,
          tables: state.tables,
          constraints: state.constraints,
          adjacents: state.adjacents,
          assignments: state.assignments,
          seatingPlans: state.seatingPlans,
          currentPlanIndex: state.currentPlanIndex,
          userSetTables: state.userSetTables,
          timestamp: new Date().toISOString(),
        };
        localStorage.setItem("seatyr_app_state", JSON.stringify(stateToSave));
      } catch (err) {
        console.error("[AUTO-SAVE ERROR] localStorage:", err);
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [
    state.guests,
    state.tables,
    state.constraints,
    state.adjacents,
    state.assignments,
    state.seatingPlans,
    state.user,
  ]);

  // ---------- Modal handlers ----------

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

  const mode = deriveMode(state.user, state.subscription, state.trial);
  
  // Debug logging for mode derivation
  useEffect(() => {
    console.log("[MODE DEBUG]", {
      mode,
      hasUser: !!state.user,
      subscription: state.subscription,
      trial: state.trial,
      isPremium: isPremiumSubscription(state.subscription, state.trial)
    });
  }, [mode, state.user, state.subscription, state.trial]);
  
  const value = useMemo(() => ({ state, dispatch, mode }), [state, mode]);

  return (
    <AppContext.Provider value={value}>
      {children}

      {showRecentModal &&
        state.user &&
        isPremiumSubscription(state.subscription) && (
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

// ---------- Hook ----------

export function useApp(): {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  mode: Mode;
} {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}