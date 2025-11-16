<!-- d3313339-d685-444b-8f6b-1a32910f9840 740142f8-00bb-47c5-8cf6-4978b3ce5b78 -->
# Saved Settings Loading Bug: Deep Diagnostic Analysis

## Executive Summary

Premium users cannot view their saved settings in `SavedSettingsAccordion` and `SavedSettings` page until they manually save new settings. Root cause: **SessionTag mismatch** between `AppContext` FSM (uses `'ENTITLED'`) and settings components (check for `'SIGNED_IN'`).

---

## 1. Root Cause Analysis

### 1.1 Primary Issue: SessionTag Type Mismatch

**The Problem:**

```typescript
// AppContext.tsx Line 73
type SessionTag = 'INITIALIZING' | 'AUTHENTICATING' | 'ANON' | 'ENTITLED' | 'ERROR';
// ❌ No 'SIGNED_IN' exists in type definition

// SavedSettingsAccordion.tsx Line 59
if (sessionTag !== 'SIGNED_IN' || ...) {  // ❌ Always true!
  setSettings([]);
  return;
}

// SavedSettings.tsx Line 44  
if (sessionTag !== 'SIGNED_IN' || ...) {  // ❌ Always true!
  setSettings([]);
  return;
}
```

**Authentication Flow:**

```
User logs in
  ↓
AppContext.tsx Line 759: setSessionTag('ENTITLED')  ✓
  ↓
SavedSettingsAccordion checks: sessionTag !== 'SIGNED_IN'  
  ↓
Evaluates to: 'ENTITLED' !== 'SIGNED_IN' → true  ❌
  ↓
Early return, no settings fetch
```

### 1.2 Why Saving Works

`handleSaveCurrentSettings()` (SavedSettingsAccordion.tsx Line 301) calls `await loadSettings()` **directly**, bypassing the useEffect guard entirely:

```typescript
await loadSettings();  // Line 301 - Direct call, no guard
```

This manual invocation loads all settings from Supabase, making them visible.

### 1.3 Secondary Issues Discovered

**Issue A: Modal Timing Race Condition**

When premium users with saved state log in:

```typescript
// AppContext.tsx Lines 768-772
if (data?.guests?.length > 0) {
  setShowRecentModal(true);
  // ❌ loadedRestoreDecision NOT set yet - waiting for modal
}
```

If user dismisses modal quickly OR has no saved state:

```typescript
// Lines 775-777
dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
dispatch({ type: 'SET_READY' });
hasInitialized = true;  // ✓ Sets flag
```

But if modal is shown, `loadedRestoreDecision` only sets when user clicks "Restore" or "Keep Current":

```typescript
// Lines 1011-1017 (onKeepCurrent)
dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
```

**Timing Issue:**

- Component mounts while modal is visible
- `loadedRestoreDecision === false`
- Guard check #4 fails
- No settings fetch

**Issue B: hasInitialized Flag Logic**

`hasInitialized` is local to useEffect (Line 715), set to `true` at multiple exit points:

- Line 730: Sign-out during init
- Line 741: Normal sign-out
- Line 777: No modal case
- Line 783: Non-premium
- Line 795: Error case
- Line 802: Anonymous

**But NOT set** when modal is shown (Line 772). This means:

- If user quickly navigates to SavedSettings page while modal is showing
- `loadedRestoreDecision` still false
- Guard fails

**Issue C: Entitlements Timing**

Guard check #3 (Line 61 in SavedSettingsAccordion, Line 46 in SavedSettings):

```typescript
const entitlementsAttempted = state.subscription !== undefined;
```

Initially `state.subscription === undefined`, so this fails until:

```typescript
// AppContext Line 757-758
dispatch({ type: 'SET_SUBSCRIPTION', payload: entSub });
dispatch({ type: 'SET_TRIAL', payload: trial });
setSessionTag('ENTITLED');  // Line 759
```

These happen **atomically** in the same auth flow, so timing should be okay. However, if entitlements fetch fails:

```typescript
// Lines 790-793
setSessionTag('ENTITLED');
dispatch({ type: 'SET_SUBSCRIPTION', payload: null });  // ✓ Defined (not undefined)
dispatch({ type: 'SET_TRIAL', payload: null });
```

So entitlements check passes even on failure.

---

## 2. Affected Files & Code Locations

### 2.1 AppContext.tsx

- **Line 73**: SessionTag type definition (missing 'SIGNED_IN')
- **Line 759**: Sets to 'ENTITLED' for premium users
- **Line 790**: Sets to 'ENTITLED' on error
- **Line 727, 738, 799**: Sets to 'ANON' for anonymous

### 2.2 SavedSettingsAccordion.tsx

- **Lines 54-102**: useEffect with 5-point guard
- **Line 59**: `sessionTag !== 'SIGNED_IN'` check ❌
- **Line 301**: `await loadSettings()` direct call (workaround)

### 2.3 SavedSettings.tsx (Full page component)

- **Lines 39-87**: useEffect with identical 5-point guard
- **Line 44**: `sessionTag !== 'SIGNED_IN'` check ❌

### 2.4 Other Components (Not Affected)

- Account.tsx: No 'SIGNED_IN' checks found ✓
- TableManager.tsx: Uses `sessionTag` but no 'SIGNED_IN' literal
- SeatingPlanViewer.tsx: Uses `sessionTag` but no 'SIGNED_IN' literal

---

## 3. Solution Options (Ranked by Risk/Benefit)

### Solution A: Change Guard to Check 'ENTITLED' (RECOMMENDED)

**Changes:**

1. SavedSettingsAccordion.tsx Line 59
2. SavedSettings.tsx Line 44
```typescript
// BEFORE
if (sessionTag !== 'SIGNED_IN' || ...)

// AFTER
if (sessionTag !== 'ENTITLED' || ...)
```


**Pros:**

- Minimal change (2 lines)
- Aligns with existing architecture
- No type system changes
- No breaking changes
- Fixes root cause directly

**Cons:**

- Doesn't address "why was SIGNED_IN used?"
- May indicate other places expecting SIGNED_IN

**Risk**: **Very Low** ✓

**Upside**: **High** - Direct fix

**Downside**: **None** if no other SIGNED_IN references exist

**Effort**: 5 minutes

---

### Solution B: Add 'SIGNED_IN' to SessionTag Union & Use It

**Changes:**

1. AppContext.tsx Line 73: Add 'SIGNED_IN' to type
2. AppContext.tsx Line 759: Change to `setSessionTag('SIGNED_IN')`
3. AppContext.tsx Line 790: Change to `setSessionTag('SIGNED_IN')` (error case)
4. Update all 'ANON' checks if needed
5. SavedSettingsAccordion/SavedSettings stay unchanged
```typescript
// AppContext.tsx Line 73
type SessionTag = 'INITIALIZING' | 'AUTHENTICATING' | 'ANON' | 'SIGNED_IN' | 'ENTITLED' | 'ERROR';

// Line 759 (and 790)
setSessionTag('SIGNED_IN');
```


**Semantic Distinction:**

- `'SIGNED_IN'`: User is authenticated (has valid session)
- `'ENTITLED'`: User's entitlements (subscription/trial) have been loaded
- Could have SIGNED_IN → (fetch entitlements) → ENTITLED flow

**Pros:**

- Makes components work as written
- Clearer semantic separation
- More granular FSM states
- Documents intentionality of checks

**Cons:**

- Larger refactor (5+ locations)
- Changes core FSM
- Requires regression testing across all pages
- May break existing logic that expects 'ENTITLED'
- Unclear if separate SIGNED_IN/ENTITLED states are needed

**Risk**: **Medium-High** ⚠️

**Upside**: **Medium** - Better architecture if we need the distinction

**Downside**: **High** - Potential breakage, unclear if needed

**Effort**: 2-4 hours (testing included)

---

### Solution C: Defensive Multi-State Check

**Changes:**

1. SavedSettingsAccordion.tsx Line 59
2. SavedSettings.tsx Line 44
```typescript
// BEFORE
if (sessionTag !== 'SIGNED_IN' || ...)

// AFTER
if (sessionTag !== 'ENTITLED' && sessionTag !== 'SIGNED_IN' || ...)
```


**Pros:**

- Works now AND if 'SIGNED_IN' is added later
- Very safe
- Minimal change
- Forward-compatible

**Cons:**

- Redundant (SIGNED_IN never set)
- Masks the original bug
- Could confuse future maintainers

**Risk**: **Very Low** ✓

**Upside**: **Medium** - Defensive

**Downside**: **Low** - Slight code smell

**Effort**: 5 minutes

---

### Solution D: Remove sessionTag Check Entirely

**Changes:**

1. SavedSettingsAccordion.tsx Lines 58-68: Remove sessionTag condition
2. SavedSettings.tsx Lines 43-53: Remove sessionTag condition
3. Rely on remaining 4 guards:

   - user?.id
   - entitlementsAttempted
   - loadedRestoreDecision
   - isPremium
```typescript
// BEFORE
if (
  sessionTag !== 'SIGNED_IN' ||  // ❌ Remove
  !user?.id ||
  !entitlementsAttempted ||
  !state.loadedRestoreDecision ||
  !isPremium
) { ... }

// AFTER
if (
  !user?.id ||
  !entitlementsAttempted ||
  !state.loadedRestoreDecision ||
  !isPremium
) { ... }
```


**Rationale:**

- `user?.id` already checks authentication
- `isPremium` already checks entitlements
- `loadedRestoreDecision` checks modal completion
- sessionTag is redundant

**Pros:**

- Removes dependency on FSM state
- Simpler logic
- More robust (fewer dependencies)
- Fixes current bug

**Cons:**

- Loses FSM synchronization
- Could fetch during INITIALIZING if other guards pass
- Less clear "wait for auth to complete" signal
- May cause premature fetches during transitions

**Risk**: **Medium** ⚠️

**Upside**: **Medium** - Simpler

**Downside**: **Medium** - Potential race conditions

**Effort**: 10 minutes

---

### Solution E: Fix Modal Timing (SET_LOADED_RESTORE_DECISION Earlier)

**Changes:**

1. AppContext.tsx Lines 768-778: Always set loadedRestoreDecision
```typescript
// BEFORE (Lines 768-778)
if (data?.guests?.length > 0) {
  setMostRecentState(data);
  setShowRecentModal(true);
  // ❌ Don't set loadedRestoreDecision yet
} else {
  dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
}

// AFTER
if (data?.guests?.length > 0) {
  setMostRecentState(data);
  setShowRecentModal(true);
}
// ✓ Always set, even if modal shown
dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
dispatch({ type: 'SET_READY' });
hasInitialized = true;
```


**Rationale:**

- Modal is for user choice, not a loading gate
- Settings fetch should not block on modal
- loadedRestoreDecision means "we've decided whether to auto-restore"
- User can still choose to restore via modal after settings load

**Pros:**

- Fixes timing issue
- Settings available immediately
- Modal still functional
- More intuitive behavior

**Cons:**

- **DOES NOT FIX** the sessionTag bug
- Only fixes secondary timing issue
- Must combine with Solution A or C

**Risk**: **Low** ✓

**Upside**: **Medium** - Better UX

**Downside**: **None**

**Effort**: 5 minutes

**Note**: This is complementary, not alternative.

---

## 4. Recommended Solution: **A + E Combined**

**Primary Fix (Solution A):**

- Change `sessionTag !== 'SIGNED_IN'` to `sessionTag !== 'ENTITLED'` in both files

**Secondary Fix (Solution E):**

- Set `loadedRestoreDecision` immediately after fetching mostRecentState, regardless of modal

**Total Changes:**

1. SavedSettingsAccordion.tsx Line 59
2. SavedSettings.tsx Line 44
3. AppContext.tsx Lines 768-778 (restructure)

**Why This Combination:**

- Fixes root cause (sessionTag)
- Fixes timing race (modal)
- Minimal risk
- No breaking changes
- Clear semantics
- Fast to implement

**Implementation Steps:**

1. Change sessionTag checks (2 files)
2. Restructure modal logic (1 file, 10 lines)
3. Test: Login → Navigate to SavedSettings → Verify list appears
4. Test: Login → Modal appears → Click Keep Current → Navigate to SavedSettings → Verify list appears
5. Test: Save new setting → Verify refresh works

---

## 5. Alternative Considerations

### 5.1 Should We Rename 'ENTITLED' to 'SIGNED_IN'?

**Analysis:**

- 'ENTITLED' is semantically correct (entitlements loaded)
- 'SIGNED_IN' is more intuitive
- But changing would require updating all references
- Not worth the risk for naming preference

**Decision:** Keep 'ENTITLED'

### 5.2 Should We Have Both SIGNED_IN and ENTITLED?

**Use Case:**

```
SIGNED_IN: User authenticated, but entitlements not yet loaded
  ↓ (async fetch)
ENTITLED: Entitlements loaded (subscription, trial)
```

**Pros:**

- More granular FSM
- Can show "Loading subscription..." state
- Prevents premature premium checks

**Cons:**

- Added complexity
- Current code doesn't need it
- Entitlements fetch is fast (<500ms)
- YAGNI (You Aren't Gonna Need It)

**Decision:** Not needed for current use case

### 5.3 Should Guards Be Unified in a Hook?

**Proposal:**

```typescript
// hooks/usePremiumGuard.ts
export function usePremiumGuard() {
  const { state, sessionTag } = useApp();
  const isPremium = useMemo(...);
  
  return (
    sessionTag === 'ENTITLED' &&
    state.user?.id &&
    state.subscription !== undefined &&
    state.loadedRestoreDecision &&
    isPremium
  );
}

// Usage
if (!usePremiumGuard()) return;
```

**Pros:**

- Single source of truth
- Consistent across components
- Easier to update

**Cons:**

- New abstraction
- Not a fix, just refactoring
- Overkill for 2 locations

**Decision:** Not needed, but document pattern

---

## 6. Testing Strategy

### 6.1 Manual Test Cases

**Test 1: Fresh Premium Login**

1. Clear localStorage + Supabase data
2. Sign in as premium user
3. Navigate to any page
4. Click SavedSettings accordion
5. ✓ Should see empty list (not blocked)

**Test 2: Premium Login with Saved Settings**

1. Ensure user has 3+ saved settings in DB
2. Sign in
3. Navigate to SavedSettings page
4. ✓ Should see list of 3+ settings immediately

**Test 3: Premium Login with Modal**

1. Ensure user has mostRecentState with guests
2. Sign in
3. Modal appears
4. Click "Keep Current"
5. Navigate to SavedSettings
6. ✓ Should see saved settings list

**Test 4: Save Triggers Refresh**

1. Login, navigate to SavedSettings
2. Make changes
3. Click "Save Current Settings"
4. ✓ New setting appears in list
5. ✓ Existing settings still visible

**Test 5: Accordion on Multiple Pages**

1. Login
2. Visit GuestManager page → expand accordion → ✓ Settings visible
3. Visit TableManager page → expand accordion → ✓ Settings visible
4. Visit SeatingPlanViewer page → expand accordion → ✓ Settings visible

### 6.2 Edge Cases

**Edge 1: Entitlements Fetch Fails**

- Mock Supabase error
- ✓ Should still set `subscription: null` (not undefined)
- ✓ Guard should evaluate isPremium = false
- ✓ No settings fetch attempted

**Edge 2: User Downgrades During Session**

- Login as premium
- Settings visible
- Admin downgrades subscription
- Refresh page
- ✓ Settings accordion hidden

**Edge 3: Modal Dismissal Race**

- Modal appears
- Quickly click Keep Current
- Immediately navigate to SavedSettings
- ✓ Settings should load

### 6.3 Regression Risks

**Risk 1: Other sessionTag Checks**

- Grep for `sessionTag` across codebase
- Verify no other components expect 'SIGNED_IN'
- ✓ Verified: Only SavedSettings components affected

**Risk 2: FSM State Transitions**

- Verify ANON → ENTITLED → (no regression)
- Verify sign-out → ANON works
- Verify error case → ENTITLED works

**Risk 3: loadedRestoreDecision Early Set**

- Verify modal still functions
- Verify "Restore Recent" button works
- Verify "Keep Current" button works
- Verify auto-generation doesn't trigger during modal

---

## 7. Long-Term Recommendations

### 7.1 FSM State Documentation

Create `docs/SESSION_FSM.md` with:

- State diagram
- Transition triggers
- Guards per state
- Component dependencies

### 7.2 Type-Safe SessionTag Checks

```typescript
// utils/sessionGuards.ts
export const SessionGuards = {
  isAuthenticated: (tag: SessionTag) => 
    tag === 'ENTITLED' || tag === 'ANON',
  isPremiumSession: (tag: SessionTag) => 
    tag === 'ENTITLED',
  isReady: (tag: SessionTag) => 
    tag !== 'INITIALIZING' && tag !== 'AUTHENTICATING'
} as const;

// Usage
if (!SessionGuards.isPremiumSession(sessionTag)) return;
```

### 7.3 Integration Test

Playwright test for saved settings flow:

```typescript
test('premium user sees saved settings on login', async ({ page }) => {
  await loginAsPremium(page);
  await page.goto('/saved-settings');
  await expect(page.locator('[data-testid=settings-list]')).toBeVisible();
  await expect(page.locator('.setting-item')).toHaveCount(3);
});
```

---

## 8. Impact Assessment

### 8.1 User Impact (Current Bug)

- **Severity**: High (blocks core premium feature)
- **Frequency**: 100% of premium users on first login
- **Workaround**: Save new setting (non-obvious)
- **Data Loss**: None (settings exist in DB)

### 8.2 Fix Impact (Solution A+E)

- **Breaking Changes**: None
- **Performance**: No change (same fetch logic)
- **UX Improvement**: Settings visible immediately
- **Risk of New Bugs**: Very low (<5%)

### 8.3 Deployment Strategy

1. Deploy during low-traffic window
2. Monitor Sentry for new sessionTag errors
3. Monitor Supabase for saved_settings query volume
4. Check user reports for 24h
5. If issues: Immediate rollback (<5min)

---

## 9. Code Diffs (Exact Changes)

### File 1: src/components/SavedSettingsAccordion.tsx

```typescript
// Line 59 BEFORE
if (sessionTag !== 'SIGNED_IN' ||

// Line 59 AFTER
if (sessionTag !== 'ENTITLED' ||
```

### File 2: src/pages/SavedSettings.tsx

```typescript
// Line 44 BEFORE
if (sessionTag !== 'SIGNED_IN' ||

// Line 44 AFTER
if (sessionTag !== 'ENTITLED' ||
```

### File 3: src/context/AppContext.tsx

```typescript
// Lines 768-778 BEFORE
if (isMountedRef.current && data?.guests?.length && data.guests.length > 0) {
  console.log('[Auth] Setting most recent state and showing modal');
  setMostRecentState(data);
  setShowRecentModal(true);
  // Don't set loadedRestoreDecision yet (modal will do it)
} else {
  console.log('[Auth] No recent state or no guests, skipping modal');
  dispatch({ type: 'SET_LOADED_RESTORE_DECISION', payload: true });
  dispatch({ type: 'SET_READY' });
  hasInitialized = true;
}

// Lines 768-781 AFTER
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
```

---

## 10. Red Team Vetting Questions

1. **Q:** Could this break anonymous users?  

**A:** No. Anonymous users have `sessionTag === 'ANON'`, which still fails `!== 'ENTITLED'` check. Guard #5 (`isPremium`) also blocks them.

2. **Q:** What if subscription loads after component mounts?  

**A:** Guard #3 (`entitlementsAttempted`) waits for `subscription !== undefined`. useEffect dependency array includes `state.subscription`, so it re-runs when loaded.

3. **Q:** Could this cause duplicate fetches?  

**A:** No. `inFlightFetch.current` guard (line 70-71) prevents concurrent requests.

4. **Q:** What about saved_settings RLS policies?  

**A:** RLS enforces `user_id = auth.uid()`. Even if logic bugs, DB prevents unauthorized access.

5. **Q:** Why not use a single AUTHENTICATED state?  

**A:** Architecture already committed to ANON/ENTITLED distinction. Refactoring not justified by this bug fix.

6. **Q:** Could loadedRestoreDecision early-set break restore modal?  

**A:** No. Modal still shows and functions. Flag only means "we've checked for restore data", not "user made choice".

7. **Q:** What if user is on SavedSettings page during sign-out?  

**A:** Sign-out sets `sessionTag = 'ANON'`, triggers useEffect, guard fails, settings clear. Expected behavior.

8. **Q:** Could this expose settings during AUTHENTICATING transition?  

**A:** No. Guard checks `sessionTag !== 'ENTITLED'`, which includes AUTHENTICATING. Must reach ENTITLED first.

---

## 11. Appendix: Complete Guard Logic

**Current (Broken):**

```typescript
if (
  sessionTag !== 'SIGNED_IN' ||        // ❌ Always true ('ENTITLED' !== 'SIGNED_IN')
  !user?.id ||                          // ✓ Waits for user
  !entitlementsAttempted ||             // ✓ Waits for subscription fetch attempt
  !state.loadedRestoreDecision ||       // ⚠️  Blocked by modal
  !isPremium                            // ✓ Checks subscription/trial validity
) {
  setSettings([]);
  setLoading(false);
  return;
}
```

**Result:** Early return, no fetch.

**Fixed (Solution A+E):**

```typescript
if (
  sessionTag !== 'ENTITLED' ||          // ✓ Correctly checks FSM state
  !user?.id ||                          // ✓ Waits for user
  !entitlementsAttempted ||             // ✓ Waits for subscription fetch attempt
  !state.loadedRestoreDecision ||       // ✓ Set immediately after mostRecentState check
  !isPremium                            // ✓ Checks subscription/trial validity
) {
  setSettings([]);
  setLoading(false);
  return;
}
```

**Result:** All guards pass, settings fetch.

---

## 12. Sign-Off Checklist

Before deploying:

- [ ] All 3 files changed
- [ ] TypeScript compiles (`tsc --noEmit`)
- [ ] No linter errors
- [ ] Manual test: Premium login → SavedSettings visible
- [ ] Manual test: Save new setting → List refreshes
- [ ] Manual test: Modal → Keep Current → Settings visible
- [ ] Git tag: `v[MMDD]at[HHMM]pm-fix-saved-settings-guard`
- [ ] Deployment log entry with rollback instructions
- [ ] Monitor Sentry for 24h post-deploy

### To-dos

- [ ] Apply PATCH W1: Replace SET_SEATING_PLANS case body in AppContext.tsx with conditional warning logic
- [ ] Apply PATCH W2: Add seatingPlans.length === 0 guard to warning banner condition in SeatingPlanViewer.tsx
- [ ] Run tsc --noEmit to verify type safety and resolve any errors minimally
- [ ] Verify warnings clear on successful generation and UI guard prevents display when plans exist