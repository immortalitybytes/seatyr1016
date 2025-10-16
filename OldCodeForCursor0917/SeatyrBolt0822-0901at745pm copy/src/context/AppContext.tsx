import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useState,
  useMemo,
  ReactNode,
} from 'react';
import {
  Guest,
  Table,
  Constraint,
  SeatingPlan,
  UserSubscription,
  AppState
} from '../types';
import { getMaxGuestLimit, isPremiumSubscription } from '../utils/premium';
import { supabase, supabaseConfigured, testSupabaseConnection } from '../lib/supabase';
import {
  loadRecentSessionSettings,
  clearRecentSessionSettings,
} from '../lib/sessionSettings';
import {
  getMostRecentState,
  clearMostRecentState,
  saveMostRecentState
} from '../lib/mostRecentState';
import MostRecentChoiceModal from '../components/MostRecentChoiceModal';

const STORAGE_KEY = 'seatyr_app_state';

const defaultTables: Table[] = Array.from({ length: 10 }, (_, i) => ({
  id: i + 1,
  seats: 8,
}));

// ---------- AUTO-TABLE RECONCILIATION HELPERS (Batch 2) ----------
const DEFAULT_TABLE_CAPACITY = 8;

function isAssignedToTable(
  t: { id: number; name?: string },
  assignments: Record<string, string> | undefined
): boolean {
  if (!assignments) return false;
  const tName = (t.name || '').trim().toLowerCase();
  for (const raw of Object.values(assignments)) {
    if (!raw) continue;
    const toks = String(raw).split(',').map(s => s.trim()).filter(Boolean);
    for (const tok of toks) {
      const n = Number(tok);
      if (!Number.isNaN(n) && n === t.id) return true;
      if (tName && tok.toLowerCase() === tName) return true;
    }
  }
  return false;
}

function isTableLocked(
  t: { id: number; name?: string; seats: number },
  assignments: Record<string, string> | undefined
): boolean {
  const named = !!t.name && t.name.trim().length > 0;
  const capacityChanged = t.seats !== DEFAULT_TABLE_CAPACITY;
  const hasAssign = isAssignedToTable(t, assignments);
  return named || capacityChanged || hasAssign;
}

function totalSeatsNeeded(guests: { count?: number }[]): number {
  return guests.reduce((s, g) => s + Math.max(1, g.count ?? 1), 0);
}

function reconcileTables(
  tables: { id: number; name?: string; seats: number }[],
  guests: { count?: number }[],
  assignments: Record<string, string> | undefined
) {
  const needed = totalSeatsNeeded(guests);
  let lockedCap = 0;
  for (const t of tables) if (isTableLocked(t, assignments)) lockedCap += Math.max(0, t.seats);
  const remaining = Math.max(0, needed - lockedCap);
  const requiredUntouched = Math.ceil(remaining / DEFAULT_TABLE_CAPACITY);

  const untouched = tables.filter(t => !isTableLocked(t, assignments) && t.seats === DEFAULT_TABLE_CAPACITY);
  const delta = requiredUntouched - untouched.length;
  if (delta === 0) return tables;

  if (delta > 0) {
    const ids = tables.map(t => t.id);
    let next = ids.length ? Math.max(...ids) + 1 : 1;
    const out = tables.slice();
    for (let i = 0; i < delta; i++) out.push({ id: next++, name: '', seats: DEFAULT_TABLE_CAPACITY });
    return out;
  } else {
    const toRemove = untouched.slice().sort((a,b) => b.id - a.id).slice(0, -delta).map(t => t.id);
    return tables.filter(t => !toRemove.includes(t.id));
  }
}

type AppAction =
  | { type: 'ADD_GUESTS'; payload: Guest[] }
  | { type: 'REMOVE_GUEST'; payload: number }
  | { type: 'RENAME_GUEST'; payload: { oldName: string; newName: string } }
  | { type: 'UPDATE_GUEST_COUNT'; payload: { index: number; count: number } }
  | { type: 'CLEAR_GUESTS' }
  | { type: 'SET_GUESTS'; payload: Guest[] }
  | { type: 'SET_CONSTRAINT'; payload: { guest1: string; guest2: string; value: 'must' | 'cannot' | '' } }
  | { type: 'SET_ADJACENT'; payload: { guest1: string; guest2: string } }
  | { type: 'REMOVE_ADJACENT'; payload: { guest1: string; guest2: string } }
  | { type: 'ADD_TABLE'; payload: Partial<Table> }
  | { type: 'REMOVE_TABLE'; payload: number }
  | { type: 'UPDATE_TABLE_SEATS'; payload: { id: number; seats: number } }
  | { type: 'UPDATE_TABLE_NAME'; payload: { id: number; name?: string } }
  | { type: 'UPDATE_ASSIGNMENT'; payload: { name: string; tables: string } }
  | { type: 'SET_SEATING_PLANS'; payload: SeatingPlan[] }
  | { type: 'SET_CURRENT_PLAN_INDEX'; payload: number }
  | { type: 'SET_SUBSCRIPTION'; payload: UserSubscription | null }
  | { type: 'SET_USER'; payload: any }
  | { type: 'SET_USER_SET_TABLES'; payload: boolean }
  | { type: 'SET_LOADED_SAVED_SETTING'; payload: boolean }
  | { type: 'UPDATE_DEFAULT_TABLES'; payload: Table[] }
  | { type: 'IMPORT_STATE'; payload: Partial<AppState> }
  | { type: 'RESET_APP_STATE'; payload?: { skipTrimForPremium?: boolean } }
  | { type: 'LOAD_MOST_RECENT'; payload: AppState }
  | { type: 'SET_SUPABASE_CONNECTED'; payload: boolean }
  | { type: 'SET_DUPLICATE_GUESTS'; payload: string[] }
  | { type: 'HIDE_TABLE_REDUCTION_NOTICE' }
  | { type: 'AUTO_RECONCILE_TABLES' };

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
  isSupabaseConnected: false,
  hideTableReductionNotice: false,
  duplicateGuests: []
};

const loadSavedState = (): AppState => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      delete parsed.subscription;
      delete parsed.user;
      delete parsed.isSupabaseConnected;
      return { ...initialState, ...parsed };
    }
  } catch (err) {
    console.error('Error loading saved state:', err);
  }
  return initialState;
};

const calculateRequiredTables = (guestCount: number, seatsPerTable: number = 8): Table[] => {
  const totalTablesNeeded = Math.ceil(guestCount / seatsPerTable);
  return Array.from({ length: totalTablesNeeded }, (_, i) => ({
    id: i + 1,
    seats: seatsPerTable,
  }));
};

// Calculate minimum number of tables needed based on guest count
const calculateMinTablesNeeded = (guestCount: number, seatsPerTable: number = 8): number => {
  return Math.ceil(guestCount / seatsPerTable);
};

const reducer = (state: AppState, action: AppAction): AppState => {
  let newState = state;

  switch (action.type) {
    case 'SET_GUESTS': {
      newState = {
        ...state,
        guests: action.payload,
        seatingPlans: [],
      };
      break;
    }

    case 'ADD_GUESTS': {
      const newGuests = [...state.guests, ...action.payload];
      const totalGuests = newGuests.length;
      const guestLimit = getMaxGuestLimit(state.subscription);

      if (totalGuests > guestLimit) {
        console.log(`Cannot add guests: limit of ${guestLimit} exceeded (total: ${totalGuests})`);
        alert(`You can only have up to ${guestLimit} guests with your current plan. Upgrade to Premium for unlimited guests.`);
        return state;
      }

      let newTables = state.tables;
      if (!state.userSetTables) {
        const totalGuestCount = newGuests.reduce((sum, guest) => sum + guest.count, 0);
        const minTablesNeeded = calculateMinTablesNeeded(totalGuestCount);
        
        // Only increase table count, never decrease
        if (minTablesNeeded > state.tables.length) {
          newTables = calculateRequiredTables(totalGuestCount);
        }
      }

      newState = {
        ...state,
        guests: newGuests,
        tables: newTables,
        seatingPlans: [],
        // Reset hide flag when guests are added (might need more tables)
        hideTableReductionNotice: false
      };
      break;
    }
    case 'REMOVE_GUEST': {
      const newGuests = [...state.guests];
      if (action.payload < 0 || action.payload >= newGuests.length) {
        console.warn(`REMOVE_GUEST: invalid index ${action.payload}`);
        return state;
      }

      const removedGuest = newGuests.splice(action.payload, 1)[0];

      const newConstraints = { ...state.constraints };
      delete newConstraints[removedGuest.name];
      Object.keys(newConstraints).forEach(guest => {
        if (newConstraints[guest]?.[removedGuest.name]) {
          delete newConstraints[guest][removedGuest.name];
        }
      });

      const newAdjacents = { ...state.adjacents };
      delete newAdjacents[removedGuest.name];
      Object.keys(newAdjacents).forEach(guest => {
        newAdjacents[guest] = newAdjacents[guest]?.filter(name => name !== removedGuest.name);
      });

      const newAssignments = { ...state.assignments };
      delete newAssignments[removedGuest.name];

      // When removing guests, keep the current tables (don't auto-decrease)
      let newTables = state.tables;

      newState = {
        ...state,
        guests: newGuests,
        constraints: newConstraints,
        adjacents: newAdjacents,
        assignments: newAssignments,
        tables: newTables,
        // Reset hide flag when guests are removed (table reduction might be possible)
        hideTableReductionNotice: false
      };
      break;
    }
    case 'RENAME_GUEST': {
      const { oldName, newName } = action.payload;
      if (!oldName || !newName || oldName === newName) return state;

      // 1) guests array
      const guests = (state.guests || []).map(g => g.name === oldName ? { ...g, name: newName } : g);

      // 2) constraints: row rename and column rename
      const constraints = { ...(state.constraints || {}) };
      if (constraints[oldName]) {
        constraints[newName] = { ...(constraints[oldName]) };
        delete constraints[oldName];
      }
      for (const r of Object.keys(constraints)) {
        if (constraints[r] && Object.prototype.hasOwnProperty.call(constraints[r], oldName)) {
          constraints[r][newName] = constraints[r][oldName];
          delete constraints[r][oldName];
        }
      }

      // 3) adjacents: key rename and list element rename
      const adjacents = { ...(state.adjacents || {}) };
      if (adjacents[oldName]) {
        adjacents[newName] = Array.from(new Set(adjacents[oldName].map(n => n === oldName ? newName : n)));
        delete adjacents[oldName];
      }
      for (const k of Object.keys(adjacents)) {
        adjacents[k] = Array.from(new Set((adjacents[k] || []).map(n => n === oldName ? newName : n)));
      }

      // 4) assignments: move entry to new key
      const assignments = { ...(state.assignments || {}) };
      if (Object.prototype.hasOwnProperty.call(assignments, oldName)) {
        assignments[newName] = assignments[oldName];
        delete assignments[oldName];
      }

      return { ...state, guests, constraints, adjacents, assignments };
    }
    case 'UPDATE_GUEST_COUNT': {
      const { index, count } = action.payload;
      const newGuests = [...state.guests];
      
      if (index < 0 || index >= newGuests.length) {
        console.warn(`UPDATE_GUEST_COUNT: invalid index ${index}`);
        return state;
      }
      
      newGuests[index] = { ...newGuests[index], count };
      
      newState = {
        ...state,
        guests: newGuests,
      };
      break;
    }
    case 'CLEAR_GUESTS': {
      newState = {
        ...state,
        guests: [],
        constraints: {},
        adjacents: {},
        assignments: {},
        seatingPlans: [],
        hideTableReductionNotice: false,
        duplicateGuests: []
      };
      break;
    }

    case 'SET_CONSTRAINT': {
      const { guest1, guest2, value } = action.payload;
      const newConstraints = { ...state.constraints };

      if (!newConstraints[guest1]) newConstraints[guest1] = {};
      if (!newConstraints[guest2]) newConstraints[guest2] = {};

      // If a 'must' constraint is being removed, check if an adjacency exists
      // and remove it to maintain consistent state
      if (value !== 'must') {
        const currentAdjacents1 = state.adjacents[guest1] || [];
        const currentAdjacents2 = state.adjacents[guest2] || [];
        
        if (currentAdjacents1.includes(guest2) || currentAdjacents2.includes(guest1)) {
          // Remove the adjacency to maintain consistency
          const newAdjacents = { ...state.adjacents };
          newAdjacents[guest1] = (newAdjacents[guest1] || []).filter(g => g !== guest2);
          newAdjacents[guest2] = (newAdjacents[guest2] || []).filter(g => g !== guest1);
          
          // Update both constraints and adjacents
          newConstraints[guest1][guest2] = value;
          newConstraints[guest2][guest1] = value;
          
          return {
            ...state,
            constraints: newConstraints,
            adjacents: newAdjacents,
          };
        }
      }

      newConstraints[guest1][guest2] = value;
      newConstraints[guest2][guest1] = value;

      newState = {
        ...state,
        constraints: newConstraints,
      };
      break;
    }

    case 'SET_ADJACENT': {
      const { guest1, guest2 } = action.payload;
      const constraints = { ...state.constraints };
      const adjacents = { ...state.adjacents };

      constraints[guest1] = { ...(constraints[guest1] || {}) };
      constraints[guest2] = { ...(constraints[guest2] || {}) };

      if (constraints[guest1][guest2] === 'cannot') delete constraints[guest1][guest2];
      if (constraints[guest2][guest1] === 'cannot') delete constraints[guest2][guest1];

      const addAdj = (a: string, b: string) => {
        const cur = new Set(adjacents[a] || []);
        cur.add(b);
        if (cur.size > 2) return false; // degree cap
        adjacents[a] = Array.from(cur);
        return true;
      };

      if (!addAdj(guest1, guest2) || !addAdj(guest2, guest1)) return state;
      return { ...state, constraints, adjacents };
    }
    case 'REMOVE_ADJACENT': {
      const { guest1, guest2 } = action.payload;
      const newAdjacents = { ...state.adjacents };

      newAdjacents[guest1] = (newAdjacents[guest1] || []).filter(g => g !== guest2);
      newAdjacents[guest2] = (newAdjacents[guest2] || []).filter(g => g !== guest1);

      newState = {
        ...state,
        adjacents: newAdjacents,
      };
      break;
    }

    case 'ADD_TABLE': {
      const newId = state.tables.length > 0
        ? Math.max(...state.tables.map(t => t.id)) + 1
        : 1;
      const newTable: Table = {
        id: newId,
        seats: 8,
        ...action.payload,
      };

      newState = {
        ...state,
        tables: [...state.tables, newTable],
        hideTableReductionNotice: true // Hide reduction notice when user adds a table manually
      };
      break;
    }

    case 'REMOVE_TABLE': {
      const updated = state.tables.filter(t => t.id !== action.payload);
      newState = {
        ...state,
        tables: updated,
        hideTableReductionNotice: false
      };
      break;
    }

    case 'UPDATE_TABLE_SEATS': {
      const { id, seats } = action.payload;
      const currentTable = state.tables.find(t => t.id === id);
      
      // Check if this is an increase in seats
      const isIncrease = currentTable && seats > currentTable.seats;
      
      const updated = state.tables.map(t =>
        t.id === id ? { ...t, seats } : t
      );
      
      newState = {
        ...state,
        tables: updated,
        // Hide reduction notice if user is manually increasing seats
        hideTableReductionNotice: isIncrease ? true : state.hideTableReductionNotice
      };
      break;
    }
    case 'UPDATE_TABLE_NAME': {
      const { id, name } = action.payload;
      const updated = state.tables.map(t =>
        t.id === id ? { ...t, name } : t
      );
      newState = {
        ...state,
        tables: updated,
      };
      break;
    }

    case 'UPDATE_ASSIGNMENT': {
      const newAssignments = { ...state.assignments };
      if (!action.payload.name) {
        console.warn('UPDATE_ASSIGNMENT: empty guest name');
        return state;
      }
      if (action.payload.tables) {
        newAssignments[action.payload.name] = action.payload.tables;
      } else {
        delete newAssignments[action.payload.name];
      }

      newState = {
        ...state,
        assignments: newAssignments,
      };
      break;
    }

    case 'SET_SEATING_PLANS': {
      newState = {
        ...state,
        seatingPlans: action.payload,
      };
      break;
    }

    case 'SET_CURRENT_PLAN_INDEX': {
      newState = {
        ...state,
        currentPlanIndex: action.payload,
      };
      break;
    }
    case 'SET_SUBSCRIPTION': {
      newState = {
        ...state,
        subscription: action.payload,
      };
      break;
    }

    case 'SET_USER': {
      newState = {
        ...state,
        user: action.payload,
      };
      break;
    }

    case 'SET_USER_SET_TABLES': {
      newState = {
        ...state,
        userSetTables: action.payload,
      };
      break;
    }

    case 'SET_LOADED_SAVED_SETTING': {
      newState = {
        ...state,
        loadedSavedSetting: action.payload,
      };
      break;
    }

    case 'SET_SUPABASE_CONNECTED': {
      newState = {
        ...state,
        isSupabaseConnected: action.payload,
      };
      break;
    }
    
    case 'SET_DUPLICATE_GUESTS': {
      newState = {
        ...state,
        duplicateGuests: action.payload,
      };
      break;
    }
    
    case 'HIDE_TABLE_REDUCTION_NOTICE': {
      newState = {
        ...state,
        hideTableReductionNotice: true
      };
      break;
    }

    case 'UPDATE_DEFAULT_TABLES': {
      newState = {
        ...state,
        tables: action.payload,
        userSetTables: true, // Changed: Now setting userSetTables to true to disable auto-table behavior
        // Reset hide flag since tables have been changed
        hideTableReductionNotice: true // Mark as hidden when user manually updates tables
      };
      break;
    }

    case 'IMPORT_STATE': {
      const importedState = action.payload;
      
      // Never trim guest lists - premium or not
      newState = {
        ...state,
        ...importedState,
        subscription: state.subscription, // Keep current subscription
        user: state.user, // Keep current user
        isSupabaseConnected: state.isSupabaseConnected, // Keep connection status
        // Reset hide flag for new imported state
        hideTableReductionNotice: false,
        // Clear duplicate guests
        duplicateGuests: []
      };
      break;
    }
    case 'RESET_APP_STATE': {
      // Reset to initial state with empty guests list (no trimming at all)
      newState = {
        ...initialState,
        isSupabaseConnected: state.isSupabaseConnected,
        subscription: null,  // Explicitly set to null to ensure premium status is reset
        user: null,          // Explicitly clear user to prevent persistence
        guests: [],          // Always use empty guests array for complete reset
        tables: defaultTables, // Reset tables to default
        hideTableReductionNotice: false,
        duplicateGuests: []
      };

      // Don't try to clear remote data during reset
      // This is now handled separately after logout is complete
      
      // Reset setting name in localStorage
      try {
        localStorage.removeItem('seatyr_current_setting_name');
      } catch (err) {
        console.error('Error clearing setting name:', err);
      }

      break;
    }

    case 'LOAD_MOST_RECENT': {
      const fullState = action.payload;
      newState = {
        ...fullState,
        subscription: state.subscription,
        user: state.user,
        isSupabaseConnected: state.isSupabaseConnected,
        loadedSavedSetting: true,
        hideTableReductionNotice: false,
        duplicateGuests: []
      };
      break;
    }

    case 'AUTO_RECONCILE_TABLES': {
      const nextTables = reconcileTables(state.tables || [], state.guests || [], state.assignments || {});
      if (nextTables === state.tables) return state;
      return { ...state, tables: nextTables };
    }

    default:
      return state;
  }

  // Enhanced auto-save logic for premium users with better throttling
  const shouldAutoSave = newState.user && isPremiumSubscription(newState.subscription);
  if (shouldAutoSave && (
    action.type === 'SET_GUESTS' || 
    action.type === 'ADD_GUESTS' || 
    action.type === 'REMOVE_GUEST' ||
    action.type === 'SET_CONSTRAINT' ||
    action.type === 'UPDATE_TABLE_SEATS' ||
    action.type === 'SET_SEATING_PLANS'
  )) {
    // Debounced auto-save will be handled in the effect
  }

  try {
    const stateToSave = { ...newState };
    delete stateToSave.subscription;
    delete stateToSave.user;
    delete stateToSave.isSupabaseConnected;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
  } catch (error) {
    console.error('Error saving state:', error);
  }

  return newState;
};
interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

interface AppProviderProps {
  children: ReactNode;
}

export const AppProvider = ({ children }: AppProviderProps) => {
  const [showRecentModal, setShowRecentModal] = useState(false);
  const [mostRecentState, setMostRecentState] = useState<AppState | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [recentStateError, setRecentStateError] = useState<string | null>(null);
  const [recentStateFetched, setRecentStateFetched] = useState(false);
  const [authStateChanged, setAuthStateChanged] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState<number>(0);
  const [saveDebounceTimer, setSaveDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  const [state, dispatch] = useReducer(reducer, undefined, loadSavedState);
  
  // Function to fetch the most recent state for a user
  const fetchMostRecentState = async (userId: string) => {
    try {
      console.log('Fetching most recent state for user:', userId);
      setRecentStateError(null);
      const recent = await getMostRecentState(userId);
      
      if (recent) {
        console.log('Found most recent state from:', recent.timestamp);
        setMostRecentState(recent);
        setShowRecentModal(true);
      } else {
        console.log('No recent state found for user:', userId);
      }
      
      setRecentStateFetched(true);
      return recent;
    } catch (err) {
      console.error('Error fetching most recent state:', err);
      setRecentStateError('Failed to load your most recent state. Please try again or load from saved settings.');
      // Always show the modal even if there's an error, so user can make a choice
      setShowRecentModal(true);
      setRecentStateFetched(true);
      return null;
    }
  };
  
  // Track authentication state changes to ensure modal display
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        console.log('Auth state changed in AppContext: SIGNED_IN');
        setAuthStateChanged(true);
      }
    });
    
    return () => {
      subscription.unsubscribe();
    };
  }, []);
  
  // Auto-save effect for premium users - debounce to prevent too many saves
  useEffect(() => {
    // Only proceed if we have a valid user and premium subscription
    if (state.user && isPremiumSubscription(state.subscription)) {
      const currentTime = Date.now();
      const timeSinceLastSave = currentTime - lastSaveTime;
      
      // Clear any existing timer
      if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
      }
      
      // If it's been less than 10 seconds since the last save, debounce
      if (timeSinceLastSave < 10000) {
        const timer = setTimeout(() => {
          saveMostRecentState(state.user.id, state, true)
            .then(() => {
              setLastSaveTime(Date.now());
              console.log('Auto-saved most recent state (debounced)');
            })
            .catch(err => {
              console.error('Error auto-saving most recent state:', err);
            });
        }, 10000 - timeSinceLastSave);
        
        setSaveDebounceTimer(timer);
        return () => clearTimeout(timer);
      } else {
        // If it's been more than 10 seconds, save immediately
        saveMostRecentState(state.user.id, state, true)
          .then(() => {
            setLastSaveTime(Date.now());
            console.log('Auto-saved most recent state (immediate)');
          })
          .catch(err => {
            console.error('Error auto-saving most recent state:', err);
          });
      }
    }
  }, [
    state.guests, 
    state.tables, 
    state.constraints, 
    state.adjacents, 
    state.assignments, 
    state.seatingPlans, 
    state.currentPlanIndex,
    state.user?.id,
    state.subscription
  ]);
  
  useEffect(() => {
    const init = async () => {
      if (!supabaseConfigured) {
        console.log('Supabase is not configured, skipping auth initialization');
        setSessionLoading(false);
        return;
      }

      try {
        setSessionLoading(true);
        setSessionError(null);
        
        // Test Supabase connection
        const isConnected = await testSupabaseConnection();
        dispatch({ type: 'SET_SUPABASE_CONNECTED', payload: isConnected });
        
        if (!isConnected) {
          console.error('Supabase connection test failed');
          setSessionError('Unable to connect to the server. Please check your internet connection and try again.');
          setSessionLoading(false);
          return;
        }
        
        // First, get the current session to verify authentication
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) {
          console.error('Error fetching session:', sessionError);
          setSessionError('Failed to validate your session. Please log in again.');
          setSessionLoading(false);
          return;
        }
        
        const user = sessionData?.session?.user || null;
        
        if (user) {
          console.log('User authenticated:', user.id);
          dispatch({ type: 'SET_USER', payload: user });
          
          try {
            // Only fetch subscription data if we have a valid session and user
            if (sessionData.session) {
              const { data: subData, error: subError } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('user_id', user.id)
                .order('current_period_end', { ascending: false })
                .limit(1);

              if (subError) {
                if (subError.status === 401) {
                  console.error('Session expired when fetching subscription');
                  setSessionError('Your session has expired. Please log in again.');
                  dispatch({ type: 'SET_USER', payload: null });
                  setSessionLoading(false);
                  return;
                }
                console.error('Subscription fetch error:', subError);
              } else if (subData && subData.length > 0) {
                console.log('Subscription found:', subData[0]);
                dispatch({ type: 'SET_SUBSCRIPTION', payload: subData[0] });
                
                // Only after confirming subscription, check for most recent state
                try {
                  // Always check for most recent state for premium users
                  await fetchMostRecentState(user.id);
                } catch (recentError) {
                  console.error('Error fetching most recent state:', recentError);
                  setRecentStateError('Error loading your most recent session. Please try again or load from saved settings.');
                  setShowRecentModal(true); // Still show modal with error state
                  setRecentStateFetched(true);
                }
              } else {
                // Check for trial subscription if no regular subscription found
                const { data: trialData, error: trialError } = await supabase
                  .from('trial_subscriptions')
                  .select('*')
                  .eq('user_id', user.id)
                  .gt('expires_on', new Date().toISOString())
                  .limit(1);
                  
                if (!trialError && trialData && trialData.length > 0) {
                  const trialSubscription = {
                    id: `trial-${trialData[0].id}`,
                    user_id: user.id,
                    status: 'active',
                    current_period_start: trialData[0].start_date,
                    current_period_end: trialData[0].expires_on,
                    cancel_at_period_end: true
                  };
                  dispatch({ type: 'SET_SUBSCRIPTION', payload: trialSubscription });
                  
                  // Also check for most recent state for trial users
                  try {
                    await fetchMostRecentState(user.id);
                  } catch (recentError) {
                    console.error('Error fetching most recent state for trial user:', recentError);
                    setRecentStateError('Error loading your most recent session. Please try again or load from saved settings.');
                    setShowRecentModal(true);
                    setRecentStateFetched(true);
                  }
                } else {
                  console.log('No subscription or trial found. Skipping most recent state check.');
                }
              }
            }
          } catch (err) {
            console.error('Error in subscription or recent state fetch:', err);
            // Still show the modal with error state to ensure user can make a choice
            setRecentStateError('Error loading your most recent state. Please try again or load from saved settings.');
            setShowRecentModal(true);
            setRecentStateFetched(true);
          }
        }
      } catch (error) {
        console.error('Error in auth initialization:', error);
        setSessionError('An unexpected error occurred during authentication. Please refresh the page and try again.');
        // Still show the modal with error state
        setShowRecentModal(true);
        setRecentStateFetched(true);
      } finally {
        setSessionLoading(false);
      }
    };

    init();
  }, []);

  // Additional effect to handle auth state changes
  useEffect(() => {
    // If auth state has changed (user logged in) and we have user & subscription data
    if (authStateChanged && state.user && isPremiumSubscription(state.subscription) && !showRecentModal) {
      console.log('Auth state changed and premium user detected - checking for recent state');
      const checkRecentState = async () => {
        try {
          await fetchMostRecentState(state.user.id);
        } catch (err) {
          console.error('Error checking recent state after auth change:', err);
          setRecentStateError('Failed to load your most recent state after login. Please try again or load from saved settings.');
          setShowRecentModal(true);
        }
      };
      
      checkRecentState();
      // Reset the flag to avoid duplicate checks
      setAuthStateChanged(false);
    }
  }, [authStateChanged, state.user, state.subscription, showRecentModal]);

  // Listen for auth state changes to reset state when user logs out
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        console.log('User signed out, resetting app state');
        // Use the reset action to clear all user-specific data
        dispatch({ type: 'RESET_APP_STATE' });
      } else if (event === 'SIGNED_IN') {
        console.log('User signed in, setting auth state changed flag');
        setAuthStateChanged(true);
      }
    });
    
    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const handleKeepCurrent = async () => {
    setShowRecentModal(false);
    if (state.user) {
      try {
        await clearMostRecentState(state.user.id);
      } catch (err) {
        console.error('Error clearing most recent state:', err);
        // Don't alert the user on error, just log it and continue
        console.warn('Failed to clear most recent state, but continuing with current data.');
      }
    }
  };

  const handleRestoreRecent = () => {
    if (!mostRecentState) {
      setRecentStateError('No recent state data available to restore.');
      return;
    }
    
    try {
      setShowRecentModal(false);
      dispatch({ type: 'LOAD_MOST_RECENT', payload: mostRecentState });
    } catch (err) {
      console.error('Error restoring most recent state:', err);
      setRecentStateError('Failed to restore most recent state. Please try again.');
      setShowRecentModal(true); // Re-show modal with error
    }
  };
  
  // Function to retry fetching most recent state
  const handleRetryFetchRecent = async () => {
    if (!state.user) return;
    
    setRecentStateError(null);
    try {
      await fetchMostRecentState(state.user.id);
    } catch (err) {
      console.error('Error in retry fetch:', err);
      setRecentStateError('Failed to load your most recent state. Please try again later.');
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
          onRetryFetch={handleRetryFetchRecent}
          error={recentStateError}
          loading={!recentStateFetched && sessionLoading}
        />
      )}
    </AppContext.Provider>
  );
};

export const useAppContext = (): AppContextType => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
};
export { useAppContext as useApp };