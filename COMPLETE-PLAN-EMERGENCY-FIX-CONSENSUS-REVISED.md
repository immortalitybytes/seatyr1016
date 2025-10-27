# Emergency Fix + Final Consensus Implementation (REVISED with Rival AI Fixes)

**Status:** ✅ READY FOR EXECUTION  
**Last Updated:** 2025-10-26 4:32 PM EDT  
**Confidence:** 92%  
**Estimated Time:** 2.5-3 hours (2.5h if Test 8 passes, 3h if Phase 3 needed)  
**Risk:** MEDIUM  
**Target Base:** v1024at5pm (post-1025at4pm state)

## Unanimous Rival AI Consensus + Final Guardrails (ChatGPT, Grok, Gemini @ 4:32pm)

### ✅ Modal Approach: React `lazy()` + `Suspense`  
### ✅ Code Completeness: ALL complete code blocks  
### ✅ **NEW:** Add `sanitizeAndMigrateAppState` implementation  
### ✅ **NEW:** Expanded preflight verification (all critical functions)  
### ✅ **CONDITIONAL:** AbortController only if `generateSeatingPlans` accepts `AbortSignal`  
### ✅ Policy Guardrails: Pure reducers, inline warnings, dual guards, string ID normalization

---

## PHASE 0: EMERGENCY FIX (5 minutes)

**Problem:** `ReferenceError: resetDisabled is not defined` at line 750

**File:** `src/context/AppContext.tsx`

**Action:** Delete phantom timer code:

```typescript
// DELETE THIS BLOCK (around line 748-752):
setTimeout(() => {
  resetDisabled = false;
  console.log('[Auth] Reset enabled after initialization');
}, 2000);

// Also delete any clearTimeout(enableAuthListener) in cleanup
```

**Verification:** `npm run build && npm run dev` - no ReferenceError

---

## PHASE 1: Setup & Verification (15 minutes)

### 1.1 Verify Critical Dependencies

**CRITICAL:** Run this verification before proceeding:

```typescript
// Create verify-deps.ts in project root
const checks = [
  { path: './src/utils/seatingAlgorithm.engine.ts', fn: 'validateAndGroup' },
  { path: './src/utils/seatingAlgorithm.ts', fn: 'generateSeatingPlans' },
  { path: './src/utils/assignments.ts', fn: 'parseAssignmentIds' },
  { path: './src/utils/assignments.ts', fn: 'normalizeAssignmentInputToIdsWithWarnings' },
  { path: './src/utils/tables.ts', fn: 'getCapacity' },
  { path: './src/utils/premium.ts', fn: 'isPremiumSubscription' },
  { path: './src/lib/mostRecentState.ts', fn: 'getMostRecentState' },
  { path: './src/lib/entitlements.ts', fn: 'loadEntitlementsOnce' }
];

for (const { path, fn } of checks) {
  try {
    const module = require(path);
    if (!(fn in module)) {
      throw new Error(`Function ${fn} not found in ${path}`);
    }
    console.log(`✓ ${path}::${fn}`);
  } catch (err) {
    console.error(`✗ ${path}::${fn} - ${(err as Error).message}`);
    process.exit(1);
  }
}

console.log('\n✅ All dependencies verified');
```

Run: `npx tsx verify-deps.ts`  
Delete: `rm verify-deps.ts` after success

### 1.2 Create `sanitizeAndMigrateAppState` Implementation

**File:** `src/utils/persistence.ts` (create if doesn't exist)

```typescript
import type { AppState } from '../types';

export function sanitizeAndMigrateAppState(incoming: any): Partial<AppState> {
  if (!incoming || typeof incoming !== 'object') {
    console.error('[sanitizeAndMigrateAppState] Invalid input:', incoming);
    return {};
  }

  const sanitized: Partial<AppState> = {
    guests: Array.isArray(incoming.guests)
      ? incoming.guests
          .filter((g: any) => g?.id && typeof g.name === 'string')
          .map((g: any) => ({
            id: String(g.id),
            name: String(g.name),
            count: Math.max(1, Number(g.count) || 1)
          }))
      : [],
    
    tables: Array.isArray(incoming.tables)
      ? incoming.tables
          .filter((t: any) => t?.id && Number.isInteger(t.seats))
          .map((t: any) => ({
            id: String(t.id),
            seats: Number(t.seats),
            name: typeof t.name === 'string' ? t.name : undefined
          }))
      : [],
    
    assignments: typeof incoming.assignments === 'object' && incoming.assignments !== null
      ? Object.fromEntries(
          Object.entries(incoming.assignments).map(([guestId, raw]) => [
            String(guestId),
            String(raw || '').split(/[,\s]+/).filter(Boolean).join(',')
          ])
        )
      : {},
    
    constraints: typeof incoming.constraints === 'object' && incoming.constraints !== null
      ? Object.fromEntries(
          Object.entries(incoming.constraints).map(([g1, constraints]) => [
            String(g1),
            Object.fromEntries(
              Object.entries(constraints as any).map(([g2, value]) => [
                String(g2),
                ['must', 'cannot', ''].includes(value) ? value : ''
              ])
            )
          ])
        )
      : {},
    
    adjacents: typeof incoming.adjacents === 'object' && incoming.adjacents !== null
      ? Object.fromEntries(
          Object.entries(incoming.adjacents).map(([g1, adj]) => [
            String(g1),
            Array.isArray(adj) ? adj.map(String) : []
          ])
        )
      : {},
    
    warnings: [],
    regenerationNeeded: true,
    isReady: true,
    loadedRestoreDecision: true
  };

  return sanitized;
}
```

### 1.3 Install Dependencies

```bash
npm install react-toastify
npm install --save-dev tsx
```

### 1.4 Add Test Script to package.json

```json
"scripts": {
  "test:phase1b": "tsx test-phase1b.ts"
}
```

### 1.5 Add ToastContainer to src/App.tsx

```typescript
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

// In render return:
<>
  {/* existing content */}
  <ToastContainer position="top-right" autoClose={7000} />
</>
```

---

## PHASE 2: Test 8 - Phase 1B Viability (15 minutes)

### 2.1 Create Complete Test Script

Create `test-phase1b.ts` in project root:

```typescript
// test-phase1b.ts
// IMPORTANT: Use wrapper API (matches production)
import { generateSeatingPlans } from './src/utils/seatingAlgorithm';
import type { Guest, Table } from './src/types';

console.log("--- Test 8: MUST Chain with Partial Assignments ---");

const testGuests: Guest[] = [
  { id: 'abby', name: 'Abby+1', count: 2 },
  { id: 'betty', name: 'Betty', count: 1 },
  { id: 'bob', name: 'Bob', count: 1 },
  { id: 'carl', name: 'Carl+2', count: 3 },
  { id: 'dave', name: 'Dave', count: 1 },
  { id: 'evie', name: 'Evie', count: 1 },
  { id: 'evan', name: 'Evan', count: 1 }
];

const testTables: Table[] = [
  { id: '1', seats: 8 },
  { id: '2', seats: 8 },
  { id: '5', seats: 11 }, // Target table
  { id: '6', seats: 8 },
  { id: '7', seats: 8 }
];

const testAssignments: Record<string, string> = {
  'betty': '1,5,7',
  'bob': '1,5,7',
  'dave': '2,5,6'
};

const testConstraints: Record<string, Record<string, string>> = {
  'abby': { 'betty': 'must' },
  'betty': { 'abby': 'must', 'carl': 'must', 'bob': 'must' },
  'bob': { 'betty': 'must' },
  'carl': { 'betty': 'must', 'dave': 'must' },
  'dave': { 'carl': 'must', 'evie': 'must' },
  'evie': { 'dave': 'must', 'evan': 'must' },
  'evan': { 'evie': 'must' }
};

async function runTest() {
  try {
    // Use wrapper API with object args (matches production)
    const { plans, errors } = await generateSeatingPlans({
      guests: testGuests,
      tables: testTables,
      constraints: testConstraints,
      adjacents: {},
      assignments: testAssignments,
      isPremium: true
    });

    console.log(`[Test 8] Plans: ${plans.length}`);
    if (errors.length > 0) console.warn('[Test 8] Errors:', errors.map(e => e.message || e.kind));

    const chainIds = ['abby', 'betty', 'bob', 'carl', 'dave', 'evie', 'evan'];
    
    // Check if wrapper returns assignments object or plan.tables structure
    const passes = plans.some(plan => {
      if (plan.assignments) {
        // If wrapper returns { assignments: Record<guestId, tableId> }
        return chainIds.every(gid => String(plan.assignments[gid]) === '5');
      } else if (plan.tables) {
        // If wrapper returns { tables: [...] } structure
        const table5 = plan.tables.find(t => String(t.tableId) === '5');
        if (!table5?.seats) return false;

        const guestNameMap = new Map(testGuests.map(g => [g.name, g.id]));
        const seatedIds = new Set<string>();
        
        table5.seats.forEach(seat => {
          const id = guestNameMap.get(seat.name);
          if (id) seatedIds.add(id);
        });

        return chainIds.every(id => seatedIds.has(id));
      }
      return false;
    });

    console.log('[Test 8] Result:', passes ? 'PASS ✓' : 'FAIL ✗');
    return passes;
  } catch (error) {
    console.error('[Test 8] Error:', error);
    return false;
  }
}

runTest().then(passes => {
  console.log(passes ? '\nSkipping Phase 3 (Algorithm OK)' : '\nRunning Phase 3 (Needs Fix)');
  process.exit(passes ? 0 : 1);
});
```

### 2.2 Run Test

```bash
npm run test:phase1b
```

Record result: PASS or FAIL

### 2.3 Cleanup

```bash
rm test-phase1b.ts
```

---

## PHASE 3: Algorithm Fix (CONDITIONAL - 40 minutes)

**Execute ONLY if Test 8 FAILS**

**File:** `src/utils/seatingAlgorithm.engine.ts`

**Locate:** Inside `validateAndGroup` function, find the loop `for (const gi of byRoot.values())`

**Replace the entire assignment intersection logic block with:**

```typescript
// Create ID to table map
const idToTable = new Map<string, TableIn>();
for (const t of tables) {
  idToTable.set(String(t.id), t);
}

for (const gi of byRoot.values()) {
  let groupAllowed: Set<string> | null = null;
  const assigned: string[] = [];
  const unassigned: string[] = [];

  // Step 1: Intersection ONLY for assigned members
  for (const memberId of gi.members) {
    const raw = assignments[memberId];
    const isRestricted = raw && ((typeof raw === 'string' && raw.trim() !== '') || (Array.isArray(raw) && raw.length > 0));

    if (!isRestricted) {
      unassigned.push(memberId);
      continue;
    }

    assigned.push(memberId);
    const parsedIds = (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/).filter(Boolean))
      .map(token => String(token).trim())
      .filter(id => idToTable.has(id))
      .map(id => id);

    const memberAllowed = new Set<string>(parsedIds);

    if (memberAllowed.size === 0) {
      errors.push({
        kind: 'assignment_conflict',
        message: `Member ${memberId} assigned to invalid tables "${raw}".`,
        details: { group: gi.members, member: memberId }
      });
      groupAllowed = new Set();
      break;
    }

    if (groupAllowed === null) {
      groupAllowed = memberAllowed;
    } else {
      groupAllowed = new Set([...groupAllowed].filter(id => memberAllowed.has(id)));
    }

    if (groupAllowed.size === 0) {
      errors.push({
        kind: 'assignment_conflict',
        message: `No common table for group [${gi.members.join(', ')}] including ${memberId}.`,
        details: { group: gi.members, member: memberId }
      });
      break;
    }
  }

  // Step 2: Determine final allowed set
  const finalAllowed = assigned.length > 0 && groupAllowed
    ? groupAllowed
    : new Set(tables.map(t => String(t.id)));

  // Step 3: Pre-filter by capacity
  const viableTables = new Set<string>();
  let maxCapacity = 0;

  for (const tableId of finalAllowed) {
    const table = idToTable.get(tableId);
    if (table) {
      const capacity = getCapacity(table);
      maxCapacity = Math.max(maxCapacity, capacity);
      if (capacity >= gi.size) {
        viableTables.add(tableId);
      }
    }
  }

  // Step 4: Handle capacity failure
  if (viableTables.size === 0) {
    const groupNames = gi.members.map(id => {
      const guest = ctx?.idToGuest?.get(id);
      return guest?.name || id;
    }).join(', ');

    errors.push({
      kind: 'group_too_big_for_any_table',
      message: `Group [${groupNames}] needs ${gi.size} seats, but no allowed table has sufficient capacity (max: ${maxCapacity}).`,
      details: { group: gi.members, required: gi.size, maxAllowed: maxCapacity }
    });
    gi.allowedTables = new Set();
    gi.preassignedTable = undefined;
    continue;
  }

  // Step 5: Finalize
  gi.allowedTables = viableTables;
  if (viableTables.size === 1) {
    gi.preassignedTable = Array.from(viableTables)[0];
  } else {
    gi.preassignedTable = undefined;
  }
}
```

---

## PHASE 4: State Management & Auto-Regeneration (75 minutes)

**File:** `src/context/AppContext.tsx`

**Complete code blocks for all critical components:**

### 4.1 Add Inline Debounce Utility

Add this function at the top of AppContext.tsx (before AppProvider component):

```typescript
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
    
    if (timeoutId !== null) clearTimeout(timeoutId);
    if (options.leading && timeoutId === null) invoke();
    
    timeoutId = setTimeout(() => {
      if (options.trailing) invoke();
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
```

### 4.2 Update AppState Type

**File:** `src/types/index.ts`

Add these fields to `AppState` interface:

```typescript
export interface AppState {
  // ... existing fields ...
  regenerationNeeded: boolean;
  isReady: boolean;
  loadedRestoreDecision: boolean;
  warnings: string[]; // For engine/capacity errors
}
```

### 4.3 Update initialState

```typescript
const initialState: AppState = {
  // ... existing fields ...
  regenerationNeeded: true,
  isReady: false,
  loadedRestoreDecision: false,
  warnings: [],
};
```

### 4.4 Add State Variables in AppProvider

```typescript
export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // ... existing code ...
  const [state, dispatch] = useReducer(reducer, initialState);
  const stateRef = useRef(state);
  const genRef = useRef(0);
  const [showMostRecentModal, setShowMostRecentModal] = useState(false);
  const [mostRecentData, setMostRecentData] = useState<AppState | null>(null);
  const handlingRef = useRef(false); // For idempotent modal handlers

  // Sync stateRef
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  
  // ... rest of implementation below
};
```

### 4.5 Add Missing Reducer Actions

Add these cases to the reducer function:

```typescript
case 'SET_READY': {
  return { ...state, isReady: true };
}

case 'SET_LOADED_RESTORE_DECISION': {
  return { ...state, loadedRestoreDecision: action.payload ?? true };
}
```

### 4.6 Set-Based Strictness Helper Function

Add this helper OUTSIDE the component (before AppProvider):

```typescript
function classifyAssignmentChange(oldCsv?: string, newCsv?: string): {
  isStricter: boolean;
  isLooser: boolean;
  changed: boolean;
} {
  const oldSet = new Set(String(oldCsv ?? '').split(/[,\s]+/).filter(Boolean).map(String));
  const newSet = new Set(String(newCsv ?? '').split(/[,\s]+/).filter(Boolean).map(String));
  
  const equal = oldSet.size === newSet.size && [...oldSet].every(x => newSet.has(x));
  if (equal) return { isStricter: false, isLooser: false, changed: false };

  const newSubsetOld = [...newSet].every(x => oldSet.has(x));
  const oldSubsetNew = [...oldSet].every(x => newSet.has(x));

  // Conservative: different but neither subset/superset → treat as stricter
  const isStricter = 
    (newSet.size > 0 && oldSet.size === 0) ||
    (newSubsetOld && newSet.size < oldSet.size) ||
    (!newSubsetOld && !oldSubsetNew);

  const isLooser = oldSubsetNew && newSet.size > oldSet.size;

  return { isStricter, isLooser, changed: true };
}
```

### 4.7 Critical Reducers - Complete Code

```typescript
case 'CYCLE_CONSTRAINT': {
  const { guest1, guest2, nextState } = action.payload;
  
  if (!state.guests.some(g => g.id === guest1) || !state.guests.some(g => g.id === guest2)) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[CYCLE_CONSTRAINT] Invalid guests:', guest1, guest2);
    }
    return state;
  }
  
  const currentState = state.constraints?.[guest1]?.[guest2] || '';
  const isStricter = (nextState !== '' && currentState === '') || 
                     (nextState !== '' && currentState !== '' && nextState !== currentState);
  
  const newConstraints = {
    ...state.constraints,
    [guest1]: { ...state.constraints[guest1], [guest2]: nextState }
  };
  
  return {
    ...state,
    constraints: newConstraints,
    regenerationNeeded: isStricter ? true : state.regenerationNeeded,
    seatingPlans: isStricter ? [] : state.seatingPlans,
    currentPlanIndex: isStricter ? 0 : state.currentPlanIndex
  };
}

case 'UPDATE_ASSIGNMENT': {
  const { guestId, raw } = action.payload;
  
  if (!state.guests.some(g => g.id === guestId)) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[UPDATE_ASSIGNMENT] Invalid guest:', guestId);
    }
    return state;
  }
  
  const oldCsv = state.assignments[guestId] || '';
  const { isStricter, isLooser } = classifyAssignmentChange(oldCsv, raw);
  
  return {
    ...state,
    assignments: { ...state.assignments, [guestId]: raw },
    regenerationNeeded: isStricter ? true : (isLooser ? false : state.regenerationNeeded),
    seatingPlans: isStricter ? [] : state.seatingPlans,
    currentPlanIndex: isStricter ? 0 : state.currentPlanIndex
  };
}

case 'UPDATE_TABLE': {
  const { id, seats, name } = action.payload;
  const currentTable = state.tables.find(t => String(t.id) === String(id));
  
  if (!currentTable) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[UPDATE_TABLE] Table not found:', id);
    }
    return state;
  }
  
  const updatedTables = state.tables.map(t =>
    String(t.id) === String(id) 
      ? { ...t, ...(seats !== undefined && { seats }), ...(name !== undefined && { name }) } 
      : t
  );
  
  const isCapacityReduced = seats !== undefined && 
    getCapacity({ ...currentTable, seats }) < getCapacity(currentTable);
  
  return {
    ...state,
    tables: updatedTables,
    userSetTables: true,
    regenerationNeeded: isCapacityReduced ? true : state.regenerationNeeded,
    seatingPlans: isCapacityReduced ? [] : state.seatingPlans,
    currentPlanIndex: isCapacityReduced ? 0 : state.currentPlanIndex
  };
}

case 'REMOVE_TABLE': {
  const tableId = action.payload;
  const updatedTables = state.tables.filter(t => String(t.id) !== String(tableId));
  
  // Normalize IDs to strings for comparison
  const updatedAssignments = { ...state.assignments };
  Object.keys(updatedAssignments).forEach(guestId => {
    const ids = String(updatedAssignments[guestId]).split(/[,\s]+/).filter(Boolean);
    const filtered = ids.filter(id => String(id) !== String(tableId));
    updatedAssignments[guestId] = filtered.join(',');
  });
  
  return {
    ...state,
    tables: updatedTables,
    assignments: updatedAssignments,
    regenerationNeeded: true,
    seatingPlans: [],
    currentPlanIndex: 0
  };
}

case 'ADD_TABLE': {
  const newTable = action.payload;
  return {
    ...state,
    tables: [...state.tables, newTable],
    userSetTables: true,
    // Looser change - preserve plans
  };
}

case 'ADD_GUEST': {
  const { guest } = action.payload;
  
  if (!guest?.id || typeof guest.name !== 'string') {
    if (process.env.NODE_ENV === 'development') {
      console.error('[ADD_GUEST] Invalid guest:', guest);
    }
    return state;
  }
  
  return {
    ...state,
    guests: [...state.guests, { ...guest, count: Math.max(1, guest.count || 1) }],
    regenerationNeeded: true,
    seatingPlans: [],
    currentPlanIndex: 0
  };
}

case 'REMOVE_GUEST': {
  const guestId = action.payload;
  return {
    ...state,
    guests: state.guests.filter(g => g.id !== guestId),
    regenerationNeeded: true,
    seatingPlans: [],
    currentPlanIndex: 0
  };
}

case 'SET_SEATING_PLANS': {
  const { plans = [], errors = [] } = action.payload || {};
  const warnings = errors.map((e: any) => e?.message || String(e)).filter(Boolean);
  
  return {
    ...state,
    seatingPlans: plans,
    warnings, // Store for UI display
    regenerationNeeded: false,
    currentPlanIndex: plans.length > 0 ? Math.min(state.currentPlanIndex, plans.length - 1) : 0
  };
}

case 'TRIGGER_REGENERATION': {
  return {
    ...state,
    regenerationNeeded: true,
    seatingPlans: [],
    currentPlanIndex: 0
  };
}

case 'LOAD_MOST_RECENT': {
  const incoming = action.payload;
  
  if (!incoming?.guests?.length || !incoming.tables?.length) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[LOAD_MOST_RECENT] Invalid cloud data');
    }
    return { ...state, loadedRestoreDecision: true, isReady: true };
  }
  
  const sanitized = sanitizeAndMigrateAppState(incoming);
  const mergedTables = state.tables; // Or use reconcileTables if exists
  
  return {
    ...state,
    ...sanitized,
    tables: mergedTables,
    loadedRestoreDecision: true,
    isReady: true,
    regenerationNeeded: true,
    seatingPlans: [],
    currentPlanIndex: 0
  };
}

case 'LOAD_SAVED_SETTING': {
  const incoming = action.payload;
  
  if (!incoming?.guests?.length || !incoming.tables?.length) {
    if (process.env.NODE_ENV === 'development') {
      console.error('[LOAD_SAVED_SETTING] Invalid saved setting');
    }
    return state;
  }
  
  const sanitized = sanitizeAndMigrateAppState(incoming);
  
  return {
    ...state,
    ...sanitized,
    regenerationNeeded: true,
    seatingPlans: [],
    currentPlanIndex: 0
  };
}

case 'RESET_APP_STATE': {
  // CRITICAL: Block during initialization
  if (!state.isReady || !state.loadedRestoreDecision) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[RESET_APP_STATE] Blocked during initialization');
    }
    return state;
  }
  
  try {
    localStorage.removeItem('seatyr_app_state');
  } catch {}
  
  return {
    ...initialState,
    user: null,
    subscription: null,
    trial: null,
    isReady: true,
    loadedRestoreDecision: true
  };
}
```

### 4.8 Generator Logic (PURE - NO TOASTS IN REDUCERS)

```typescript
const runGenerator = useCallback(() => {
  const s = stateRef.current;
  const currentGen = ++genRef.current;
  
  // Guards
  if (!s.isReady || !s.loadedRestoreDecision || !s.regenerationNeeded) return;
  if (s.guests.length === 0 || s.tables.length === 0) return;
  
  if (process.env.NODE_ENV === 'development') {
    console.log('[Generator] Running with', s.guests.length, 'guests');
  }
  
  generateSeatingPlans({
    guests: s.guests,
    tables: s.tables,
    constraints: s.constraints,
    adjacents: s.adjacents,
    assignments: s.assignments,
    isPremium: isPremiumSubscription(s.subscription, s.trial)
  }).then(({ plans, errors }) => {
    if (currentGen !== genRef.current) return; // Stale
    
    // Dispatch to reducer
    dispatch({ type: 'SET_SEATING_PLANS', payload: { plans, errors } });
    
    // CRITICAL: Toast AFTER dispatch, not in reducer (only for unexpected failures)
    if (errors?.length) {
      import('react-toastify').then(({ toast }) => {
        toast.warning(errors.map(e => e.message ?? String(e)).join('; '), { autoClose: 7000 });
      });
    }
  }).catch(err => {
    console.error('[Generator] Failed:', err);
    import('react-toastify').then(({ toast }) => {
      toast.error('Failed to generate seating plans', { autoClose: 7000 });
    });
  });
}, [dispatch]);

const debouncedGeneratePlans = useMemo(() => {
  return debounce(runGenerator, 180, { leading: false, trailing: true });
}, [runGenerator]);

useEffect(() => {
  return () => debouncedGeneratePlans.cancel();
}, [debouncedGeneratePlans]);

useEffect(() => {
  if (state.isReady && state.loadedRestoreDecision && state.regenerationNeeded && 
      state.guests.length > 0 && state.tables.length > 0) {
    debouncedGeneratePlans();
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
  debouncedGeneratePlans
]);
```

### 4.9 Auth Listener (Complete)

**NOTE:** Only add `AbortController` if `generateSeatingPlans` accepts `AbortSignal`. Otherwise, keep existing `genRef` + debounce pattern.

```typescript
useEffect(() => {
  let isMounted = true;
  
  const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
    if (!isMounted) return;
    
    if (process.env.NODE_ENV === 'development') {
      console.log('[Auth] Event:', event, session ? 'user:' + session.user.id : 'no session');
    }
    
    if (event === 'SIGNED_OUT') {
      try { localStorage.clear(); } catch {}
      dispatch({ type: 'RESET_APP_STATE' });
      setSessionTag('ANON');
      dispatch({ type: 'SET_READY' });
      return;
    }
    
    if (event === 'INITIAL_SESSION' && !session) {
      setSessionTag('ANON');
      dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
      dispatch({ type: 'SET_READY' });
      return;
    }
    
    if (session?.user) {
      dispatch({ type: 'SET_USER', payload: session.user });
      setSessionTag('AUTHENTICATING');
      
      try {
        const [entitlements, mostRecent] = await Promise.all([
          loadEntitlementsOnce(session.user.id),
          getMostRecentState(session.user.id)
        ]);
        
        if (!isMounted) return;
        
        dispatch({ type: 'SET_SUBSCRIPTION', payload: entitlements.subscription });
        dispatch({ type: 'SET_TRIAL', payload: entitlements.trial });
        setSessionTag('ENTITLED');
        
        if (isPremiumSubscription(entitlements.subscription, entitlements.trial) && mostRecent?.guests?.length > 0) {
          if (stateRef.current.guests.length > 0) {
            setMostRecentData(sanitizeAndMigrateAppState(mostRecent));
            setShowMostRecentModal(true);
          } else {
            dispatch({ type: 'LOAD_MOST_RECENT', payload: sanitizeAndMigrateAppState(mostRecent) });
            dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
            dispatch({ type: 'SET_READY' });
          }
        } else {
          dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
          dispatch({ type: 'SET_READY' });
        }
      } catch (err) {
        console.error('[Auth] Error:', err);
        setSessionTag('ENTITLED');
        dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
        dispatch({ type: 'SET_READY' });
      }
    }
  });
  
  return () => {
    isMounted = false;
    authSubscription?.unsubscribe();
  };
}, []);
```

### 4.10 Modal with React lazy() + Suspense

```typescript
// Import lazy and Suspense
import { lazy, Suspense } from 'react';

// Create inline fallback modal component
function InlineRestoreModal({ onRestore, onKeep }: { onRestore: () => void; onKeep: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full">
        <h3 className="text-lg font-medium mb-3">Restore Session?</h3>
        <p className="text-sm text-gray-600 mb-4">Cloud data found. Restore or keep local?</p>
        <div className="flex justify-end gap-2">
          <button onClick={onKeep} className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300">Keep Current</button>
          <button onClick={onRestore} className="px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700">Restore Recent</button>
        </div>
      </div>
    </div>
  );
}

// Lazy load modal component
const MostRecentChoiceModal = lazy(() =>
  import('../components/MostRecentChoiceModal').catch(() => ({ default: InlineRestoreModal }))
);

// Modal handlers (idempotent)
const handleUseMostRecent = useCallback(() => {
  if (handlingRef.current) return;
  handlingRef.current = true;
  
  if (mostRecentData) {
    dispatch({ type: 'LOAD_MOST_RECENT', payload: mostRecentData });
  }
  setShowMostRecentModal(false);
  setMostRecentData(null);
  dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
  dispatch({ type: 'SET_READY' });
  
  setTimeout(() => { handlingRef.current = false; }, 100);
}, [mostRecentData, dispatch]);

const handleKeepCurrent = useCallback(() => {
  if (handlingRef.current) return;
  handlingRef.current = true;
  
  setShowMostRecentModal(false);
  setMostRecentData(null);
  dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
  dispatch({ type: 'SET_READY' });
  
  setTimeout(() => { handlingRef.current = false; }, 100);
}, [dispatch]);

// In AppProvider return JSX, add:
{showMostRecentModal && mostRecentData && (
  <Suspense fallback={<InlineRestoreModal onRestore={handleUseMostRecent} onKeep={handleKeepCurrent} />}>
    <MostRecentChoiceModal
      userId={state.user?.id || ''}
      isPremium={isPremiumSubscription(state.subscription, state.trial)}
      recentTimestamp={mostRecentData.timestamp}
      onClose={handleKeepCurrent}
      onRestoreRecent={handleUseMostRecent}
      onKeepCurrent={handleKeepCurrent}
      error={null}
      loading={false}
    />
  </Suspense>
)}
```

---

## PHASE 5: Component Loading Guards (15 minutes)

### 5.1 SeatingPlanViewer.tsx

**File:** `src/pages/SeatingPlanViewer.tsx`

Add guard at the VERY START of component:

```typescript
const SeatingPlanViewer: React.FC = () => {
  const { state } = useApp();

  // CRITICAL: Guard on BOTH flags
  if (!state.isReady || !state.loadedRestoreDecision) {
    return (
      <div className="flex items-center justify-center min-h-[300px]" role="status" aria-label="Loading...">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mr-3" aria-hidden="true"></div>
        <span>Loading...</span>
      </div>
    );
  }
  
  const safePlans = state.seatingPlans || [];
  const safeIndex = state.currentPlanIndex || 0;
  const plan = safePlans[safeIndex] ?? null;
  
  // Rest of component...
  
  return (
    <div>
      {/* Display state.warnings if present */}
      {state.warnings?.length > 0 && (
        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 space-y-1" role="alert" aria-live="polite">
          {state.warnings.map((warning, idx) => (
            <p key={idx}>⚠️ {warning}</p>
          ))}
        </div>
      )}
      {/* ... rest of component ... */}
    </div>
  );
};
```

### 5.2 TableManager.tsx

**File:** `src/pages/TableManager.tsx` - Add same guard pattern at start

---

## PHASE 6: Multi-Table Input + Inline Warnings (20 minutes)

**File:** `src/pages/TableManager.tsx`

### 6.1 Add Local State

```typescript
const [rawAssignmentInput, setRawAssignmentInput] = useState<Record<string, string>>({});
const [assignmentWarnings, setAssignmentWarnings] = useState<Record<string, string[]>>({});
```

### 6.2 Input Handlers

```typescript
const handleAssignmentInputChange = useCallback((guestId: string, value: string) => {
  setRawAssignmentInput(prev => ({ ...prev, [guestId]: value }));
  setAssignmentWarnings(prev => {
    const { [guestId]: _, ...rest } = prev;
    return rest;
  });
}, []);

const handleAssignmentCommit = useCallback((guestId: string) => {
  const rawValue = rawAssignmentInput[guestId];
  const committedValue = state.assignments[guestId] || '';
  
  if (rawValue !== undefined && rawValue !== committedValue) {
    const { idCsv, warnings } = normalizeAssignmentInputToIdsWithWarnings(
      rawValue,
      state.tables,
      isPremiumSubscription(state.subscription, state.trial)
    );
    
    setAssignmentWarnings(prev => ({ ...prev, [guestId]: warnings }));
    dispatch({ type: 'UPDATE_ASSIGNMENT', payload: { guestId, raw: idCsv } });
  } else {
    setAssignmentWarnings(prev => {
      const { [guestId]: _, ...rest } = prev;
      return rest;
    });
  }
  
  setRawAssignmentInput(prev => {
    const { [guestId]: _, ...rest } = prev;
    return rest;
  });
}, [rawAssignmentInput, state.assignments, state.tables, state.subscription, state.trial, dispatch]);
```

### 6.3 Update Input JSX

```typescript
<input
  type="text"
  value={rawAssignmentInput[guest.id] ?? state.assignments[guest.id] ?? ''}
  onChange={(e) => handleAssignmentInputChange(guest.id, e.target.value)}
  onBlur={() => handleAssignmentCommit(guest.id)}
  onKeyDown={(e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAssignmentCommit(guest.id);
    } else if (e.key === 'Escape') {
      setRawAssignmentInput(prev => {
        const { [guest.id]: _, ...rest } = prev;
        return rest;
      });
    }
  }}
  placeholder="1, 3, 5"
  className="..."
  aria-describedby={assignmentWarnings[guest.id]?.length ? `warning-${guest.id}` : undefined}
  aria-invalid={assignmentWarnings[guest.id]?.length ? 'true' : 'false'}
/>

{assignmentWarnings[guest.id]?.length > 0 && (
  <div id={`warning-${guest.id}`} className="mt-1 text-xs text-red-600 space-y-0.5" role="alert" aria-live="polite">
    {assignmentWarnings[guest.id].map((warning, idx) => (
      <p key={idx}>⚠️ {warning}</p>
    ))}
  </div>
)}
```

### 6.4 Add Capacity Warning Display (near Generate button)

```typescript
{state.warnings?.length > 0 && (
  <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700 space-y-1" role="alert" aria-live="polite">
    {state.warnings.map((warning, idx) => (
      <p key={idx}>⚠️ {warning}</p>
    ))}
  </div>
)}
```

---

## PHASE 7: Testing (30 minutes)

Execute all 15 tests:

### A. Anonymous & Premium Stability (1-6)
1. Anonymous reload preserves data
2. Premium reload shows modal (if cloud data exists)
3. Modal "Restore Recent" loads cloud data
4. Modal "Keep Current" preserves local data
5. Components show loading state during initialization
6. Reload after sign-in preserves data

### B. Algorithm & Input (7-11)
7. Multi-table input: "1, 3, TableZ" → inline warning for "TableZ", state has "1,3"
8. MUST chain with partial assignments (Test 8 from Phase 2)
9. Algorithm receives correct guest count (not 0)
10. Unassigned members in MUST group don't over-restrict
11. Impossible capacity shows INLINE WARNING (not toast)

### C. Auto-Regeneration Policy (12-15)
12. Remove CANNOT → plans preserved (no regen)
13. Increase table capacity → plans preserved (no regen)
14. Reorder guests → plans preserved (no regen)
15. Add MUST → plans cleared, regeneration triggered

---

## Success Criteria (ALL must pass)

✅ No `ReferenceError` in console  
✅ Console NEVER logs 0 guests when guests exist  
✅ Premium modal flow works (component or inline fallback)  
✅ MUST chains place correctly  
✅ Reload preserves data  
✅ Input allows commas; inline warnings appear  
✅ Loading states check BOTH `isReady` AND `loadedRestoreDecision`  
✅ Capacity errors shown via INLINE WARNING (not toast)  
✅ Plans preserved on looser/neutral changes  
✅ Plans regenerated on stricter changes  
✅ Reducers are pure (no toasts inside reducers)  
✅ `npm run build` succeeds  
✅ `npm run lint` passes

---

## Deployment Checklist

1. Create branch: `git checkout -b fix/emergency-plus-consensus-revised-1026at432pm`
2. Apply Phase 0: Emergency fix
3. Test: `npm run dev` - verify app loads
4. Apply Phase 1: Setup + verification + sanitizeAndMigrateAppState
5. Run Phase 1.1: `npx tsx verify-deps.ts`
6. Run Phase 2: `npm run test:phase1b`
7. Delete: `rm test-phase1b.ts verify-deps.ts`
8. Apply Phase 3: ONLY if Test 8 failed
9. Apply Phase 4: State management (complete)
10. Apply Phase 5: Loading guards
11. Apply Phase 6: Input handling
12. Execute Phase 7: All 15 tests
13. Build: `npm run build`
14. Lint: `npm run lint`
15. Commit: `git commit -m "fix: Emergency runtime error + consensus implementation (Phase 1B: [Yes/No])"`
16. Push: `git push origin fix/emergency-plus-consensus-revised-1026at432pm`
17. Deploy to production
18. Tag: `git tag -a v1026at432pm -m "Emergency fix + consensus with rival AI guardrails (Phase 1B: [Yes/No])"`
19. Push tag: `git push origin v1026at432pm`

---

## Emergency Rollback

If deployment fails:

```bash
git checkout v1024at5pm
npm run build
# Redeploy
```

---

## Summary

This plan addresses:
- ✅ Critical runtime error (resetDisabled)
- ✅ Data persistence on reload
- ✅ Algorithm correct guest handling
- ✅ Multi-table assignment input with inline warnings
- ✅ Auto-regeneration policy via reducer gating
- ✅ Modal restore logic with React lazy() + Suspense
- ✅ Pure reducers (no side effects)
- ✅ Complete, executable code blocks
- ✅ Set-based strictness detection
- ✅ Dual loading guards
- ✅ String ID normalization
- ✅ **NEW:** `sanitizeAndMigrateAppState` implementation
- ✅ **NEW:** Expanded dependency verification
- ✅ **CONDITIONAL:** AbortController (only if API supports it)

**Status:** ✅ Ready for immediate execution with all rival AI guardrails

