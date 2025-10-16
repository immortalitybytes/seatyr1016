import React, { createContext, useReducer, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { getSupabase, isSupabaseReady } from '../lib/supabase';
import type { User, AppState, GuestUnit, Table, SeatingPlan, UserSubscription, Constraint } from '../types';
import { clearAllSeatyrData } from '../lib/sessionSettings';
import { getMostRecentState, saveMostRecentState } from '../lib/mostRecentState';
import { v4 as uuidv4 } from 'uuid';

// --- ACTION TYPES ---
type AppAction =
  | { type: 'SET_USER'; payload: User | null }
  | { type: 'SET_SUBSCRIPTION'; payload: UserSubscription | null }
  | { type: 'ADD_GUESTS'; payload: GuestUnit[] }
  | { type: 'REMOVE_GUEST'; payload: string }
  | { type: 'UPDATE_GUEST'; payload: { id: string; updates: Partial<GuestUnit> } }
  | { type: 'ADD_TABLE'; payload: Table }
  | { type: 'REMOVE_TABLE'; payload: number }
  | { type: 'UPDATE_TABLE'; payload: { id: number; updates: Partial<Table> } }
  | { type: 'SET_CONSTRAINT'; payload: { guest1: string; guest2: string; constraint: Constraint } }
  | { type: 'REMOVE_CONSTRAINT'; payload: { guest1: string; guest2: string } }
  | { type: 'SET_ADJACENT'; payload: { guest: string; adjacents: string[] } }
  | { type: 'SET_SEATING_PLANS'; payload: SeatingPlan[] }
  | { type: 'SET_CURRENT_PLAN_INDEX'; payload: number }
  | { type: 'SET_GENERATING'; payload: boolean }
  | { type: 'SET_EVENT_ID'; payload: string | null }
  | { type: 'IMPORT_STATE'; payload: Partial<AppState> }
  | { type: 'RESET_APP_STATE' }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'CLEAR_HISTORY' }
  | { type: 'SET_ERROR'; payload: { message: string; details?: any } };

// --- STATE & INITIAL STATE ---
interface UndoRedoState {
  undoStack: Partial<AppState>[];
  redoStack: Partial<AppState>[];
}

interface ExtendedAppState extends AppState {
  authLoading: boolean;
  authError: string | null;
  undoRedo: UndoRedoState;
}

const initialState: ExtendedAppState = {
  user: null,
  subscription: null,
  guests: [],
  tables: [],
  constraints: {},
  adjacents: {},
  assignments: {},
  seatingPlans: [],
  currentPlanIndex: -1,
  userSetTables: false,
  loadedSavedSetting: false,
  isGenerating: false,
  eventId: null,
  lastSaved: null,
  authLoading: true,
  authError: null,
  undoRedo: { undoStack: [], redoStack: [] },
};

// --- REDUCER ---
const coreReducer = (state: ExtendedAppState, action: AppAction): ExtendedAppState => {
  switch (action.type) {
    case 'SET_USER':
      return { ...state, user: action.payload, authLoading: false, authError: null };
    case 'SET_SUBSCRIPTION':
      return { ...state, subscription: action.payload };
    case 'ADD_GUESTS': {
      const newGuests = [...state.guests];
      for (const guest of action.payload) {
        if (!guest.id || !guest.normalizedKey) {
          return { ...state, authError: `Invalid guest data: missing id or normalizedKey` };
        }
        if (!newGuests.some(g => g.normalizedKey === guest.normalizedKey)) {
          newGuests.push({ ...guest, id: guest.id || uuidv4() });
        }
      }
      return { ...state, guests: newGuests };
    }
    case 'REMOVE_GUEST': {
      if (!state.guests.some(g => g.id === action.payload)) {
        return { ...state, authError: `Guest with ID ${action.payload} not found` };
      }
      const guests = state.guests.filter(guest => guest.id !== action.payload);
      const constraints = { ...state.constraints };
      const adjacents = { ...state.adjacents };
      const removedGuest = state.guests.find(g => g.id === action.payload);
      if (removedGuest) {
        const key = removedGuest.normalizedKey;
        delete constraints[key];
        for (const guestKey in constraints) {
          delete constraints[guestKey][key];
        }
        delete adjacents[key];
        for (const guestKey in adjacents) {
          adjacents[guestKey] = adjacents[guestKey].filter(k => k !== key);
        }
      }
      return { ...state, guests, constraints, adjacents };
    }
    case 'UPDATE_GUEST': {
      if (!state.guests.some(g => g.id === action.payload.id)) {
        return { ...state, authError: `Guest with ID ${action.payload.id} not found` };
      }
      const guests = state.guests.map(guest =>
        guest.id === action.payload.id ? { ...guest, ...action.payload.updates } : guest
      );
      return { ...state, guests };
    }
    case 'ADD_TABLE': {
      if (action.payload.capacity <= 0) {
        return { ...state, authError: 'Table capacity must be positive' };
      }
      const tables = [...state.tables, { ...action.payload, id: action.payload.id || Date.now() }];
      return { ...state, tables, userSetTables: true };
    }
    case 'REMOVE_TABLE': {
      if (!state.tables.some(t => t.id === action.payload)) {
        return { ...state, authError: `Table with ID ${action.payload} not found` };
      }
      const tables = state.tables.filter(table => table.id !== action.payload);
      return { ...state, tables, userSetTables: tables.length > 0 };
    }
    case 'UPDATE_TABLE': {
      if (!state.tables.some(t => t.id === action.payload.id)) {
        return { ...state, authError: `Table with ID ${action.payload.id} not found` };
      }
      if (action.payload.updates.capacity && action.payload.updates.capacity <= 0) {
        return { ...state, authError: 'Table capacity must be positive' };
      }
      const tables = state.tables.map(table =>
        table.id === action.payload.id ? { ...table, ...action.payload.updates } : table
      );
      return { ...state, tables, userSetTables: true };
    }
    case 'SET_CONSTRAINT': {
      const { guest1, guest2, constraint } = action.payload;
      if (!state.guests.some(g => g.normalizedKey === guest1) || !state.guests.some(g => g.normalizedKey === guest2)) {
        return {
          ...state,
          authError: `Invalid constraint: one or both guests (${guest1}, ${guest2}) not found`,
        };
      }
      const constraints = { ...state.constraints };
      if (!constraints[guest1]) constraints[guest1] = {};
      constraints[guest1][guest2] = constraint;
      return { ...state, constraints };
    }
    case 'REMOVE_CONSTRAINT': {
      const { guest1, guest2 } = action.payload;
      if (!state.constraints[guest1]?.[guest2]) {
        return { ...state, authError: `Constraint between ${guest1} and ${guest2} not found` };
      }
      const constraints = { ...state.constraints };
      if (constraints[guest1]) {
        delete constraints[guest1][guest2];
        if (Object.keys(constraints[guest1]).length === 0) {
          delete constraints[guest1];
        }
      }
      return { ...state, constraints };
    }
    case 'SET_ADJACENT': {
      const { guest, adjacents } = action.payload;
      if (!state.guests.some(g => g.normalizedKey === guest)) {
        return {
          ...state,
          authError: `Invalid adjacency: guest ${guest} not found`,
        };
      }
      const adjacentsValidated = adjacents.filter(adj => state.guests.some(g => g.normalizedKey === adj));
      const adjacentsState = { ...state.adjacents, [guest]: adjacentsValidated };
      return { ...state, adjacents: adjacentsState };
    }
    case 'SET_SEATING_PLANS': {
      const validPlans = action.payload.filter(plan => plan.tables.every(t => state.tables.some(st => st.id === t.id)));
      return {
        ...state,
        seatingPlans: validPlans,
        currentPlanIndex: validPlans.length > 0 ? 0 : -1,
      };
    }
    case 'SET_CURRENT_PLAN_INDEX': {
      if (action.payload < 0 || action.payload >= state.seatingPlans.length) {
        return { ...state, authError: 'Invalid seating plan index' };
      }
      return { ...state, currentPlanIndex: action.payload };
    }
    case 'SET_GENERATING':
      return { ...state, isGenerating: action.payload };
    case 'SET_EVENT_ID':
      return { ...state, eventId: action.payload };
    case 'IMPORT_STATE': {
      const validState: Partial<AppState> = {
        guests: action.payload.guests?.filter(g => g.id && g.normalizedKey) || state.guests,
        tables: action.payload.tables?.filter(t => t.id && t.capacity > 0) || state.tables,
        constraints: action.payload.constraints || state.constraints,
        adjacents: action.payload.adjacents || state.adjacents,
        assignments: action.payload.assignments || state.assignments,
        seatingPlans: action.payload.seatingPlans?.filter(p => p.tables.every(t => state.tables.some(st => st.id === t.id))) || state.seatingPlans,
        currentPlanIndex: action.payload.currentPlanIndex || state.currentPlanIndex,
        userSetTables: action.payload.userSetTables ?? state.userSetTables,
        loadedSavedSetting: true,
        eventId: action.payload.eventId || state.eventId,
        lastSaved: action.payload.lastSaved || state.lastSaved,
      };
      return { ...state, ...validState, authError: null };
    }
    case 'RESET_APP_STATE':
      if (typeof window !== 'undefined') {
        clearAllSeatyrData();
      }
      return { ...initialState, user: state.user, subscription: state.subscription, authLoading: false };
    case 'SET_ERROR':
      return { ...state, authError: action.payload.message, authLoading: false };
    default:
      return state;
  }
};

// --- UNDO/REDO MIDDLEWARE ---
const undoableActionTypes: AppAction['type'][] = [
  'ADD_GUESTS',
  'REMOVE_GUEST',
  'UPDATE_GUEST',
  'ADD_TABLE',
  'REMOVE_TABLE',
  'UPDATE_TABLE',
  'SET_CONSTRAINT',
  'REMOVE_CONSTRAINT',
  'SET_ADJACENT',
  'SET_SEATING_PLANS',
  'SET_CURRENT_PLAN_INDEX',
  'IMPORT_STATE',
];

const stateReducerWithUndo = (state: ExtendedAppState, action: AppAction): ExtendedAppState => {
  const isUndoable = undoableActionTypes.includes(action.type);
  const stateBeforeAction: Partial<AppState> = {
    guests: state.guests,
    tables: state.tables,
    constraints: state.constraints,
    adjacents: state.adjacents,
    assignments: state.assignments,
    seatingPlans: state.seatingPlans,
    currentPlanIndex: state.currentPlanIndex,
    userSetTables: state.userSetTables,
    eventId: state.eventId,
    lastSaved: state.lastSaved,
  };

  const newState = coreReducer(state, action);

  if (isUndoable && JSON.stringify(stateBeforeAction) !== JSON.stringify({
    guests: newState.guests,
    tables: newState.tables,
    constraints: newState.constraints,
    adjacents: newState.adjacents,
    assignments: newState.assignments,
    seatingPlans: newState.seatingPlans,
    currentPlanIndex: newState.currentPlanIndex,
    userSetTables: newState.userSetTables,
    eventId: newState.eventId,
    lastSaved: newState.lastSaved,
  })) {
    const newUndoStack = [...newState.undoRedo.undoStack, stateBeforeAction].slice(-20);
    return {
      ...newState,
      undoRedo: {
        undoStack: newUndoStack,
        redoStack: [],
      },
    };
  } else if (action.type === 'UNDO' && state.undoRedo.undoStack.length > 0) {
    const previousState = state.undoRedo.undoStack.at(-1)!;
    const newUndoStack = state.undoRedo.undoStack.slice(0, -1);
    return {
      ...newState,
      ...previousState,
      undoRedo: {
        undoStack: newUndoStack,
        redoStack: [...newState.undoRedo.redoStack, stateBeforeAction],
      },
    };
  } else if (action.type === 'REDO' && state.undoRedo.redoStack.length > 0) {
    const nextState = state.undoRedo.redoStack.at(-1)!;
    const newRedoStack = state.undoRedo.redoStack.slice(0, -1);
    return {
      ...newState,
      ...nextState,
      undoRedo: {
        undoStack: [...newState.undoRedo.undoStack, stateBeforeAction],
        redoStack: newRedoStack,
      },
    };
  } else if (action.type === 'CLEAR_HISTORY') {
    return {
      ...newState,
      undoRedo: { undoStack: [], redoStack: [] },
    };
  }
  return newState;
};

// --- CONTEXT & PROVIDER ---
interface AppContextType {
  state: ExtendedAppState;
  dispatch: React.Dispatch<AppAction>;
  isPremium: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

// --- DEBOUNCE UTILITY ---
const debounce = <T extends (...args: any[]) => void>(func: T, wait: number) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
};

const debouncedSave = debounce((userId: string, data: Partial<AppState>, isPremium: boolean) => {
  if (typeof window !== 'undefined') {
    saveMostRecentState(userId, data, isPremium);
  }
}, 1000);

// --- PROVIDER ---
export const AppProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(stateReducerWithUndo, initialState);
  const [loaded, setLoaded] = useState(false);
  const isPremium = state.subscription?.status === 'active' || state.subscription?.status === 'trialing';

  // Supabase auth + state hydration
  useEffect(() => {
    const supabase = getSupabase();
    if (!isSupabaseReady()) {
      dispatch({ type: 'SET_USER', payload: null });
      dispatch({ type: 'SET_ERROR', payload: { message: 'Supabase client not initialized' } });
      setLoaded(true);
      return;
    }

    const { data: { subscription: authListener } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const user = session?.user ?? null;
        dispatch({ type: 'SET_USER', payload: user });

        if (user) {
          try {
            const { data: subData, error: subError } = await supabase
              .from('subscriptions')
              .select('*')
              .eq('user_id', user.id)
              .single();
            if (subError) throw subError;
            dispatch({ type: 'SET_SUBSCRIPTION', payload: subData });

            if (subData?.status === 'active' || subData?.status === 'trialing') {
              try {
                const savedState = await getMostRecentState(user.id);
                if (savedState) {
                  dispatch({ type: 'IMPORT_STATE', payload: savedState });
                }
              } catch (error) {
                dispatch({
                  type: 'SET_ERROR',
                  payload: {
                    message: 'Failed to load saved state',
                    details: error instanceof Error ? error.message : 'Unknown error',
                  },
                });
              }
            }
          } catch (error) {
            dispatch({
              type: 'SET_ERROR',
              payload: {
                message: 'Failed to fetch subscription',
                details: error instanceof Error ? error.message : 'Unknown error',
              },
            });
            dispatch({ type: 'SET_SUBSCRIPTION', payload: null });
          }
        }
        setLoaded(true);
      }
    );

    return () => authListener.unsubscribe();
  }, []);

  // Auto-save for premium users
  useEffect(() => {
    if (!loaded || !state.user || !isPremium) return;
    const payload = {
      guests: state.guests,
      tables: state.tables,
      constraints: state.constraints,
      adjacents: state.adjacents,
      assignments: state.assignments,
      seatingPlans: state.seatingPlans,
      currentPlanIndex: state.currentPlanIndex,
      userSetTables: state.userSetTables,
      eventId: state.eventId,
      lastSaved: new Date().toISOString(),
    };
    debouncedSave(state.user.id, payload, isPremium);
  }, [
    state.guests,
    state.tables,
    state.constraints,
    state.adjacents,
    state.assignments,
    state.seatingPlans,
    state.currentPlanIndex,
    state.userSetTables,
    state.eventId,
    state.user,
    state.subscription,
    loaded,
    isPremium,
  ]);

  return (
    <AppContext.Provider
      value={{
        state,
        dispatch,
        isPremium,
        canUndo: state.undoRedo.undoStack.length > 0,
        canRedo: state.undoRedo.redoStack.length > 0,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

// --- CUSTOM HOOKS ---
export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useAppContext must be used within an AppProvider');
  return context;
};

export const useGuests = () => {
  const { state, dispatch } = useAppContext();

  const addGuests = useCallback(
    (guests: GuestUnit[]) => {
      dispatch({ type: 'ADD_GUESTS', payload: guests });
    },
    [dispatch]
  );

  const removeGuest = useCallback(
    (id: string) => {
      dispatch({ type: 'REMOVE_GUEST', payload: id });
    },
    [dispatch]
  );

  const updateGuest = useCallback(
    (id: string, updates: Partial<GuestUnit>) => {
      dispatch({ type: 'UPDATE_GUEST', payload: { id, updates } });
    },
    [dispatch]
  );

  return {
    guests: state.guests,
    addGuests,
    removeGuest,
    updateGuest,
  };
};

export const useTables = () => {
  const { state, dispatch } = useAppContext();

  const addTable = useCallback(
    (table: Table) => {
      dispatch({ type: 'ADD_TABLE', payload: table });
    },
    [dispatch]
  );

  const removeTable = useCallback(
    (id: number) => {
      dispatch({ type: 'REMOVE_TABLE', payload: id });
    },
    [dispatch]
  );

  const updateTable = useCallback(
    (id: number, updates: Partial<Table>) => {
      dispatch({ type: 'UPDATE_TABLE', payload: { id, updates } });
    },
    [dispatch]
  );

  return {
    tables: state.tables,
    addTable,
    removeTable,
    updateTable,
  };
};

export const useConstraints = () => {
  const { state, dispatch } = useAppContext();

  const setConstraint = useCallback(
    (guest1: string, guest2: string, constraint: Constraint) => {
      dispatch({ type: 'SET_CONSTRAINT', payload: { guest1, guest2, constraint } });
    },
    [dispatch]
  );

  const removeConstraint = useCallback(
    (guest1: string, guest2: string) => {
      dispatch({ type: 'REMOVE_CONSTRAINT', payload: { guest1, guest2 } });
    },
    [dispatch]
  );

  const setAdjacent = useCallback(
    (guest: string, adjacents: string[]) => {
      dispatch({ type: 'SET_ADJACENT', payload: { guest, adjacents } });
    },
    [dispatch]
  );

  return {
    constraints: state.constraints,
    adjacents: state.adjacents,
    setConstraint,
    removeConstraint,
    setAdjacent,
  };
};

export const useSeatingPlans = () => {
  const { state, dispatch } = useAppContext();

  const setSeatingPlans = useCallback(
    (plans: SeatingPlan[]) => {
      dispatch({ type: 'SET_SEATING_PLANS', payload: plans });
    },
    [dispatch]
  );

  const selectPlan = useCallback(
    (index: number) => {
      dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: index });
    },
    [dispatch]
  );

  const setGenerating = useCallback(
    (isGenerating: boolean) => {
      dispatch({ type: 'SET_GENERATING', payload: isGenerating });
    },
    [dispatch]
  );

  return {
    seatingPlans: state.seatingPlans,
    currentPlanIndex: state.currentPlanIndex,
    currentPlan: state.currentPlanIndex >= 0 ? state.seatingPlans[state.currentPlanIndex] : null,
    isGenerating: state.isGenerating,
    setSeatingPlans,
    selectPlan,
    setGenerating,
  };
};

export const useUndoRedo = () => {
  const { dispatch, canUndo, canRedo } = useAppContext();

  const undo = useCallback(() => {
    if (canUndo) {
      dispatch({ type: 'UNDO' });
    }
  }, [dispatch, canUndo]);

  const redo = useCallback(() => {
    if (canRedo) {
      dispatch({ type: 'REDO' });
    }
  }, [dispatch, canRedo]);

  const clearHistory = useCallback(() => {
    dispatch({ type: 'CLEAR_HISTORY' });
  }, [dispatch]);

  return {
    undo,
    redo,
    clearHistory,
    canUndo,
    canRedo,
  };
};

export const useAuth = () => {
  const { state, dispatch } = useAppContext();

  const resetAppState = useCallback(() => {
    dispatch({ type: 'RESET_APP_STATE' });
  }, [dispatch]);

  return {
    user: state.user,
    subscription: state.subscription,
    isPremium: state.subscription?.status === 'active' || state.subscription?.status === 'trialing',
    authLoading: state.authLoading,
    authError: state.authError,
    resetAppState,
  };
};