// src/context/AppContext.tsx
import React, {
  createContext, useContext, useReducer, useEffect, useMemo, useRef, ReactNode, useState,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

import { deriveMode, isPremiumSubscription, type Mode } from '../utils/premium';
import type {
  AppState, Guest, Table, Assignments, ConstraintValue,
  UserSubscription, TrialSubscription
} from '../types';

import { getMostRecentState, saveMostRecentState } from '../lib/mostRecentState';
import { countHeads } from '../utils/formatters';
import { getCapacity } from '../utils/tables';
import { migrateState, migrateAssignmentsToIdKeys, parseAssignmentIds } from '../utils/assignments';
import { generateSeatingPlans as engineGenerate } from '../utils/seatingAlgorithm';
// Modal removed - now using auto-restore for seamless UX
// import MostRecentChoiceModal from '../components/MostRecentChoiceModal';

type SessionTag = 'INITIALIZING' | 'AUTHENTICATING' | 'ANON' | 'ENTITLED' | 'ERROR';
type AppAction = { type: string; payload?: any };

let __entitlementsPromise: Promise<{ subscription: UserSubscription | null; trial: TrialSubscription | null }> | null = null;
function resetEntitlementsPromise() { __entitlementsPromise = null; }

/** Deterministic, fast ETag (FNV-1a 32-bit) for change detection without heavy hashing */
function fnv1a32(str: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ('00000000' + h.toString(16)).slice(-8);
}

async function loadEntitlementsOnce(userId: string): Promise<{ subscription: UserSubscription | null; trial: TrialSubscription | null }> {
  if (__entitlementsPromise) return __entitlementsPromise;
  __entitlementsPromise = (async () => {
    try {
      const { data: subscription, error: subError } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .in('status', ['active','trialing','past_due','canceled'])
        .order('current_period_end', { ascending: false })
        .maybeSingle();
      if (subError) throw subError;

      const nowIso = new Date().toISOString();
      const { data: trial, error: trialError } = await supabase
        .from('trial_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .gt('expires_on', nowIso)
        .order('expires_on', { ascending: false })
        .maybeSingle();
      if (trialError) throw trialError;

      return { subscription, trial };
    } catch (e) {
      resetEntitlementsPromise();
      throw e;
    }
  })();
  return __entitlementsPromise;
}

const DEFAULT_TABLE_CAPACITY = 8;
const defaultTables: Table[] = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, seats: DEFAULT_TABLE_CAPACITY }));

function totalSeatsNeeded(guests: Guest[]): number {
  return guests.reduce((sum, g) => sum + Math.max(1, g.count || 1), 0);
}
function isTableLocked(t: Table, assignments: Assignments): boolean {
  const named = !!(t.name && t.name.trim());
  const capChanged = getCapacity(t) !== DEFAULT_TABLE_CAPACITY;
  const hasAssign = Object.values(assignments || {}).some(val => parseAssignmentIds(val).includes(t.id));
  return named || capChanged || hasAssign;
}
function reconcileTables(tables: Table[], guests: Guest[], assignments: Assignments, userSetTables: boolean): Table[] {
  if (userSetTables) return tables;
  const needed = totalSeatsNeeded(guests);
  let lockedCap = 0;
  tables.forEach(t => { if (isTableLocked(t, assignments)) lockedCap += getCapacity(t); });
  const remaining = Math.max(0, needed - lockedCap);
  const untouched = tables.filter(t => !isTableLocked(t, assignments) && getCapacity(t) === DEFAULT_TABLE_CAPACITY);
  const delta = Math.ceil(remaining / DEFAULT_TABLE_CAPACITY) - untouched.length;
  if (delta <= 0) return tables;
  const maxId = Math.max(0, ...tables.map(t => t.id || 0));
  const add: Table[] = Array.from({ length: delta }, (_, i) => ({ id: maxId + i + 1, seats: DEFAULT_TABLE_CAPACITY }));
  return [...tables, ...add];
}
function sanitizeAndMigrateAppState(s: any): AppState {
  const guests = (s.guests || []).filter((g: Guest) => g && g.id && g.name);
  const { constraints, adjacents } = migrateState({ guests, constraints: s.constraints, adjacents: s.adjacents });
  const migratedAssignments = migrateAssignmentsToIdKeys(s.assignments || {}, guests);
  return { ...s, guests, assignments: migratedAssignments, constraints, adjacents, timestamp: new Date().toISOString() };
}

const initialState: AppState = {
  guests: [], tables: defaultTables, constraints: {}, adjacents: {}, assignments: {},
  seatingPlans: [], currentPlanIndex: 0, subscription: undefined, trial: null, user: null,
  userSetTables: false, loadedSavedSetting: false, timestamp: new Date().toISOString(),
  isSupabaseConnected: !!supabase, duplicateGuests: [], assignmentSignature: '',
  warnings: [], lastGeneratedSignature: null, hideTableReductionNotice: false,
  conflictWarnings: [], lastGeneratedPlanSig: null,
};

const reducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'SET_USER': return { ...state, user: action.payload };
    case 'SET_SUBSCRIPTION': return { ...state, subscription: action.payload };
    case 'SET_TRIAL': return { ...state, trial: action.payload };

    case 'SET_GUESTS': {
      const payload = action.payload;
      const guests: Guest[] = Array.isArray(payload) ? payload : payload?.guests || [];
      return { ...state, guests, duplicateGuests: [], seatingPlans: [], currentPlanIndex: 0 };
    }
    case 'ADD_GUEST': {
      const guest: Guest = action.payload;
      return { ...state, guests: [...state.guests, guest], seatingPlans: [], currentPlanIndex: 0 };
    }
    case 'REMOVE_GUEST': {
      const id = action.payload;
      const guests = state.guests.filter(g => g.id !== id);

      const { [id]: _x, ...assignments } = state.assignments || {};
      const { [id]: _y, ...constraints } = state.constraints || {};
      Object.keys(constraints).forEach(k => { if (constraints[k]) delete constraints[k][id]; });

      const { [id]: _z, ...adjacents } = state.adjacents || {};
      Object.keys(adjacents).forEach(k => { adjacents[k] = (adjacents[k] || []).filter((gid: any) => gid !== id); });

      return { ...state, guests, assignments, constraints, adjacents, seatingPlans: [], currentPlanIndex: 0 };
    }
    case 'RENAME_GUEST': {
      const { id, name } = action.payload;
      const guests = state.guests.map(g => g.id === id ? { ...g, name, count: countHeads(name) } : g);
      return { ...state, guests, seatingPlans: [], currentPlanIndex: 0 };
    }
    case 'UPDATE_ASSIGNMENT': {
      const { guestId, raw } = action.payload || {};
      const assignments = { ...(state.assignments || {}), [guestId]: raw ?? '' };
      const signature = JSON.stringify(Object.entries(assignments).sort((a,b)=>a[0].localeCompare(b[0])));
      return { ...state, assignments, assignmentSignature: signature, seatingPlans: [], currentPlanIndex: 0 };
    }
    case 'SET_SEATING_PLANS': {
      const { plans = [], errors = [] } = action.payload || {};
      return {
        ...state,
        seatingPlans: plans,
        warnings: [...new Set([...(state.warnings || []), ...errors.map((e: any) => e?.message ?? String(e))])],
        currentPlanIndex: plans.length ? Math.min(state.currentPlanIndex, plans.length - 1) : 0,
        lastGeneratedSignature: state.assignmentSignature,
      };
    }
    case 'SET_CURRENT_PLAN_INDEX': return { ...state, currentPlanIndex: action.payload };
    case 'AUTO_RECONCILE_TABLES': return { ...state, tables: reconcileTables(state.tables, state.guests, state.assignments, state.userSetTables) };
    case 'ADD_TABLE': {
      const maxId = Math.max(0, ...state.tables.map(t => t.id || 0));
      const newTable = { id: maxId + 1, seats: 8 };
      return { ...state, tables: [...state.tables, newTable], userSetTables: true };
    }
    case 'REMOVE_TABLE': {
      const tableId = action.payload;
      const filteredTables = state.tables.filter(t => t.id !== tableId);
      // Remove assignments that reference the deleted table
      const filteredAssignments = { ...state.assignments };
      Object.keys(filteredAssignments).forEach(guestId => {
        const assignment = filteredAssignments[guestId];
        if (assignment) {
          const tableIds = assignment.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
          const remainingIds = tableIds.filter(id => id !== tableId);
          filteredAssignments[guestId] = remainingIds.join(',');
        }
      });
      return { ...state, tables: filteredTables, assignments: filteredAssignments, userSetTables: true };
    }
    case 'UPDATE_TABLE': {
      const { id, name, seats } = action.payload;
      const updatedTables = state.tables.map(t => 
        t.id === id ? { ...t, ...(name !== undefined && { name }), ...(seats !== undefined && { seats }) } : t
      );
      return { ...state, tables: updatedTables, userSetTables: true };
    }
    case 'SET_USER_SET_TABLES': return { ...state, userSetTables: action.payload };

    case 'IMPORT_STATE':
    case 'LOAD_MOST_RECENT':
    case 'LOAD_SAVED_SETTING': {
      const incoming = sanitizeAndMigrateAppState(action.payload);
      const assignmentSignature = JSON.stringify(
        Object.entries(incoming.assignments || {}).sort((a,b) => a[0].localeCompare(b[0]))
      );
      return {
        ...state,
        ...incoming,
        assignmentSignature,
        user: state.user,
        subscription: state.subscription,
        trial: state.trial,
        seatingPlans: Array.isArray(incoming.seatingPlans) ? incoming.seatingPlans : state.seatingPlans,
        lastGeneratedSignature: null,
        warnings: [],
      };
    }

    case 'RESET_APP_STATE': return { ...initialState, user: null, subscription: null, trial: null };
    case 'CLEAR_ALL': return { ...initialState, user: state.user, subscription: state.subscription, trial: state.trial };

    case 'CYCLE_CONSTRAINT': {
      const { a, b, mode } = action.payload;
      const newConstraints: Record<string, Record<string, ConstraintValue>> = JSON.parse(JSON.stringify(state.constraints));
      const newAdjacents: Record<string, string[]> = JSON.parse(JSON.stringify(state.adjacents));
      const current = newConstraints[a]?.[b] || '';

      const isCurrentlyAdjacent = newAdjacents[a]?.includes(b);
      let currentStateForCycle: string = current;
      if (isCurrentlyAdjacent) currentStateForCycle = 'adjacent';

      const cycle = mode === 'premium' ? ['', 'must', 'adjacent', 'cannot'] : ['', 'must', 'cannot'];
      const currentIndex = cycle.indexOf(currentStateForCycle);
      const nextState = cycle[(currentIndex + 1) % cycle.length];

      if (newConstraints[a]) delete newConstraints[a][b];
      if (newConstraints[b]) delete newConstraints[b][a];
      if (newAdjacents[a]) newAdjacents[a] = newAdjacents[a].filter((id: string) => id !== b);
      if (newAdjacents[b]) newAdjacents[b] = newAdjacents[b].filter((id: string) => id !== a);

      if (nextState === 'must' || nextState === 'cannot') {
        (newConstraints[a] ||= {})[b] = nextState as ConstraintValue;
        (newConstraints[b] ||= {})[a] = nextState as ConstraintValue;
      } else if (nextState === 'adjacent' && mode === 'premium') {
        (newConstraints[a] ||= {})[b] = 'must';
        (newConstraints[b] ||= {})[a] = 'must';
        (newAdjacents[a] ||= []);
        (newAdjacents[b] ||= []);
        if (!newAdjacents[a].includes(b)) newAdjacents[a].push(b);
        if (!newAdjacents[b].includes(a)) newAdjacents[b].push(a);
      }
      return { ...state, constraints: newConstraints, adjacents: newAdjacents, seatingPlans: [], currentPlanIndex: 0 };
    }

    default: return state;
  }
};

const AppContext = createContext<{
  state: AppState; dispatch: React.Dispatch<AppAction>; mode: Mode; sessionTag: SessionTag
} | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [sessionTag, setSessionTag] = useState<SessionTag>('INITIALIZING');
  const [fatalError, setFatalError] = useState<Error | null>(null);
  const userRef = useRef<User | null>(null);

  // Single-flight entitlements + auth FSM
  useEffect(() => {
    let isMounted = true;
    
    // Check initial session state on mount
    const checkInitialSession = async () => {
      console.log('[Init] Starting session check...');
      
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('[Init] Session error:', sessionError);
          throw sessionError;
        }
        
        if (!isMounted) return;
        
        if (session?.user) {
          console.log('[Init] User authenticated:', session.user.email);
          // User is already authenticated, process the session
          const user = session.user;
          userRef.current = user;
          dispatch({ type: 'SET_USER', payload: user });
          
          const { subscription, trial } = await loadEntitlementsOnce(user.id);
          dispatch({ type: 'SET_SUBSCRIPTION', payload: subscription });
          dispatch({ type: 'SET_TRIAL', payload: trial });
          setSessionTag('ENTITLED');
          console.log('[Init] Session tag set to ENTITLED');
          
          // Auto-restore premium state without modal (seamless UX)
          if (isPremiumSubscription(subscription, trial)) {
            getMostRecentState(user.id).then(data => {
              if (data && (data.guests?.length ?? 0) > 0) {
                // Directly restore instead of showing modal
                dispatch({ type: 'LOAD_MOST_RECENT', payload: data });
                console.log('[Session Restore] Premium user state restored automatically');
              }
            }).catch((err) => {
              console.warn('[Session Restore] Failed to restore premium state:', err?.message);
            });
          }
        } else {
          console.log('[Init] No session, user is anonymous');
          // No session, check for anonymous state
          try {
            const saved = localStorage.getItem('seatyr_app_state');
            if (saved) {
              dispatch({ type: 'IMPORT_STATE', payload: JSON.parse(saved) });
              console.log('[Session Restore] Anonymous user state restored from localStorage');
            }
          } catch (err) {
            console.warn('[Session Restore] Failed to restore anonymous state:', err);
          }
          setSessionTag('ANON');
          console.log('[Init] Session tag set to ANON');
        }
      } catch (err: any) {
        console.error("[FSM] Initial session check error:", err?.message || err);
        // Set to ANON on error so app doesn't hang
        setSessionTag('ANON');
        console.log('[Init] Session tag set to ANON (error fallback)');
      }
    };
    
    checkInitialSession();
    
    const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
      // Skip INITIAL_SESSION since we handle it manually in checkInitialSession
      if (event === 'INITIAL_SESSION') return;
      
      const RELEVANT_EVENTS = new Set([
        'SIGNED_IN','USER_UPDATED','PASSWORD_RECOVERY','TOKEN_REFRESHED','SIGNED_OUT'
      ]);
      if (!RELEVANT_EVENTS.has(event)) return;

      if (event !== 'SIGNED_OUT') setSessionTag('AUTHENTICATING');

      try {
        if (event === 'SIGNED_OUT' || !session) {
          const wasAuthed = userRef.current !== null;
          resetEntitlementsPromise();
          dispatch({ type: 'RESET_APP_STATE' });

          if (wasAuthed) {
            localStorage.removeItem('seatyr_app_state');
          } else {
            try {
              const saved = localStorage.getItem('seatyr_app_state');
              if (saved) dispatch({ type: 'IMPORT_STATE', payload: JSON.parse(saved) });
            } catch { /* ignore */ }
          }

          userRef.current = null;
          setSessionTag('ANON');
          return;
        }

        const user = session.user;
        if (!userRef.current && user) {
          // New login: clear anon cache
          localStorage.removeItem('seatyr_app_state');
        }
        userRef.current = user;
        dispatch({ type: 'SET_USER', payload: user });

        const { subscription, trial } = await loadEntitlementsOnce(user.id);
        dispatch({ type: 'SET_SUBSCRIPTION', payload: subscription });
        dispatch({ type: 'SET_TRIAL', payload: trial });
        setSessionTag('ENTITLED');

        // Auto-restore premium state on new login (seamless UX)
        if (isPremiumSubscription(subscription, trial)) {
          getMostRecentState(user.id).then(data => {
            if (data && (data.guests?.length ?? 0) > 0) {
              dispatch({ type: 'LOAD_MOST_RECENT', payload: data });
              console.log('[Session Restore] Premium user state restored on sign-in');
            }
          }).catch((err) => {
            console.warn('[Session Restore] Failed to restore on sign-in:', err?.message);
          });
        }
      } catch (err: any) {
        console.error("[FSM] Session Error:", err?.message || err);
        setSessionTag('ERROR');
        setFatalError(err instanceof Error ? err : new Error(String(err)));
      }
    });
    
    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  // Trial expiry observer: clears trial in-memory once expired
  useEffect(() => {
    const trial = state.trial;
    if (trial?.expires_on) {
      const expiryDate = new Date(trial.expires_on);
      const timeout = expiryDate.getTime() - Date.now();
      if (timeout > 0) {
        const timerId = setTimeout(() => { dispatch({ type: 'SET_TRIAL', payload: null }); }, timeout);
        return () => clearTimeout(timerId);
      } else if (state.trial) {
        dispatch({ type: 'SET_TRIAL', payload: null });
      }
    }
  }, [state.trial]);

  // Premium autosave with precise deps, ETag signature, and modal pause
  const autosavePayload = useMemo(() => {
    // only store non-PII slices required for restore; seatingPlans are ephemeral
    const { guests, tables, constraints, adjacents, assignments, timestamp, userSetTables } = state;
    return { 
      guests, 
      tables, 
      constraints, 
      adjacents, 
      assignments, 
      timestamp, 
      userSetTables,
      // Add minimal required properties for AppState
      seatingPlans: [],
      currentPlanIndex: 0,
      subscription: undefined,
      trial: null,
      user: null,
      loadedSavedSetting: false,
      isSupabaseConnected: !!supabase,
      duplicateGuests: [],
      assignmentSignature: '',
      warnings: [],
      lastGeneratedSignature: null,
      hideTableReductionNotice: false,
      conflictWarnings: [],
      lastGeneratedPlanSig: null,
    };
  }, [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.timestamp, state.userSetTables]);

  const autosaveSignature = useMemo(() => fnv1a32(JSON.stringify(autosavePayload)), [autosavePayload]);
  const lastAutosaveSigRef = useRef<string>("");

  useEffect(() => {
    const isPremium = sessionTag === 'ENTITLED' && !!state.user && isPremiumSubscription(state.subscription, state.trial);
    if (!state.user?.id) return;                          // guard for mid-transition
    if (!isPremium) return;                               // only autosave for premium users
    if (
      state.guests.length === 0 &&
      Object.keys(state.assignments).length === 0 &&
      Object.keys(state.constraints).length === 0
    ) return;
    if (autosaveSignature === lastAutosaveSigRef.current) return;

    const t = setTimeout(() => {
      saveMostRecentState(state.user!.id, autosavePayload, true)
        .then(() => { lastAutosaveSigRef.current = autosaveSignature; })
        .catch(() => {/* silent; no UI drift */});
    }, 500);

    return () => clearTimeout(t);
  }, [
    sessionTag, state.user, state.subscription, state.trial, autosavePayload, autosaveSignature
  ]);

  // Anonymous persistence to localStorage (no entitlements; no user)
  useEffect(() => {
    if (sessionTag !== 'ANON') return;
    if (
      state.guests.length === 0 &&
      Object.keys(state.constraints).length === 0 &&
      Object.keys(state.assignments).length === 0
    ) return;

    const t = setTimeout(() => {
      try {
        const { user, subscription, trial, seatingPlans, ...rest } = state;
        // PII minimalism: never store user or entitlement details in localStorage
        localStorage.setItem('seatyr_app_state', JSON.stringify(rest));
        console.log('[Anonymous Persist] State saved to localStorage');
      } catch (err) {
        console.warn('[Anonymous Persist] Failed to save:', err);
      }
    }, 100); // Reduced from 1000ms to 100ms for faster persistence
    return () => clearTimeout(t);
  }, [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, sessionTag, state.timestamp, state.userSetTables]);

  // Debounced plan generation
  const genRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedGeneratePlans = useMemo(() => () => {
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const id = ++genRef.current;
      const { plans, errors } = await engineGenerate({
        guests: state.guests, tables: state.tables, constraints: state.constraints, adjacents: state.adjacents,
        assignments: state.assignments, isPremium: isPremiumSubscription(state.subscription, state.trial),
      });
      if (id === genRef.current) dispatch({ type: 'SET_SEATING_PLANS', payload: { plans, errors } });
    }, 500);
  }, [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.subscription, state.trial]);

  const generationSignature = useMemo(
    () => JSON.stringify([state.guests, state.tables, state.constraints, state.adjacents, state.assignments, deriveMode(state.user, state.subscription, state.trial)]),
    [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.user, state.subscription, state.trial]
  );
  const lastGenSigRef = useRef('');

  useEffect(() => {
    if (state.guests.length > 0 && state.tables.length > 0) {
      if (generationSignature !== lastGenSigRef.current) {
        debouncedGeneratePlans();
        lastGenSigRef.current = generationSignature;
      }
    }
  }, [generationSignature, state.guests.length, state.tables.length, debouncedGeneratePlans]);

  // Auto reconcile table count when guests/assignments change
  useEffect(() => {
    dispatch({ type: 'AUTO_RECONCILE_TABLES' });
  }, [state.guests.length, state.assignmentSignature, state.userSetTables]);

  const mode = useMemo(() => deriveMode(state.user, state.subscription, state.trial), [state.user, state.subscription, state.trial]);
  const value = useMemo(() => ({ state, dispatch, mode, sessionTag }), [state, mode, sessionTag]);

  // Show loading screen during initialization instead of invisible gate (fixes blank screen on reload)
  if (sessionTag === 'INITIALIZING' || sessionTag === 'AUTHENTICATING') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
          <p className="text-gray-600 text-lg">Loading Seatyr...</p>
        </div>
      </div>
    );
  }
  
  if (fatalError) { throw fatalError; }

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
};

export function useApp(): {
  state: AppState; dispatch: React.Dispatch<AppAction>; mode: Mode; sessionTag: SessionTag
} {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

