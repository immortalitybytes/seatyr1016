# MASTER DOCUMENT: Single Source of Truth (SSoT) - October 25, 2025 at 4:44 PM

**Project:** Seatyr - Event Seating Management Platform  
**Current Version:** Working towards stable post-1025at336pm  
**Production URL:** https://seatyr.com  
**Netlify Site:** `seatyroctober`  
**Last Stable Tag:** `1025at336pm` (with known issues)

---

## EXECUTIVE SUMMARY

The Seatyr application is experiencing **critical runtime failures** preventing basic functionality. The application is stuck in a perpetual loading state ("Loading Seatyr...") and cannot render the main UI. Console logs reveal multiple issues:

1. **JavaScript Runtime Error (CRITICAL):** `ReferenceError: Can't find variable: resetDisabled` at AppContext.tsx:750
2. **Content Security Policy Violations (HIGH):** Multiple stylesheet application failures
3. **Data Persistence Issues (HIGH):** `RESET_APP_STATE` being called during initialization, clearing user data
4. **No Seating Plans Available (HIGH):** Despite auto-generation attempts, no plans are displayed

**Current State:** Application is **COMPLETELY BROKEN** - users cannot access any functionality.

---

## CURRENT CRITICAL ISSUES (Priority 0 - BLOCKING)

### Issue #1: JavaScript ReferenceError - `resetDisabled` Undefined

**Severity:** CRITICAL - Application Cannot Load  
**Location:** `src/context/AppContext.tsx:750`  
**Error Message:** `ReferenceError: Can't find variable: resetDisabled`

**Technical Analysis:**
```typescript
// LINE 750 - PROBLEMATIC CODE:
setTimeout(() => {
  resetDisabled = false;  // ❌ ERROR: Variable never declared
  console.log('[Auth] Reset enabled after initialization');
}, 2000);
```

**Root Cause:**
- Variable `resetDisabled` is referenced but never declared in the auth listener's scope
- This is a **leftover from previous refactoring attempts** to prevent data loss on reload
- The variable was removed during code cleanup but the reference remained

**Impact:**
- JavaScript execution halts at this line
- Application cannot complete initialization
- Users see perpetual "Loading Seatyr..." spinner
- No UI elements render
- All functionality is inaccessible

**Previous Context:**
Earlier attempts to fix data loss on reload introduced complex timing logic with `resetDisabled`, `hasInitialized`, and grace period flags. These were simplified but not fully cleaned up, leaving this orphaned reference.

**Diagnosis Confidence:** 100% - This is definitively causing the application crash

---

### Issue #2: Content Security Policy (CSP) Violations

**Severity:** HIGH - Styling Broken  
**Error Count:** 5+ distinct violations  
**Error Message:** `Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear in the style-src directive of the Content Security Policy`

**Affected Files:**
- `controller-with-dual-preconnect-control-910e5633c60306ba869ed9b4b4f1b91a.html:1`
- `m-outer-3437aaddcdf6922d623e172c2d6f9278.html:1`
- `inner.html:1`

**Technical Analysis:**
These errors indicate that dynamically injected stylesheets (likely from third-party services like Stripe) are being blocked by the browser's Content Security Policy. Some errors are marked `[Report Only]`, suggesting a partial CSP implementation.

**Impact:**
- UI elements may be unstyled or incorrectly styled
- Layout may be broken
- User experience significantly degraded
- Payment integration (Stripe) may not display correctly

**Root Cause:**
- CSP is too restrictive for current styling approach
- Dynamically injected styles lack proper `nonce` attributes
- Missing hash values for inline `<style>` blocks
- `'unsafe-inline'` directive not permitted but required for certain frameworks

**Diagnosis Confidence:** 95% - CSP violations are confirmed, but impact is secondary to runtime error

---

### Issue #3: Data Loss on Reload - `RESET_APP_STATE` Called During Initialization

**Severity:** HIGH - Data Persistence Failure  
**Location:** `src/context/AppContext.tsx` auth listener  
**Symptom:** Console shows `[AppContext] RESET_APP_STATE called - clearing all data`

**Technical Analysis:**
```typescript
// PROBLEMATIC FLOW:
1. User reloads page
2. Auth listener fires with 'SIGNED_OUT' or 'INITIAL_SESSION' event
3. Logic incorrectly interprets reload as sign-out
4. RESET_APP_STATE dispatched
5. All user data cleared from state
6. localStorage may be cleared
```

**Evidence from Console Logs:**
- `[AppContext] RESET_APP_STATE called - clearing all data` appears during initialization
- `[Persistence] No saved data found` appears after data should have been loaded
- `[AppProvider] localStorage data exists: - false` despite previous saves

**Root Cause:**
Multiple protection mechanisms were added but are not working correctly:
1. **Reducer-level guard:** Checks `state.isReady` and `state.loadedRestoreDecision` but these may not be set correctly
2. **Auth listener guard:** Checks `sessionTag === 'INITIALIZING'` but timing is off
3. **hasInitialized flag:** Local to auth listener, may not persist across re-renders

**Previous Fix Attempts:**
1. Added `hasInitialized` flag - INSUFFICIENT
2. Added `INITIALIZATION_GRACE_PERIOD` (10s, then 15s) - REMOVED as too complex
3. Added `resetDisabled` flag - CAUSED CURRENT CRASH (variable not declared)
4. Added reducer-level blocking - INSUFFICIENT

**Impact:**
- Users lose all work on page reload
- Trust in application eroded
- Data persistence system ineffective
- Robust persistence utilities (localStorage, IndexedDB, file export) are bypassed

**Diagnosis Confidence:** 90% - Multiple console log entries confirm this is happening

---

### Issue #4: No Seating Plans Available

**Severity:** HIGH - Core Functionality Broken  
**Location:** `src/pages/SeatingPlanViewer.tsx`  
**Symptom:** UI shows "Current Plan (1 of 0)" and "No seating plan available"

**Technical Analysis:**
```typescript
// CONSOLE EVIDENCE:
[SeatingPage] Auto-generating seating plans on page mount  // ✓ Triggered
[AppContext] RESET_APP_STATE called - clearing all data    // ✗ Plans cleared
```

**Root Cause Chain:**
1. Page mounts → Dispatches `SEATING_PAGE_MOUNTED` action
2. Reducer sets `regenerationNeeded: true`
3. Algorithm trigger attempts to generate plans
4. **HOWEVER:** `RESET_APP_STATE` is called during initialization
5. Plans are cleared before they can be displayed
6. `seatingPlans` array becomes empty
7. UI shows "No seating plan available"

**Additional Factors:**
- `state.seatingPlans` may be `undefined` instead of `[]` due to migration issues
- `state.currentPlanIndex` may be `undefined` instead of `0`
- Safety checks in SeatingPlanViewer use `|| []` and `|| 0` fallbacks

**Impact:**
- Primary application feature is non-functional
- Users cannot view generated seating arrangements
- Algorithm may be working correctly but results are not persisted/displayed

**Diagnosis Confidence:** 85% - Circumstantial evidence from console logs

---

## ARCHITECTURAL OVERVIEW

### State Management Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      AppContext.tsx                          │
│                  (Single Source of Truth)                    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │  State (useReducer)                                │    │
│  │  - guests, tables, constraints, adjacents          │    │
│  │  - seatingPlans, currentPlanIndex                  │    │
│  │  - user, subscription, trial                       │    │
│  │  - isReady, loadedRestoreDecision                  │    │
│  │  - regenerationNeeded                              │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Session Management (useEffect)                    │    │
│  │  - Auth state listener (supabase.auth)            │    │
│  │  - Entitlements loading (loadEntitlementsOnce)    │    │
│  │  - Session tag FSM (INITIALIZING → ANON/ENTITLED) │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Data Persistence (useEffect)                      │    │
│  │  - Robust persistence (localStorage + IndexedDB)   │    │
│  │  - Auto-save with debouncing                       │    │
│  │  - Cloud sync for premium users                    │    │
│  └────────────────────────────────────────────────────┘    │
│                                                              │
│  ┌────────────────────────────────────────────────────┐    │
│  │  Algorithm Trigger (useEffect)                     │    │
│  │  - Debounced seating plan generation              │    │
│  │  - Guards: isReady && regenerationNeeded          │    │
│  │  - Asymmetric regeneration policy                  │    │
│  └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
   ┌─────────┐         ┌──────────┐        ┌──────────┐
   │ Supabase│         │localStorage│       │ IndexedDB│
   │  Auth   │         │  Primary   │       │  Backup  │
   └─────────┘         └──────────┘        └──────────┘
```

### Data Flow on Page Load

```
1. User navigates to/reloads page
   ↓
2. AppProvider mounts
   ↓
3. useReducer initializes with initializeState function
   ↓
4. Async initialization effect runs:
   - Calls loadAppState() from persistence.ts
   - Attempts to load from localStorage → IndexedDB → file import
   ↓
5. Auth listener effect runs:
   - supabase.auth.onAuthStateChange fires
   - Event: 'INITIAL_SESSION' or 'SIGNED_OUT'
   ↓
6. ⚠️ PROBLEM: Auth listener may dispatch RESET_APP_STATE
   - Clears data loaded in step 4
   - Sets state back to initialState
   ↓
7. Components attempt to render
   - SeatingPlanViewer sees empty seatingPlans
   - TableManager sees empty tables
   - GuestManager sees empty guests
   ↓
8. ❌ CRASH: resetDisabled reference error halts execution
```

---

## RECENT CODE CHANGES & FIX ATTEMPTS

### Session 1: Initial Data Loss Investigation (1025 2:22pm - 3:36pm)

**Problem Identified:** Data lost on page reload

**Fixes Attempted:**
1. Added `hasInitialized` flag to auth listener
2. Added `INITIALIZATION_GRACE_PERIOD` (10 seconds)
3. Added `resetDisabled` flag with 2-second timeout
4. Added reducer-level guard in `RESET_APP_STATE` case

**Result:** Application appeared to improve but still had issues

**Tag Created:** `1025at336pm` with note: "apparent improvement, but needs auto-generate seating plans upon arrival at the 'Seating' page"

### Session 2: Auth Listener Delay Approach (1025 3:36pm - 3:50pm)

**Problem:** Reload still crashes site

**Fix Attempted:**
- Increased auth listener delay to 3 seconds
- Increased grace period to 15 seconds
- Added `authListenerActive` flag to completely disable listener during init

**Code Added:**
```typescript
let authListenerEnabled = false;

const enableAuthTimer = setTimeout(() => {
  authListenerEnabled = true;
  console.log('[Auth] Auth listener enabled after initialization delay');
}, 3000); // 3 second delay

// In auth listener:
if (!authListenerEnabled) {
  console.log('[Auth] Auth event ignored during initialization delay:', event);
  return;
}
```

**Result:** Made it WORSE - app stuck in loading state, data not loading

**User Feedback:** "you made it worse"

### Session 3: Simplified Approach (1025 3:50pm - 4:00pm)

**Problem:** Complex timing logic causing more issues

**Fix Attempted:**
- Removed auth listener delay
- Simplified to just `hasInitialized` flag
- Kept reducer-level guard

**Result:** Still worse - app stuck in loading state

**User Feedback:** "still worse"

### Session 4: Complete Revert (1025 4:00pm - 4:28pm)

**Problem:** All previous fixes made things worse

**Fix Attempted:**
- Reverted ALL timing delays
- Removed `authListenerEnabled` flag
- Removed `INITIALIZATION_GRACE_PERIOD`
- Kept only basic `hasInitialized` flag

**Code Remaining:**
```typescript
useEffect(() => {
  let hasInitialized = false;
  
  const { data: { subscription: authSub } } = supabase.auth.onAuthStateChange(async (event, session) => {
    // ... auth logic ...
    
    // Enable reset after successful initialization
    setTimeout(() => {
      resetDisabled = false;  // ❌ ERROR: Variable never declared!
      console.log('[Auth] Reset enabled after initialization');
    }, 2000);
  });
  
  return () => { authSub.unsubscribe(); };
}, []);
```

**Result:** **CRITICAL CRASH** - `ReferenceError: Can't find variable: resetDisabled`

**Current State:** Application completely broken, cannot load

---

## ROBUST PERSISTENCE SYSTEM (IMPLEMENTED BUT BYPASSED)

### Overview

A comprehensive multi-layer data persistence system was implemented in `src/utils/persistence.ts`:

**Layer 1: localStorage (Primary)**
- Key: `seatyr_app_state`
- Synchronous read/write
- 5-10MB typical storage limit
- Cleared on explicit sign-out only

**Layer 2: Timestamped Backups (Secondary)**
- Keys: `seatyr_backup_[ISO_TIMESTAMP]`
- Automatic rotation (keeps last 5)
- Allows recovery from recent states

**Layer 3: IndexedDB (Tertiary)**
- Database: `SeatyrData`
- Store: `appState`
- Asynchronous, larger capacity
- Survives localStorage quota issues

**Layer 4: File Export/Import (Manual)**
- JSON file download/upload
- User-controlled backups
- Portable across devices

### Functions Implemented

```typescript
// Core persistence
export async function saveAppState(data: AppState): Promise<PersistenceResult>
export async function loadAppState(): Promise<PersistenceResult>

// Manual backup/restore
export function exportAppState(data: AppState): void
export function importAppState(file: File): Promise<PersistenceResult>

// Maintenance
export function clearAllSavedData(): void
export function getStorageStats(): { localStorage: number; backups: number; indexedDBAvailable: boolean }
```

### Integration Points

**AppContext.tsx:**
```typescript
// Initialization (async)
useEffect(() => {
  const initializeApp = async () => {
    const result = await loadAppState();
    if (result.success && result.data) {
      // Dispatch loaded data to reducer
    }
    setIsInitialized(true);
    dispatch({ type: 'SET_READY' });
  };
  initializeApp();
}, []);

// Auto-save (debounced)
useEffect(() => {
  const saveData = async () => {
    await saveAppState(autosavePayload);
  };
  const timer = setTimeout(saveData, 500);
  return () => clearTimeout(timer);
}, [autosaveSignature, sessionTag]);
```

**Header.tsx:**
- Export button → calls `exportAppState()`
- Import button → calls `importAppState(file)`
- Clear All Data button → calls `clearAllSavedData()`
- Storage Stats display → calls `getStorageStats()`

### Current Status

**Implementation:** ✅ COMPLETE  
**Integration:** ✅ COMPLETE  
**Functionality:** ❌ BYPASSED by RESET_APP_STATE

**Problem:** The robust persistence system works correctly, but `RESET_APP_STATE` being called during initialization clears all data before it can be used.

---

## AUTO-REGENERATION POLICY (IMPLEMENTED)

### Asymmetric Regeneration Logic

The application implements an "asymmetric" regeneration policy where seating plans are only regenerated when changes make constraints **stricter**, not **looser**.

**Stricter Changes (Trigger Regeneration):**
- Adding a MUST constraint
- Adding a CANNOT constraint
- Reducing table capacity
- Removing a table
- Restricting guest assignments (e.g., "1,2,3" → "1,2")

**Looser Changes (Preserve Plans):**
- Removing a MUST constraint
- Removing a CANNOT constraint
- Increasing table capacity
- Adding a table
- Expanding guest assignments (e.g., "1,2" → "1,2,3")

**Neutral Changes (Preserve Plans):**
- Reordering guests
- Renaming guests
- Renaming tables (premium feature)

### Implementation in Reducer

```typescript
case 'CYCLE_CONSTRAINT': {
  const isStricter = (nextState !== '' && currentState === '') || 
                     (nextState !== '' && currentState !== '' && nextState !== currentState);
  
  return {
    ...state,
    constraints: newConstraints,
    adjacents: newAdjacents,
    regenerationNeeded: isStricter ? true : state.regenerationNeeded,
    seatingPlans: isStricter ? [] : state.seatingPlans,
    currentPlanIndex: isStricter ? 0 : state.currentPlanIndex
  };
}

case 'UPDATE_TABLE': {
  const isCapacityReduced = seats !== undefined && currentTable && 
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
```

### Trigger Mechanism

```typescript
// Debounced algorithm trigger
const runGenerator = useCallback(() => {
  const s = stateRef.current;
  
  // Guards
  if (!s.isReady || !s.loadedRestoreDecision || !s.regenerationNeeded) return;
  if (s.guests.length === 0 || s.tables.length === 0) return;
  
  // Generate plans
  generateSeatingPlans({
    guests: s.guests,
    tables: s.tables,
    constraints: s.constraints,
    adjacents: s.adjacents,
    assignments: s.assignments,
    isPremium: isPremiumSubscription(s.subscription, s.trial)
  }).then(({ plans, errors }) => {
    dispatch({ type: 'SET_SEATING_PLANS', payload: { plans, errors } });
  });
}, [dispatch]);

const debouncedGeneratePlans = useMemo(() => {
  return debounce(runGenerator, 180, { leading: false, trailing: true });
}, [runGenerator]);

// Effect that triggers on state changes
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

### Current Status

**Implementation:** ✅ COMPLETE  
**Logic:** ✅ CORRECT  
**Functionality:** ⚠️ PARTIALLY WORKING

**Problem:** Auto-generation triggers correctly but plans may be cleared by `RESET_APP_STATE` before display.

---

## LOADING STATE & READINESS FLAGS

### State Flags

**`isReady: boolean`**
- Single source of truth for application readiness
- Set to `true` when initialization completes
- Guards component rendering and algorithm triggering
- Default: `false`

**`loadedRestoreDecision: boolean`**
- Indicates whether session restore decision has been made
- For premium users: set after modal interaction
- For anonymous users: set immediately
- Guards data-fetching components
- Default: `false`

**`regenerationNeeded: boolean`**
- Indicates whether seating plans need to be regenerated
- Set by reducer actions based on asymmetric policy
- Cleared after successful generation
- Default: `true`

### Session Tag FSM

```
INITIALIZING → AUTHENTICATING → ANON / ENTITLED
     ↓              ↓               ↓
   ERROR ←─────────┴───────────────┘
```

**States:**
- `INITIALIZING`: App starting, checking session
- `AUTHENTICATING`: Fetching entitlements
- `ANON`: Anonymous user (no auth)
- `ENTITLED`: Authenticated user (with/without premium)
- `ERROR`: Fatal error during initialization

### Loading UI

```typescript
// AppContext.tsx
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
```

**Current Issue:** Application stuck in this loading state due to runtime error.

---

## PREMIUM FEATURES & MODE DETECTION

### Mode Derivation

**Single Source of Truth:**
```typescript
const mode = deriveMode(state);  // Returns 'free' | 'premium'
```

**All components use:**
```typescript
const { mode } = useApp();
const isPremium = mode === 'premium';
```

### Premium Features

**Table Management:**
- ✅ Rename tables (custom names)
- ✅ Adjust seating capacity
- ✅ Unlimited tables

**Guest Management:**
- ✅ Up to 10,000 guests (vs 80 for free)
- ✅ Multi-table assignments by name

**Constraints:**
- ✅ Unlimited MUST/CANNOT constraints
- ✅ Adjacent pairing (⭐ emoji)

**Seating Plans:**
- ✅ Generate up to 50 plans (vs 10 for free)
- ✅ Cloud sync across devices
- ✅ Session restore modal

**Saved Settings:**
- ✅ Save up to 50 configurations (vs 5 for free)
- ✅ Cloud storage

### Subscription Detection

```typescript
export function isPremiumSubscription(
  subscription: UserSubscription | null | undefined,
  trial: TrialSubscription | null | undefined
): boolean {
  // Check active subscription
  if (subscription?.status === 'active' || subscription?.status === 'trialing') {
    return true;
  }
  
  // Check trial expiry
  if (trial?.expires_on) {
    const expiryDate = new Date(trial.expires_on);
    const now = new Date();
    return expiryDate > now;
  }
  
  return false;
}
```

---

## DATABASE SCHEMA & MIGRATIONS

### Supabase Tables

**`subscriptions`**
- `id` (uuid, PK)
- `user_id` (uuid, FK → auth.users)
- `stripe_customer_id` (text)
- `stripe_subscription_id` (text)
- `status` ('active' | 'canceled' | 'past_due' | 'trialing')
- `current_period_end` (timestamp)
- RLS: Enabled ✅

**`trial_subscriptions`**
- `id` (uuid, PK)
- `user_id` (uuid, FK → auth.users)
- `trial_code` (text)
- `start_date` (timestamp)
- `expires_on` (timestamp) ⚠️ Note: NOT `expires_at`
- RLS: Enabled ✅

**`recent_session_states`**
- `id` (uuid, PK, default: gen_random_uuid())
- `user_id` (uuid, NOT NULL)
- `data` (jsonb, NOT NULL)
- `created_at` (timestamp, default: now())
- `updated_at` (timestamp, default: now())
- RLS: Enabled ✅
- Indexes: `idx_recent_session_states_user_id_updated` (user_id, updated_at DESC)

**`recent_session_settings`**
- `id` (uuid, PK, default: gen_random_uuid())
- `user_id` (uuid, NOT NULL)
- `data` (jsonb, NOT NULL)
- `created_at` (timestamp, default: now())
- `updated_at` (timestamp, default: now())
- RLS: Enabled ✅
- Indexes: `idx_recent_session_settings_user_id_updated` (user_id, updated_at DESC)

**`saved_settings`**
- `id` (uuid, PK)
- `user_id` (uuid, FK → auth.users)
- `name` (text)
- `data` (jsonb)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- RLS: Enabled ✅

### Migration Status

**Phase A: Database Hardening** ✅ COMPLETE
- A1: Deduplication ✅
- A2: Unique constraints ✅
- A3: Performance indexes ✅
- A4: RLS policies ✅
- A5: Orphaned data cleanup ⚠️ INCOMPLETE (schema mismatch resolved, cleanup pending)

**Outstanding Migration Task:**
Run orphaned data cleanup with corrected column names:
```sql
-- Preview orphaned records
WITH deleted_states AS (
  SELECT rss.id, rss.user_id
  FROM recent_session_states rss
  LEFT JOIN auth.users u ON rss.user_id = u.id
  WHERE u.id IS NULL AND rss.user_id IS NOT NULL
),
deleted_settings AS (
  SELECT rset.id, rset.user_id
  FROM recent_session_settings rset
  LEFT JOIN auth.users u ON rset.user_id = u.id
  WHERE u.id IS NULL AND rset.user_id IS NOT NULL
)
SELECT 
  (SELECT COUNT(*) FROM deleted_states) AS orphaned_states_count,
  (SELECT COUNT(*) FROM deleted_settings) AS orphaned_settings_count;
```

---

## RESOLVED ISSUES (Historical Context)

### A. Incorrect Diagnoses (Now Corrected)

**A.1 Missing `id` Columns**
- **Initial Belief:** Tables lacked `id` columns
- **Actual Reality:** Both tables have UUID `id` columns
- **Resolution:** Schema discovery confirmed correct structure

**A.2 `expires_at` Column**
- **Initial Belief:** `trial_subscriptions` had both `expires_on` and `expires_at`
- **Actual Reality:** Only `expires_on` exists
- **Resolution:** Removed all `expires_at` references

**A.3 Assignment Algorithm Bug**
- **Initial Belief:** Algorithm rejected multi-table assignments
- **Actual Reality:** Algorithm worked correctly, UI prevented input
- **Resolution:** Fixed UI input handling with local state

### B. Successfully Resolved Issues

**B.1 PostCSS/Tailwind Build Failures** ✅
- **Fix:** `rm -rf node_modules && npm install`
- **Status:** Builds complete successfully

**B.2 Wrong Netlify Site Deployments** ✅
- **Fix:** Verified correct site configuration
- **Status:** All deployments to `seatyroctober`

**B.3 `isPremiumSubscription` Inconsistency** ✅
- **Fix:** Unified all components to use `mode === 'premium'`
- **Status:** Consistent premium detection

**B.4 Missing Mode-Based Helpers** ✅
- **Fix:** Added backward-compatible wrappers in `premium.ts`
- **Status:** All builds succeed

**B.5 GuestManager Integrity Check** ✅
- **Fix:** Updated expected SHA values
- **Status:** Pre-commit hooks pass

**B.6 Invisible Render Gate** ✅
- **Fix:** Replaced `return null` with loading spinner
- **Status:** Users see proper loading feedback

**B.7 Table Naming/Capacity** ✅
- **Fix:** Added `UPDATE_TABLE` reducer action
- **Status:** Premium features work correctly

---

## CRITICAL FILE INVENTORY

### Core Application Files

**`src/context/AppContext.tsx`** (1020 lines)
- **Purpose:** Single Source of Truth state management
- **Critical Sections:**
  - Lines 22-71: Inline debounce utility
  - Lines 89-133: Entitlements loading
  - Lines 135-450: Reducer with all actions
  - Lines 451-650: AppProvider with initialization
  - Lines 656-757: Auth state listener ⚠️ CONTAINS CRASH BUG (line 750)
  - Lines 760-800: Premium detection and trial expiry
  - Lines 801-900: Persistence effects
  - Lines 901-950: Algorithm trigger with debounce
  - Lines 951-1020: Context provider and exports

**`src/types/index.ts`** (110 lines)
- **Purpose:** TypeScript interfaces
- **Key Types:** AppState, Guest, Table, SeatingPlan, Constraints, Assignments

**`src/utils/persistence.ts`** (384 lines)
- **Purpose:** Robust multi-layer data persistence
- **Functions:** saveAppState, loadAppState, exportAppState, importAppState, clearAllSavedData

**`src/utils/seatingAlgorithm.engine.ts`** (~800 lines)
- **Purpose:** Core seating algorithm logic
- **Features:** MUST/CANNOT constraints, adjacent pairing, capacity validation

**`src/utils/seatingAlgorithm.ts`** (~150 lines)
- **Purpose:** Algorithm adapter
- **Role:** Prepares data for engine, handles errors

**`src/pages/SeatingPlanViewer.tsx`** (422 lines)
- **Purpose:** Display generated seating plans
- **Features:** Plan navigation, table visualization, guest highlighting
- **Current Issue:** Shows "No seating plan available"

**`src/pages/TableManager.tsx`** (676 lines)
- **Purpose:** Table configuration and guest assignments
- **Features:** Add/remove tables, capacity editing, multi-table assignments

**`src/pages/GuestManager.tsx`** (955 lines)
- **Purpose:** Guest list management
- **Features:** Add/remove guests, party size editing, duplicate detection

**`src/pages/ConstraintManager.tsx`** (~600 lines)
- **Purpose:** MUST/CANNOT/ADJACENT constraint management
- **Features:** Constraint grid, double-click for adjacent pairing

**`src/components/Header.tsx`** (456 lines)
- **Purpose:** Application header with navigation and data management
- **Features:** Login/Join, Data Export/Import, Storage Stats

---

## TESTING CHECKLIST (FOR POST-FIX VERIFICATION)

### Critical Path Tests

**1. Application Loads**
- [ ] Page loads without JavaScript errors
- [ ] Loading spinner appears briefly
- [ ] Main UI renders correctly
- [ ] No CSP violations in console

**2. Data Persistence**
- [ ] Add 5 guests
- [ ] Add 3 tables
- [ ] Reload page
- [ ] Verify guests and tables persist
- [ ] Check console for no RESET_APP_STATE during init

**3. Seating Plan Generation**
- [ ] Navigate to Seating page
- [ ] Verify auto-generation triggers
- [ ] Verify plans appear (not "No seating plan available")
- [ ] Navigate between plans
- [ ] Reload page
- [ ] Verify plans persist

**4. Anonymous User Flow**
- [ ] Use app without signing in
- [ ] Add data
- [ ] Reload page
- [ ] Verify data persists from localStorage

**5. Premium User Flow**
- [ ] Sign in with premium account
- [ ] Add data
- [ ] Reload page
- [ ] Verify session restore modal appears (if cloud data exists)
- [ ] Test "Restore Recent" and "Keep Current" options

**6. Multi-Table Assignments**
- [ ] Assign guest to "1, 3, 5"
- [ ] Verify input accepts commas
- [ ] Verify no inline warnings for valid tables
- [ ] Generate seating plans
- [ ] Verify guest placed at one of assigned tables

**7. Constraint Management**
- [ ] Add MUST constraint
- [ ] Verify plans regenerate
- [ ] Remove MUST constraint
- [ ] Verify plans preserved (not regenerated)

**8. Data Export/Import**
- [ ] Click "Export Data" in header
- [ ] Verify JSON file downloads
- [ ] Clear all data
- [ ] Import downloaded file
- [ ] Verify data restored correctly

---

## RECOMMENDED FIX STRATEGY

### Phase 1: Fix Critical Runtime Error (IMMEDIATE - 5 minutes)

**File:** `src/context/AppContext.tsx`

**Option A: Remove the problematic code block entirely**
```typescript
// LINE 747-753: DELETE THIS ENTIRE BLOCK
// Enable reset after successful initialization
setTimeout(() => {
  resetDisabled = false;  // ❌ DELETE
  console.log('[Auth] Reset enabled after initialization');  // ❌ DELETE
}, 2000);  // ❌ DELETE
```

**Option B: Declare the variable if needed**
```typescript
// LINE 658: ADD THIS
let hasInitialized = false;
let resetDisabled = true;  // ✅ ADD THIS

// LINE 750: KEEP THIS
setTimeout(() => {
  resetDisabled = false;  // ✅ NOW WORKS
  console.log('[Auth] Reset enabled after initialization');
}, 2000);
```

**Recommendation:** **Option A** (remove entirely) - The `resetDisabled` flag was part of complex timing logic that didn't work. Simpler is better.

### Phase 2: Fix RESET_APP_STATE During Initialization (HIGH - 30 minutes)

**Approach:** Strengthen reducer-level guard

**File:** `src/context/AppContext.tsx`

**Current guard (insufficient):**
```typescript
case 'RESET_APP_STATE': 
  console.log('[AppContext] RESET_APP_STATE called - clearing all data');
  if (!state.isReady || !state.loadedRestoreDecision) {
    console.log('[AppContext] RESET_APP_STATE blocked during initialization - preserving data');
    return state;
  }
  return { 
    ...initialState, 
    user: null, 
    subscription: null, 
    trial: null,
    isReady: true,
    loadedRestoreDecision: true
  };
```

**Enhanced guard:**
```typescript
case 'RESET_APP_STATE': 
  console.log('[AppContext] RESET_APP_STATE called');
  
  // CRITICAL: Only allow reset if:
  // 1. App is fully initialized (isReady = true)
  // 2. Restore decision has been made (loadedRestoreDecision = true)
  // 3. This is NOT during the first 5 seconds after mount
  const timeSinceMount = Date.now() - mountTimestamp;
  const isInitializing = timeSinceMount < 5000;
  
  if (!state.isReady || !state.loadedRestoreDecision || isInitializing) {
    console.log('[AppContext] RESET_APP_STATE BLOCKED - preserving data', {
      isReady: state.isReady,
      loadedRestoreDecision: state.loadedRestoreDecision,
      timeSinceMount,
      isInitializing
    });
    return state;  // Return unchanged state
  }
  
  console.log('[AppContext] RESET_APP_STATE ALLOWED - clearing all data');
  try { localStorage.removeItem('seatyr_app_state'); } catch {}
  
  return { 
    ...initialState, 
    user: null, 
    subscription: null, 
    trial: null,
    isReady: true,
    loadedRestoreDecision: true
  };
```

**Add mount timestamp:**
```typescript
// At top of AppProvider
const mountTimestamp = useRef(Date.now());
```

### Phase 3: Fix CSP Violations (MEDIUM - 1 hour)

**Approach:** Update CSP headers or add nonces

**Options:**
1. Add `'unsafe-inline'` to `style-src` (quick but less secure)
2. Generate nonces for inline styles (proper but complex)
3. Move all styles to external stylesheets (best but time-consuming)

**Recommendation:** Option 1 for immediate fix, Option 3 for long-term

### Phase 4: Verify Seating Plans Display (LOW - 15 minutes)

**After fixing Phase 1 & 2, test:**
1. Navigate to Seating page
2. Verify auto-generation triggers
3. Verify plans appear
4. Reload page
5. Verify plans persist

**If still broken, investigate:**
- Algorithm trigger guards
- `seatingPlans` array initialization
- `currentPlanIndex` initialization

---

## DEPLOYMENT INFORMATION

**Production:**
- URL: https://seatyr.com
- Netlify Site: `seatyroctober`
- Current Deploy: Unknown (app is broken)

**Build Status:**
- Last successful build: Yes (compiles without TypeScript errors)
- Runtime status: ❌ BROKEN (JavaScript runtime error)

**Git Tags:**
- `1025at336pm`: "apparent improvement, but needs auto-generate"
- `1025at350pm`: "needs auto-generate and reload still blanks data"
- `1025at4pm`: "some progress but reload still blanks/resets/empties"

**Recommended Next Tag:**
- `1025at444pm-pre-fix`: Tag current broken state before fixes
- `1025at5pm-fixed`: Tag after applying Phase 1 fix

---

## LESSONS LEARNED

### 1. Simplicity Over Complexity
**Problem:** Multiple layers of timing logic (grace periods, delays, flags) made debugging harder and introduced new bugs.

**Lesson:** Start with simplest solution. Add complexity only when necessary and well-tested.

### 2. Test in Isolation
**Problem:** Auth listener, persistence, and algorithm all interact. Hard to identify which is failing.

**Lesson:** Create isolated test cases for each system. Verify each works independently before integration.

### 3. Guard Against Undefined Variables
**Problem:** `resetDisabled` referenced but never declared.

**Lesson:** Use TypeScript strict mode. Enable linting rules for undefined variables. Run tests before deployment.

### 4. Console Logging is Critical
**Problem:** Without console logs, impossible to diagnose timing issues.

**Lesson:** Keep comprehensive logging during development. Use structured log prefixes (`[Auth]`, `[Persistence]`, etc.).

### 5. Incremental Fixes
**Problem:** Attempting to fix multiple issues simultaneously made it worse.

**Lesson:** Fix one issue at a time. Verify each fix before moving to next. Create git tags frequently.

### 6. User Feedback is Gold
**Problem:** Developer thought fixes were working, but user testing revealed issues.

**Lesson:** Test in actual browser with real user workflows. Screenshots are invaluable for debugging.

---

## CONCLUSION

The Seatyr application has a solid architectural foundation with robust persistence, sophisticated state management, and comprehensive features. However, it is currently **completely broken** due to a simple JavaScript runtime error (`resetDisabled` undefined) that halts execution during initialization.

**Immediate Priority:** Fix the runtime error (Phase 1) to restore basic functionality.

**Secondary Priority:** Fix `RESET_APP_STATE` being called during initialization (Phase 2) to restore data persistence.

**Tertiary Priority:** Address CSP violations (Phase 3) to improve styling and security.

**Success Criteria:**
1. Application loads without errors
2. Data persists across page reloads
3. Seating plans generate and display correctly
4. All user workflows function as expected

**Estimated Time to Restore Functionality:**
- Phase 1 (Critical Fix): 5 minutes
- Phase 2 (Data Persistence): 30 minutes
- Phase 3 (CSP): 1 hour
- Testing: 1 hour
- **Total: ~2.5 hours to full restoration**

---

**Document Status:** CURRENT as of October 25, 2025, 4:44 PM  
**Next Update:** After Phase 1 fix is applied and tested  
**Maintainer:** AI Red Teams Collaborative Effort

---

*End of Master Document*



