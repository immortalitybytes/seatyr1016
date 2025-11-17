// src/context/AppContext.tsx
import React, {
  createContext, useContext, useReducer, useEffect, useMemo, useRef, ReactNode, useState, useCallback,
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
import { formatGuestUnitName } from '../utils/formatGuestName';
import { getCapacity } from '../utils/tables';
import { parseAssignmentIds } from '../utils/assignments';
import { generateSeatingPlans as engineGenerate } from '../utils/seatingAlgorithm';
import MostRecentChoiceModal from '../components/MostRecentChoiceModal';
import { saveAppState, loadAppState, exportAppState, importAppState, clearAllSavedData, getStorageStats, sanitizeAndMigrateAppState, saveLKG } from '../utils/persistence';

// Inline debounce utility (no external file)
// FIXED: Use ReturnType<typeof setTimeout> for cross-platform compatibility
function debounce<T extends (...args: any[]) => void>(
  func: T,
  wait: number,
  options: { leading?: boolean; trailing?: boolean } = { trailing: true }
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;
  let lastThis: any = null;
  
  const invoke = () => {
    if (lastArgs) {
      func.apply(lastThis, lastArgs);
      lastArgs = null;
      lastThis = null;
    }
  };
  
  const debounced = function(this: any, ...args: Parameters<T>) {
    lastArgs = args;
    lastThis = this;
    
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    
    if (options.leading && timeoutId === null) {
      invoke();
    }
    
    timeoutId = setTimeout(() => {
      if (options.trailing) {
        invoke();
      }
      timeoutId = null;
    }, wait);
  } as T & { cancel: () => void };
  
  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    lastArgs = null;
    lastThis = null;
  };
  
  return debounced;
}

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
// Wrapper to preserve app-level flags while using imported sanitizer
function applySanitizedState(s: any): AppState {
  console.log('[State Migration] Raw saved state:', s);
  
  // Use the imported pure sanitizeAndMigrateAppState
  const sanitized = sanitizeAndMigrateAppState(s);
  
  // Patch C: Replace return construction with integrity-safe sessionVersion handling
  const MAX_REASONABLE_SESSION_VERSION = 10_000_000;
  const pickTrusted = (v: any): number =>
    typeof v === "number" && v >= 0 && v < MAX_REASONABLE_SESSION_VERSION ? v : -1;

  const ssv = pickTrusted(s?.sessionVersion);
  const zsv = pickTrusted(sanitized?.sessionVersion);
  const trustedSessionVersion = ssv >= 0 ? ssv : (zsv >= 0 ? zsv : 0);

  // (Test assist) Log the trusted version on load/migration:
  console.log("[State Migration] Trusted sessionVersion:", trustedSessionVersion);

  return {
    // Base: sanitized defaults
    ...sanitized,

    // Explicit field overlay (retain all known AppState keys)
    guests: Array.isArray(s?.guests) ? s.guests : (sanitized.guests ?? []),
    tables: Array.isArray(s?.tables) ? s.tables : (sanitized.tables ?? []),
    constraints: s?.constraints ?? (sanitized.constraints ?? {}),
    adjacents: s?.adjacents ?? (sanitized.adjacents ?? {}),
    assignments: s?.assignments ?? (sanitized.assignments ?? {}),
    seatingPlans: Array.isArray(s?.seatingPlans) ? s.seatingPlans : (sanitized.seatingPlans ?? []),
    currentPlanIndex: typeof s?.currentPlanIndex === "number" ? s.currentPlanIndex : (sanitized.currentPlanIndex ?? 0),

    warnings: Array.isArray(s?.warnings) ? s.warnings : (sanitized.warnings ?? []),
    // errors: Array.isArray(s?.errors) ? s.errors : (sanitized.errors ?? []), // COMMENTED: Not in AppState type
    conflictWarnings: Array.isArray(s?.conflictWarnings) ? s.conflictWarnings : (sanitized.conflictWarnings ?? []),
    duplicateGuests: Array.isArray(s?.duplicateGuests) ? s.duplicateGuests : (sanitized.duplicateGuests ?? []),

    assignmentSignature: typeof s?.assignmentSignature === "string" ? s.assignmentSignature : (sanitized.assignmentSignature ?? ""),
    lastGeneratedSignature: s?.lastGeneratedSignature ?? (sanitized.lastGeneratedSignature ?? null),

    hideTableReductionNotice: !!(s?.hideTableReductionNotice ?? sanitized.hideTableReductionNotice ?? false),
    userSetTables: !!(s?.userSetTables ?? sanitized.userSetTables ?? false),

    loadedRestoreDecision: !!(s?.loadedRestoreDecision ?? sanitized.loadedRestoreDecision ?? false),
    loadedSavedSetting: !!(s?.loadedSavedSetting ?? sanitized.loadedSavedSetting ?? false),
    isReady: !!(s?.isReady ?? sanitized.isReady ?? false),
    regenerationNeeded: typeof s?.regenerationNeeded === "boolean" ? s.regenerationNeeded : (sanitized.regenerationNeeded ?? true),

    // Required AppState fields
    subscription: s?.subscription ?? sanitized.subscription ?? undefined,
    trial: s?.trial ?? sanitized.trial ?? null,
    user: s?.user ?? sanitized.user ?? null,
    isSupabaseConnected: s?.isSupabaseConnected ?? sanitized.isSupabaseConnected ?? false,
    lastGeneratedPlanSig: s?.lastGeneratedPlanSig ?? sanitized.lastGeneratedPlanSig ?? null,

    // Additional persistence-related overlays (preserve if present)
    // NOTE: If your AppState does not include these fields, comment them out.
    // They are included here for completeness across different app versions.
    // savedStates: Array.isArray(s?.savedStates) ? s.savedStates : (sanitized.savedStates ?? []), // COMMENTED: Not in AppState type
    // savedSettings: s?.savedSettings ?? (sanitized.savedSettings ?? {}), // COMMENTED: Not in AppState type
    // entitlementsETag: typeof s?.entitlementsETag === "string" ? s.entitlementsETag : (sanitized.entitlementsETag ?? ""), // COMMENTED: Not in AppState type

    // Versioning & persistence
    sessionVersion: trustedSessionVersion,
    persistenceVersion: s?.persistenceVersion ?? (sanitized.persistenceVersion ?? "1.0.0"),
    timestamp: new Date().toISOString()
  };
}

const initialState: AppState = {
  guests: [], tables: defaultTables, constraints: {}, adjacents: {}, assignments: {},
  seatingPlans: [], currentPlanIndex: 0, subscription: undefined, trial: null, user: null,
  userSetTables: false, loadedSavedSetting: false, loadedRestoreDecision: false, 
  regenerationNeeded: true, isReady: false, timestamp: new Date().toISOString(),
  isSupabaseConnected: !!supabase, duplicateGuests: [], assignmentSignature: '',
  warnings: [], lastGeneratedSignature: null, hideTableReductionNotice: false,
  conflictWarnings: [], lastGeneratedPlanSig: null, sessionVersion: 0, persistenceVersion: '1.0.0',
};

const reducer = (state: AppState, action: AppAction): AppState => {
  switch (action.type) {
    case 'SET_USER': return { ...state, user: action.payload };
    case 'SET_SUBSCRIPTION': return { ...state, subscription: action.payload };
    case 'SET_TRIAL': return { ...state, trial: action.payload };
    case 'SET_LOADED_RESTORE_DECISION': return { ...state, loadedRestoreDecision: action.payload };
    case 'SET_READY': return { ...state, isReady: true };
    case 'SEATING_PAGE_MOUNTED': {
      // Auto-generate seating plans if none exist and we have guests/tables
      if (state.seatingPlans.length === 0 && state.guests.length > 0 && state.tables.length > 0) {
        console.log('[SeatingPage] Auto-generating seating plans on page mount');
        return { ...state, regenerationNeeded: true };
      }
      return state;
    }

    case 'SET_GUESTS': {
      const payload = action.payload;
      const guests: Guest[] = Array.isArray(payload) ? payload : payload?.guests || [];
      // Format all guest names to ensure consistent spacing
      const formattedGuests = guests.map(g => ({
        ...g,
        name: formatGuestUnitName(g.name)
      }));
      return { ...state, guests: formattedGuests, duplicateGuests: [], seatingPlans: [], currentPlanIndex: 0 };
    }
    case 'ADD_GUEST': {
      const guest: Guest = action.payload;
      return { 
        ...state, 
        guests: [...state.guests, guest], 
        regenerationNeeded: true,
        seatingPlans: [], 
        currentPlanIndex: 0,
        sessionVersion: state.sessionVersion + 1
      };
    }
    case 'REMOVE_GUEST': {
      const id = action.payload;
      const guests = state.guests.filter(g => g.id !== id);

      const { [id]: _x, ...assignments } = state.assignments || {};
      const { [id]: _y, ...constraints } = state.constraints || {};
      Object.keys(constraints).forEach(k => { if (constraints[k]) delete constraints[k][id]; });

      const { [id]: _z, ...adjacents } = state.adjacents || {};
      Object.keys(adjacents).forEach(k => { adjacents[k] = (adjacents[k] || []).filter((gid: any) => gid !== id); });

      return { 
        ...state, 
        guests, 
        assignments, 
        constraints, 
        adjacents, 
        regenerationNeeded: true,
        seatingPlans: [], 
        currentPlanIndex: 0,
        sessionVersion: state.sessionVersion + 1
      };
    }
    case 'RENAME_GUEST': {
      const { id, name } = action.payload;
      // Format the name to ensure consistent spacing (defensive - commitEdit already formats, but this ensures consistency)
      const formattedName = formatGuestUnitName(name);
      const guests = state.guests.map(g => g.id === id ? { ...g, name: formattedName, count: countHeads(formattedName) } : g);
      return { ...state, guests, seatingPlans: [], currentPlanIndex: 0, sessionVersion: state.sessionVersion + 1 };
    }
    case 'UPDATE_ASSIGNMENT': {
      const { guestId, raw } = action.payload || {};
      const currentAssignment = state.assignments[guestId] || '';
      const newAssignment = raw ?? '';
      const assignments = { ...(state.assignments || {}), [guestId]: newAssignment };
      const signature = JSON.stringify(Object.entries(assignments).sort((a,b)=>a[0].localeCompare(b[0])));
      
      // Parse assignments to compare constraint levels
      const currentTables = parseAssignmentIds(currentAssignment);
      const newTables = parseAssignmentIds(newAssignment);
      
      const isStricter = (newTables.length > 0 && currentTables.length === 0) ||
                         (newTables.length > 0 && currentTables.length > 0 && 
                          newTables.length < currentTables.length);
      
      console.log(`[Assignment Change] Guest ${guestId}: "${currentAssignment}" → "${newAssignment}", Stricter: ${isStricter}`);
      
      return { 
        ...state, 
        assignments, 
        assignmentSignature: signature, 
        regenerationNeeded: isStricter ? true : state.regenerationNeeded,
        seatingPlans: isStricter ? [] : state.seatingPlans, 
        currentPlanIndex: isStricter ? 0 : state.currentPlanIndex,
        sessionVersion: state.sessionVersion + 1
      };
    }
    case 'SET_SEATING_PLANS': {
      const { plans = [], errors = [] } = action.payload || {};

      // Normalize incoming: accept {type,message} or raw strings
      const incoming = (Array.isArray(errors) ? errors : []).map((e: any) => {
        if (e && typeof e === 'object') {
          const t = typeof e.type === 'string' ? e.type : '';
          const m = e?.message != null ? String(e.message) : '';
          return { type: t, message: m };
        }
        return { type: '', message: String(e ?? '') };
      });

      // Treat "", "warn", "warning" as warnings; ignore empty
      const incomingWarnings = incoming
        .filter((x) => x.message && (x.type === 'warn' || x.type === 'warning' || x.type === ''))
        .map((x) => x.message);

      // Policy:
      // - Success with no new warnings → clear stale warnings
      // - New warnings present → replace (no accumulation)
      // - No plans and no new warnings → preserve prior warnings
      let nextWarnings: string[] = [];
      if (plans.length > 0 && incomingWarnings.length === 0) {
        nextWarnings = [];
      } else if (incomingWarnings.length > 0) {
        nextWarnings = incomingWarnings;
      } else {
        nextWarnings = state.warnings || [];
      }

      // Keep index in range if plans exist; else reset to 0
      const nextPlanIndex = plans.length
        ? Math.min(Math.max(state.currentPlanIndex ?? 0, 0), plans.length - 1)
        : 0;

      return {
        ...state,
        seatingPlans: plans,
        warnings: nextWarnings,
        currentPlanIndex: nextPlanIndex,
        lastGeneratedSignature: state.assignmentSignature ?? null,
        regenerationNeeded: false,
        sessionVersion: (state.sessionVersion ?? 0) + 1
      };
    }
    case 'SET_CURRENT_PLAN_INDEX': return { ...state, currentPlanIndex: action.payload };
    case 'TRIGGER_REGENERATION': 
      console.log('[AppContext] TRIGGER_REGENERATION - clearing plans to force regeneration');
      return { 
        ...state, 
        regenerationNeeded: true,
        seatingPlans: [], 
        currentPlanIndex: 0,
        sessionVersion: state.sessionVersion + 1
      };
    case 'AUTO_RECONCILE_TABLES': return { ...state, tables: reconcileTables(state.tables, state.guests, state.assignments, state.userSetTables) };
    case 'ADD_TABLE': {
      const maxId = Math.max(0, ...state.tables.map(t => t.id || 0));
      const newTable = { id: maxId + 1, seats: 8 };
      console.log('[Table Change] Adding table - preserving plans (relaxation)');
      return { 
        ...state, 
        tables: [...state.tables, newTable], 
        userSetTables: true,
        sessionVersion: state.sessionVersion + 1
        // Do NOT set regenerationNeeded or clear plans (looser change)
      };
    }
    case 'REMOVE_TABLE': {
      const tableId = action.payload;
      const filteredTables = state.tables.filter(t => t.id !== tableId);
      
      // Remove assignments referencing deleted table
      const filteredAssignments = Object.fromEntries(
        Object.entries(state.assignments).map(([guestId, raw]) => {
          const ids = parseAssignmentIds(raw);
          const filtered = ids.filter(id => id !== tableId);
          return [guestId, filtered.join(',')];
        })
      );
      
      console.log('[Table Change] Removing table - regenerating plans (constraint addition)');
      return {
        ...state,
        tables: filteredTables,
        assignments: filteredAssignments,
        userSetTables: true,
        regenerationNeeded: true,
        seatingPlans: [],
        currentPlanIndex: 0,
        sessionVersion: state.sessionVersion + 1
      };
    }
    case 'UPDATE_TABLE': {
      const { id, name, seats } = action.payload;
      const currentTable = state.tables.find(t => t.id === id);
      const updatedTables = state.tables.map(t => 
        t.id === id ? { ...t, ...(name !== undefined && { name }), ...(seats !== undefined && { seats }) } : t
      );
      
      // Use getCapacity for comparison
      const isCapacityReduced = seats !== undefined && currentTable && 
        getCapacity({ ...currentTable, seats }) < getCapacity(currentTable);
      
      if (isCapacityReduced) {
        console.log(`[Table Change] Reducing capacity ${currentTable.seats} → ${seats} - regenerating plans (constraint addition)`);
        return { 
          ...state, 
          tables: updatedTables, 
          userSetTables: true, 
          regenerationNeeded: true,
          seatingPlans: [], 
          currentPlanIndex: 0,
          sessionVersion: state.sessionVersion + 1
        };
      } else {
        // Name change or capacity increase - preserve plans
        console.log(`[Table Change] Name change or capacity increase - preserving plans`);
        return { 
          ...state, 
          tables: updatedTables, 
          userSetTables: true,
          sessionVersion: state.sessionVersion + 1
        };
      }
    }
    case 'SET_USER_SET_TABLES': return { ...state, userSetTables: action.payload };

    case 'IMPORT_STATE':
    case 'LOAD_MOST_RECENT':
    case 'LOAD_SAVED_SETTING': {
      const incoming = action.payload ?? {};
      const executionId = Math.random().toString(36).substr(2, 9);
      console.log(`[LOAD_MOST_RECENT-${executionId}] Incoming payload:`, incoming);
      console.log(`[LOAD_MOST_RECENT-${executionId}] Incoming guests:`, incoming.guests);
      console.log(`[LOAD_MOST_RECENT-${executionId}] Guests length:`, incoming.guests?.length);
      console.log(`[LOAD_MOST_RECENT-${executionId}] Guests type:`, typeof incoming.guests);
      console.log(`[LOAD_MOST_RECENT-${executionId}] Guests isArray:`, Array.isArray(incoming.guests));
      console.log(`[LOAD_MOST_RECENT-${executionId}] !incoming.guests:`, !incoming.guests);
      
      // FIX: More robust condition check with immediate logging
      const hasGuests = incoming.guests && Array.isArray(incoming.guests) && incoming.guests.length > 0;
      console.log(`[LOAD_MOST_RECENT-${executionId}] hasGuests check:`, hasGuests);
      console.log(`[LOAD_MOST_RECENT-${executionId}] incoming.guests:`, incoming.guests);
      console.log(`[LOAD_MOST_RECENT-${executionId}] Array.isArray(incoming.guests):`, Array.isArray(incoming.guests));
      console.log(`[LOAD_MOST_RECENT-${executionId}] incoming.guests.length:`, incoming.guests?.length);
      
      if (!hasGuests) {
        console.log(`[LOAD_MOST_RECENT-${executionId}] No valid guests found, returning current state`);
        return state;
      }
      
      console.log(`[LOAD_MOST_RECENT-${executionId}] Loading guests into state:`, incoming.guests.length, 'guests');
      
      // Format all guest names to ensure consistent spacing
      const formattedGuests = incoming.guests.map((g: Guest) => ({
        ...g,
        name: formatGuestUnitName(g.name)
      }));
      
      // CRITICAL FIX: Preserve current table state if user has made changes
      // Only use incoming tables if user hasn't customized tables locally
      const shouldUseIncomingTables = !state.userSetTables && incoming.tables?.length;
      const tablesToUse = shouldUseIncomingTables ? incoming.tables : state.tables;
      
      console.log(`[LOAD_MOST_RECENT-${executionId}] Table preservation check:`, {
        userSetTables: state.userSetTables,
        incomingTablesLength: incoming.tables?.length,
        shouldUseIncomingTables,
        finalTablesLength: tablesToUse.length
      });
      
      // CRITICAL FIX: Preserve sessionVersion from incoming BEFORE spreading initialState
      const preservedSessionVersion = typeof incoming.sessionVersion === 'number' && incoming.sessionVersion >= 0 
        ? incoming.sessionVersion 
        : state.sessionVersion || 0;
      
      return {
        ...initialState,
        ...incoming,
        guests: formattedGuests,
        tables: tablesToUse,
        user: state.user,
        subscription: state.subscription,
        trial: state.trial,
        loadedRestoreDecision: true,
        isReady: true, // Set readiness after load
        regenerationNeeded: true,
        seatingPlans: [],
        currentPlanIndex: 0,
        warnings: [],
        // CRITICAL FIX: Override sessionVersion after spreading
        sessionVersion: preservedSessionVersion,
        persistenceVersion: incoming.persistenceVersion || '1.0.0'
      };
    }

    case 'RESET_APP_STATE': 
      console.log('[AppContext] RESET_APP_STATE called - clearing all data');
      // CRITICAL: NEVER reset during initialization, even if state.isReady is true
      // because LOAD_SAVED_SETTING sets isReady=true but that doesn't mean we should reset
      if (!state.loadedRestoreDecision) {
        console.log('[AppContext] RESET_APP_STATE blocked - loadedRestoreDecision not set, preserving data');
        return state; // Return unchanged state
      }
      
      // Additional safety: Don't reset if we have guests loaded
      if (state.guests && state.guests.length > 0) {
        console.log('[AppContext] RESET_APP_STATE blocked - guests exist, preserving data');
        return state;
      }
      
      return { 
        ...initialState, 
        user: null, 
        subscription: null, 
        trial: null,
        isReady: true, // CRITICAL: Set ready after reset
        loadedRestoreDecision: true // CRITICAL: Set loaded after reset
      };
    case 'CLEAR_ALL': 
      console.log('[AppContext] CLEAR_ALL called - resetting to initial state');
      return { ...initialState, user: state.user, subscription: state.subscription, trial: state.trial };

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

      // Determine if this is adding or removing constraints
      // const isAddingConstraint = nextState !== '' && currentStateForCycle === '';
      // const isRemovingConstraint = nextState === '' && currentStateForCycle !== '';
      // const isChangingConstraint = nextState !== '' && currentStateForCycle !== '';

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

      // ASYMMETRIC REGENERATION: Only clear plans when adding/changing constraints
      const isStricter = (nextState !== '' && currentStateForCycle === '') || 
                         (nextState !== '' && currentStateForCycle !== '' && nextState !== currentStateForCycle);
      
      return { 
        ...state, 
        constraints: newConstraints, 
        adjacents: newAdjacents, 
        regenerationNeeded: isStricter ? true : state.regenerationNeeded,
        seatingPlans: isStricter ? [] : state.seatingPlans,
        currentPlanIndex: isStricter ? 0 : state.currentPlanIndex,
        sessionVersion: state.sessionVersion + 1
      };
    }

    default: return state;
  }
};

const AppContext = createContext<{
  state: AppState; dispatch: React.Dispatch<AppAction>; mode: Mode; sessionTag: SessionTag; isPremium: boolean;
  // Persistence utilities
  exportData: () => void;
  importData: (file: File) => Promise<{ success: boolean; error?: string; data?: AppState }>;
  clearAllData: () => void;
  getStorageStats: () => { localStorage: number; backups: number; indexedDBAvailable: boolean };
  isInitialized: boolean;
} | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [sessionTag, setSessionTag] = useState<SessionTag>('INITIALIZING');
  const [fatalError] = useState<Error | null>(null);
  const userRef = useRef<User | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  
  // Autosave memos - moved before saveToLocalStorage to prevent hoisting issues
  const autosavePayload = useMemo(() => {
    // CRITICAL: Exclude timestamp from hash but include all other important state
    const { timestamp, ...rest } = state;
    return {
      guests: rest.guests || [],
      tables: rest.tables || [],
      constraints: rest.constraints || {},
      adjacents: rest.adjacents || {},
      assignments: rest.assignments || {},
      userSetTables: rest.userSetTables || false,
      seatingPlans: rest.seatingPlans || [],
      currentPlanIndex: rest.currentPlanIndex || 0,
      warnings: rest.warnings || [],
      conflictWarnings: rest.conflictWarnings || [],
      duplicateGuests: rest.duplicateGuests || [],
      assignmentSignature: rest.assignmentSignature || '',
      lastGeneratedSignature: rest.lastGeneratedSignature || null,
      hideTableReductionNotice: rest.hideTableReductionNotice || false,
    };
  }, [state]);

  const autosaveSignature = useMemo(() => fnv1a32(JSON.stringify(autosavePayload)), [autosavePayload]);
  const lastAutosaveSigRef = useRef<string>("");
  
  // Manual save function for better control - now uses robust persistence
  const saveToLocalStorage = useCallback(async () => {
    try {
      const stateToSave: AppState = {
        ...state,
        timestamp: new Date().toISOString(),
      };
      
      // Use robust persistence system
      const result = await saveAppState(stateToSave);
      if (result.success) {
        console.log('[Manual Save] State saved successfully with robust persistence');
      } else {
        console.warn('[Manual Save] Robust persistence failed, falling back to localStorage:', result.error);
        // Fallback to old method
        localStorage.setItem('seatyr_app_state', JSON.stringify(stateToSave));
      }
    } catch (err) {
      console.warn('[Manual Save] Failed to save:', err);
    }
  }, [autosavePayload, sessionTag, state.isReady, state.loadedRestoreDecision, state.regenerationNeeded]);
  
  // State management
  const stateRef = useRef(state);
  const genRef = useRef(0); // Generation counter
  
  // NEW: Modal state and refs
  const isMountedRef = useRef(true);
  const [mostRecentState, setMostRecentState] = useState<AppState | null>(null);
  const [showRecentModal, setShowRecentModal] = useState(false);
  const [recentError, setRecentError] = useState<string | null>(null);

  // CRITICAL: Keep stateRef synced
  useEffect(() => { stateRef.current = state; }, [state]);
  
  // Async initialization with robust persistence
  useEffect(() => {
    const initializeApp = async () => {
      console.log('[AppProvider] Starting robust persistence initialization...');
      try {
        // Try to load from robust persistence system
        const result = await loadAppState();
        if (result.success && result.data) {
          console.log('[AppProvider] Loaded data from robust persistence system');
          const migratedData = applySanitizedState(result.data);
          dispatch({ type: 'LOAD_SAVED_SETTING', payload: migratedData });
        } else {
          // Fallback to old localStorage method
          const saved = localStorage.getItem('seatyr_app_state');
          console.log('[AppProvider] localStorage data exists:', !!saved);
          if (saved) {
            console.log('[AppProvider] Loading from localStorage fallback...');
            const fallbackResult = applySanitizedState(JSON.parse(saved));
            dispatch({ type: 'LOAD_SAVED_SETTING', payload: fallbackResult });
          }
        }
      } catch (err) {
        console.error('[AppProvider] Persistence load error:', err);
      } finally {
        setIsInitialized(true);
        dispatch({ type: 'SET_READY' });
        dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
      }
    };
    
    initializeApp();
  }, []);
  
  // Trigger manual save on important state changes
  useEffect(() => {
    if (state.isReady && state.loadedRestoreDecision) {
      // Save when guests, tables, or seating plans change
      const timeoutId = setTimeout(() => {
        saveToLocalStorage();
      }, 200);
      
      return () => clearTimeout(timeoutId);
    }
  }, [state.guests.length, state.tables.length, state.seatingPlans.length, state.isReady, state.loadedRestoreDecision, saveToLocalStorage]);

  // Mounted lifecycle effect
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Single-flight entitlements + auth FSM
  useEffect(() => {
    let hasInitialized = false;
    
    // FIX: Rename to avoid shadowing
    const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!isMountedRef.current) return;

      console.log('[Auth] Auth state change:', event, 'Session exists:', !!session, 'Has initialized:', hasInitialized, 'SessionTag:', sessionTag);

      if (event === 'SIGNED_OUT') {
        // CRITICAL: Never reset data during initialization
        if (sessionTag === 'INITIALIZING' || !hasInitialized) {
          console.log('[Auth] Sign-out during initialization, preserving data - NO RESET');
          setSessionTag('ANON');
          dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
          dispatch({ type: 'SET_READY' });
          hasInitialized = true;
          return;
        }
        
        // Only reset on actual sign-out after initialization
        console.log('[Auth] Actual sign-out detected, clearing data');
        try { localStorage.removeItem('seatyr_app_state'); } catch {}
        dispatch({ type: 'RESET_APP_STATE' });
        setSessionTag('ANON');
        dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
        dispatch({ type: 'SET_READY' });
        hasInitialized = true;
        return;
      }

      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        if (session?.user) {
          dispatch({ type: 'SET_USER', payload: session.user });
          userRef.current = session.user;

          try {
            console.log('[Auth] Getting entitlements...');
            // FIX: Rename to avoid shadowing
            const { subscription: entSub, trial } = await loadEntitlementsOnce(session.user.id);
            if (!isMountedRef.current) return;

            const isPremium = isPremiumSubscription(entSub, trial);
            dispatch({ type: 'SET_SUBSCRIPTION', payload: entSub });
            dispatch({ type: 'SET_TRIAL', payload: trial });
            setSessionTag('ENTITLED');

            if (isPremium) {
              console.log('[Auth] Premium user, fetching most recent state...');
              const data = await getMostRecentState(session.user.id);
              console.log('[Auth] Most recent state fetched:', data);
              console.log('[Auth] Data guests:', data?.guests);
              console.log('[Auth] Data guests length:', data?.guests?.length);
              
              if (isMountedRef.current && data?.guests?.length && data.guests.length > 0) {
                console.log('[Auth] Setting most recent state and showing modal');
                setMostRecentState(data);
                setShowRecentModal(true);
              }

              // Always set loadedRestoreDecision after mostRecentState check
              console.log('[Auth] Setting loadedRestoreDecision (modal choice can happen async)');
              dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
              dispatch({ type: 'SET_READY' });
              hasInitialized = true;
            } else {
              console.log('[Auth] Not premium user, skipping recent state fetch');
              dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
              dispatch({ type: 'SET_READY' }); // CRITICAL: Set ready for non-premium users
              hasInitialized = true;
            }

          } catch (err) {
            // CRITICAL: Graceful degradation
            if (!isMountedRef.current) return;
            console.error('[Auth] Entitlements fetch FAILED.', err);
            setSessionTag('ENTITLED');
            dispatch({ type: 'SET_SUBSCRIPTION', payload: null });
            dispatch({ type: 'SET_TRIAL', payload: null });
            dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
            dispatch({ type: 'SET_READY' }); // CRITICAL: Set ready even on error
            hasInitialized = true;
          }
        } else {
          // Anonymous
          setSessionTag('ANON');
          dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
          dispatch({ type: 'SET_READY' }); // CRITICAL: Set ready for anonymous users
          hasInitialized = true;
        }
        
        // Enable reset after successful initialization (REMOVED phantom timer)
      }
    });

    return () => { authSub.unsubscribe(); };
  }, []); // FIX: Remove state.user dependency to prevent re-subscription


  const isPremium = useMemo(
    () => isPremiumSubscription(state.subscription, state.trial),
    [state.subscription, state.trial]
  );

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

  // Premium autosave
  useEffect(() => {
    if (!isPremium || !state.user?.id || showRecentModal) return;
    if (autosaveSignature === lastAutosaveSigRef.current) return;

    const t = setTimeout(() => {
      console.log('[Autosave Premium] Data signature changed. Saving...');
      // CRITICAL: Call 3-arg function
      saveMostRecentState(state.user!.id, state, true)
        .then(() => { lastAutosaveSigRef.current = autosaveSignature; })
        .catch((err) => { console.error('[Autosave Premium] FAILED:', err); });
    }, 500);

    return () => clearTimeout(t);
  }, [state, autosaveSignature, showRecentModal, isPremium]);

  // Enhanced persistence for both anonymous and authenticated users - now uses robust system
  useEffect(() => {
    if (autosaveSignature === lastAutosaveSigRef.current) return;

    const t = setTimeout(async () => {
      try {
        // Save complete state using robust persistence system
        const stateToSave = {
          ...state,
          timestamp: new Date().toISOString(),
        };
        
        const result = await saveAppState(stateToSave as any);
        if (result.success) {
          lastAutosaveSigRef.current = autosaveSignature;
          
          // NEW: Save LKG after successful primary save
          saveLKG(stateToSave as any);
          
          if (process.env.NODE_ENV === 'development') {
            console.log('[Persistence] Saved state with robust persistence:', {
              guests: stateToSave.guests.length,
              tables: stateToSave.tables.length,
              seatingPlans: stateToSave.seatingPlans.length,
              sessionVersion: stateToSave.sessionVersion
            });
          }
        } else {
          console.warn('[Persistence] Robust persistence failed, falling back to localStorage:', result.error);
          localStorage.setItem('seatyr_app_state', JSON.stringify(stateToSave));
          lastAutosaveSigRef.current = autosaveSignature;
        }
      } catch (err) {
        console.warn('[Persistence] Failed to save:', err);
      }
    }, 100);

    return () => clearTimeout(t);
  }, [autosaveSignature, sessionTag]);

  // Debounced plan generation - use useCallback to prevent recreation
  const debouncedGeneratePlans = useCallback(() => {
    const s = stateRef.current;
    
    // Guards - use state.isReady (single source of truth)
    if (!s.isReady || !s.loadedRestoreDecision || !s.regenerationNeeded) return;
    if (s.guests.length === 0 || s.tables.length === 0) return;
    
    const genId = ++genRef.current;
    
    if (process.env.NODE_ENV === 'development') {
      console.log('[Generator] Running:', {
        guests: s.guests.length,
        tables: s.tables.length,
        isPremium: isPremiumSubscription(s.subscription, s.trial)
      });
    }
    
    // Use actual function name from imports
    engineGenerate({
      guests: s.guests,
      tables: s.tables,
      constraints: s.constraints,
      adjacents: s.adjacents,
      assignments: s.assignments,
      isPremium: isPremiumSubscription(s.subscription, s.trial)
    }).then(({ plans, errors }) => {
      if (genId === genRef.current) {
        dispatch({ type: 'SET_SEATING_PLANS', payload: { plans, errors } });
      }
    }).catch((err) => {
      console.error('[Generator] Failed:', err);
      // CRITICAL: Always dispatch to set regenerationNeeded to false, even on error
      if (genId === genRef.current) {
        dispatch({ 
          type: 'SET_SEATING_PLANS', 
          payload: { 
            plans: [], 
            errors: [{ 
              type: 'error', 
              message: err instanceof Error ? err.message : 'Failed to generate seating plans' 
            }] 
          } 
        });
      }
    });
  }, [dispatch]);

  // Debounced wrapper
  const debouncedGeneratePlansWrapper = useMemo(() => {
    return debounce(debouncedGeneratePlans, 180, { leading: false, trailing: true });
  }, [debouncedGeneratePlans]);

  // Cleanup
  useEffect(() => {
    return () => { debouncedGeneratePlansWrapper.cancel(); };
  }, [debouncedGeneratePlansWrapper]);

  // Trigger effect - use state.isReady (single source of truth)
  useEffect(() => {
    const s = stateRef.current;
    
    if (s.isReady && s.loadedRestoreDecision && s.regenerationNeeded && 
        s.guests.length > 0 && s.tables.length > 0) {
      debouncedGeneratePlansWrapper();
    }
  }, [
    state.guests,
    state.constraints,
    state.adjacents,
    state.assignments,
    state.tables,
    state.regenerationNeeded,
    state.isReady,
    state.loadedRestoreDecision,
    debouncedGeneratePlansWrapper
  ]);

  // Auto reconcile table count when guests/assignments change
  useEffect(() => {
    dispatch({ type: 'AUTO_RECONCILE_TABLES' });
  }, [state.guests.length, state.assignmentSignature, state.userSetTables]);

  const mode = useMemo(() => deriveMode(state.user, state.subscription, state.trial), [state.user, state.subscription, state.trial]);
  const value = useMemo(() => ({ 
    state, dispatch, mode, sessionTag, isPremium,
    // Add persistence utilities
    exportData: () => exportAppState(state),
    importData: importAppState,
    clearAllData: clearAllSavedData,
    getStorageStats,
    isInitialized
  }), [state, mode, sessionTag, isPremium, isInitialized]);

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

      {showRecentModal && state.user && isPremium && mostRecentState && (
        // Try to use existing component first
        typeof MostRecentChoiceModal !== 'undefined' ? (
          <MostRecentChoiceModal
            userId={state.user.id}
            isPremium={isPremium}
            recentTimestamp={mostRecentState?.timestamp}
            onClose={() => {
              console.log('[Modal] onClose called');
              setShowRecentModal(false);
              setMostRecentState(null);
              setRecentError(null);
              dispatch({ type: 'SET_READY' });
              console.log('[Modal] onClose complete');
            }}
            onRestoreRecent={async () => {
              console.log('[Modal] onRestoreRecent START');
              if (mostRecentState) {
                dispatch({ type: 'LOAD_MOST_RECENT', payload: mostRecentState });
              }
              setShowRecentModal(false);
              setMostRecentState(null);
              dispatch({ type: 'SET_READY' });
              console.log('[Modal] onRestoreRecent COMPLETE');
            }}
            onKeepCurrent={async () => {
              console.log('[Modal] onKeepCurrent START');
              dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
              dispatch({ type: 'SET_READY' });
              setShowRecentModal(false);
              setMostRecentState(null);
              console.log('[Modal] onKeepCurrent COMPLETE');
            }}
            error={recentError}
            loading={false}
          />
        ) : (
          // Inline fallback modal
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full">
              <h3 className="text-lg font-medium mb-3">Restore Session?</h3>
              <p className="text-sm text-gray-600 mb-4">
                Cloud data was found. Restore it or keep the current session?
              </p>
              <div className="flex justify-end gap-2">
                <button 
                  onClick={async () => {
                    dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
                    dispatch({ type: 'SET_READY' });
                    setShowRecentModal(false);
                    setMostRecentState(null);
                  }}
                  className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300"
                >
                  Keep Current
                </button>
                <button 
                  onClick={async () => {
                    if (mostRecentState) {
                      dispatch({ type: 'LOAD_MOST_RECENT', payload: mostRecentState });
                    }
                    setShowRecentModal(false);
                    setMostRecentState(null);
                    dispatch({ type: 'SET_READY' });
                  }}
                  className="px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  Restore Recent
                </button>
              </div>
            </div>
          </div>
        )
      )}
    </AppContext.Provider>
  );
};

export function useApp(): {
  state: AppState; dispatch: React.Dispatch<AppAction>; mode: Mode; sessionTag: SessionTag; isPremium: boolean;
} {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

