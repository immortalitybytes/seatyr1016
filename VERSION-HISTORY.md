# Seatyr - Version History & Resolved Issues

**Document Purpose:** Historical record of version milestones, resolved issues, and lessons learned

---

## 📚 VERSION TIMELINE

### Nov20at4am (November 20, 2024, 4:00 AM) - CURRENT
**Status:** Version Verified and Guest/Seats Count Calculations Fixed  
**Tag:** `Nov20at4am`

**Working:**
- ✅ Version number verified (Preview Version 0.983)
- ✅ Guest count now correctly shows total guests from state.guests
- ✅ Seats count now correctly shows plan-specific table capacities
- ✅ Display layout correctly positioned (left-justified count, right-justified buttons)

**Key Changes:**
- Fixed `numberOfGuests` calculation to sum all guest.count values (not just assigned seats)
- Fixed `numberOfSeats` calculation to use plan.tables capacities (not state.tables)
- Updated planMetrics dependencies to include state.guests and capacityById

**Files Modified:**
- `src/pages/SeatingPlanViewer.tsx` - Fixed planMetrics calculation

---

### Nov22at321am (November 22, 2024, 3:21 AM)
**Status:** Table Renumbering Feature Complete - All Critical Fixes Implemented  
**Tag:** `Nov22at321am`

**Working:**
- ✅ Table deletion with proper cleanup (ghost locks removed)
- ✅ Table renumbering feature (seems to work)
- ✅ Renumber modal with premium note
- ✅ Import/load pruning (prevents corrupt saved data)
- ✅ Adapter guard (defense-in-depth for stale locks)
- ✅ Type coercion for table IDs (prevents silent failures)
- ✅ All existing functionality preserved

**Key Changes:**
- Added `pruneInvalidReferences` helper for consistent cleanup
- Fixed `REMOVE_TABLE` with type coercion and pruning
- Applied pruning to import/load cases
- Added `RENUMBER_TABLES` reducer case with ID remapping
- Added adapter guard in seatingAlgorithm.ts
- Added renumber modal UI in TableManager.tsx

**Files Modified:**
- `src/context/AppContext.tsx` - Pruning helper, REMOVE_TABLE fix, RENUMBER_TABLES case, import pruning
- `src/utils/seatingAlgorithm.ts` - Adapter guard
- `src/pages/TableManager.tsx` - Renumber modal

---

### Nov21at438pm (November 21, 2024, 4:38 PM)
**Status:** Saved Settings Fixes Implemented - Known Issue with Table Deletion  
**Tag:** `Nov21at438pm`

**Working:**
- ✅ Preserve seating plans on load (complete fix with all 3 fields)
- ✅ Remove plan-clearing dispatches in UI layer
- ✅ Always use incoming tables (prevent parameter bleeding)
- ✅ Support multi-word table names in assignments
- ✅ Seating plans appear immediately after loading
- ✅ Current plan index preserved (user stays on same plan)
- ✅ No regeneration when plans are loaded

**Known Issues:**
- 🟡 Problematic when tables are deleted (saved settings may reference deleted tables)

**Key Changes:**
- Added `hasIncomingPlans` check to preserve seating plans, index, and regeneration flag
- Removed plan-clearing dispatches from SavedSettings.tsx
- Changed table loading to always use incoming tables (ignore userSetTables flag)
- Changed tokenizer regex to support multi-word table names

**Files Modified:**
- `src/context/AppContext.tsx` - Seating plans preservation and table loading fixes
- `src/pages/SavedSettings.tsx` - Removed plan-clearing dispatches
- `src/utils/assignments.ts` - Multi-word table name parsing fix

---

### Nov20at1020pm (November 20, 2024, 10:20 PM)
**Status:** Quite Good - Constraint Inputs Fixed, Saved Settings Issues Remain  
**Tag:** `Nov20at1020pm`

**Working:**
- ✅ Normalized name lookup for MUST/CANNOT chips (case/spacing tolerant)
- ✅ Anonymous data persistence fix (prevents spurious SIGNED_OUT wipe)
- ✅ Premium-only adjacency gating (prevents corruption)
- ✅ Dev server port 5173 configuration
- ✅ Constraint input fixes complete

**Known Issues:**
- 🟡 Saved Settings do not save ALL possible settings (missing seating plans batch)
- 🟡 Saved Settings parameter bleeding between settings
- 🟡 Seating plan does not auto-load after loading saved setting
- 🟡 Cannot save settings with new parameter changes

**Key Changes:**
- Added normalized name matching (`squash()` function) to TableManager.tsx
- Enhanced SIGNED_OUT handler with anonymous data preservation guard
- Added Premium-only gate for adjacency features in ConstraintManager.tsx
- Configured vite.config.ts to use explicit port 5173

**Files Modified:**
- `src/pages/TableManager.tsx` - Normalized name matching
- `src/context/AppContext.tsx` - Anonymous data preservation
- `src/pages/ConstraintManager.tsx` - Premium-only adjacency gating
- `vite.config.ts` - Port configuration

---

### Nov20at155pm (November 20, 2024, 1:55 PM)
**Status:** Partial Implementation - Table Locking Works, Must Sit With Works, Cannot Sit With In Progress  
**Tag:** `Nov20at155pm`

**Working:**
- ✅ Table locking with correct emoji semantics (⛓️‍💥 unlocked, 🔒 locked)
- ✅ Visual signifiers for locked tables (green borders and background)
- ✅ Visual signifiers for locked-assignment guests (bullets and green text)
- ✅ Must Sit With constraint input (chips persist correctly)
- ✅ SET_CONSTRAINT reducer case implemented
- ✅ Blur race condition fix for autocomplete

**Known Issues:**
- 🟡 Cannot Sit With constraint input not working yet
- ⚠️ Dev server may run on ports 5174/5175 instead of 5173

**Key Changes:**
- Added SET_CONSTRAINT reducer case to AppContext.tsx
- Fixed lock emoji toggle to use Broken Chain (⛓️‍💥) for unlocked state
- Added table-level visual signifiers (thick green borders)
- Added guest-level visual signifiers with TypeScript-safe detection
- Implemented no-color-leak rendering (non-locked guests stay standard color)
- Added preventDefault to autocomplete suggestion clicks

**Files Modified:**
- `src/context/AppContext.tsx` - SET_CONSTRAINT reducer case
- `src/pages/TableManager.tsx` - preventDefault fix
- `src/pages/SeatingPlanViewer.tsx` - Lock emoji and visual signifiers

---

### v1019at331am (October 19, 2025, 3:31 AM)
**Status:** Deployed, Route-dependent reload issues  
**Git Tag:** `v1019at331am`  
**Deploy ID:** `68f493027f664790b5b55dc1`

**Working:**
- ✅ Premium table renaming
- ✅ Seating capacity changes
- ✅ Basic guest management
- ✅ Constraint management

**Critical Issues:**
- ❌ Route-dependent reload (anonymous main page blanks)
- ❌ Data loss on navigation (anonymous users)
- ❌ Perpetual spinner on some routes
- ❌ Multi-table assignments UI blocked

**Key Changes:**
- Added comprehensive error handling to session initialization
- Improved logging for debugging
- Fixed RESET timing to distinguish sign out from reload
- Replaced invisible render gate with loading spinner

---

### v1019at230am (October 19, 2025, 2:30 AM) - REVERTED
**Status:** Reverted due to blank screen regression  
**Git Tag:** `v1019at230am`  
**Deploy ID:** `68f484e0e0e1f26e4e77a60a`

**Why Reverted:**
- ❌ Reload blanked screen completely
- ❌ Site unusable after page refresh
- ❌ hasRestoredRef race condition caused worse bug

**What Was Attempted:**
- Fixed input rejection with local state
- Fixed reload data loss with RESET timing
- Added debug logging

**Lesson Learned:** Never deploy fixes that cause worse regressions. Always test reload behavior in browser before deployment.

---

### v1019at1224am (October 19, 2025, 12:24 AM) - STABLE
**Status:** Stable with known limitations  
**Git Tag:** `v1019at1224am`

**Fixed:**
- ✅ Table seating capacity changes
- ✅ Table naming for premium users
- ✅ SSOT mode detection consistency
- ✅ Mode-aware UI placeholders

**Still Broken:**
- ❌ Multi-table assignments
- ❌ Reload data loss
- ❌ Page navigation data loss

**Key Changes:**
- Added reducer actions: ADD_TABLE, REMOVE_TABLE, UPDATE_TABLE, SET_USER_SET_TABLES
- Updated all components to use `mode === 'premium'` consistently
- Fixed premium status detection in multiple files

---

### v1019at1206am (October 19, 2025, 12:06 AM)
**Status:** Partial fixes, significant remaining issues  
**Git Tag:** `v1019at1206am-fixes`

**Issues:**
- ❌ Unsigned-in can't add multi-tables
- ❌ Signed-in can't name tables
- ❌ Signed-in can't change seating capacity
- ❌ Seating count not always current
- ❌ Reload broken

---

### v1015at230am (October 15, 2025, 2:30 AM) - STABLE BASELINE
**Status:** Last known fully stable version  
**Git Tag:** v1015at230am  
**Commit:** `882cee5`

**What Worked:**
- ✅ Premium status detection
- ✅ Guest count calculations
- ✅ Table assignments
- ✅ Unsigned user data persistence
- ✅ All browser compatibility (Safari, Chrome, DuckDuckGo)
- ✅ No HTTP 406 errors

**Known Issues:**
- ⚠️ Premium users may lose data on quick reload (need 2 second wait)
- ⚠️ 80+ guest saved settings may require reload

**Intentionally Excluded:**
- RLS migration (caused regressions)
- Advanced data persistence (too complex)

**Recommendations:**
- This is a stable baseline - don't break it
- Apply RLS migration separately with thorough testing
- Use minimal changes for premium persistence fixes

---

### v1015at152am (October 15, 2025, 1:52 AM) - PARTIAL SUCCESS
**Status:** Partial improvements, critical issues remain  

**Resolved:**
- ✅ RLS migration applied successfully
- ✅ No more HTTP 406 errors
- ✅ Premium status detection more reliable
- ✅ Race conditions fixed in React state

**Critical Issues Persisting:**
- ❌ Data loss on reload (CRITICAL)
- ❌ Inconsistent premium settings loading
- ❌ Multi-table assignment not working

**Root Cause Analysis:**
- Database layer fixed (RLS policies, indexes)
- Application layer partially fixed (state management improved)
- User experience layer broken (data loss makes app unusable)

---

## 🔄 RESOLVED ISSUES (Historical)

### Fixed: PostCSS/Tailwind Build Failures
**Date:** October 19, 2025  
**Symptoms:** Build failed with "Cannot find module 'tailwindcss'"  
**Solution:** `rm -rf node_modules package-lock.json && npm install`  
**Status:** ✅ Resolved

---

### Fixed: Wrong Netlify Site Deployments
**Date:** October 19, 2025  
**Symptoms:** Deployments going to `seatyrdeleted` instead of `seatyroctober`  
**Solution:** Verified correct git remote and Netlify configuration  
**Status:** ✅ Resolved - All deployments now go to correct site

---

### Fixed: isPremiumSubscription Function Usage
**Date:** October 19, 2025  
**Symptoms:** Multiple components using legacy function inconsistently  
**Solution:** Updated all components to use `mode === 'premium'` from AppContext  
**Files Modified:**
- `src/pages/TableManager.tsx`
- `src/pages/SeatingPlanViewer.tsx`
- `src/pages/GuestManager.tsx`
- `src/pages/ConstraintManager.tsx`

**Status:** ✅ Resolved

---

### Fixed: Missing Mode-Based Helper Functions
**Date:** October 19, 2025  
**Symptoms:** Build error - "getMaxSavedSettingsLimitByMode is not exported"  
**Solution:** Added backward-compatible wrappers in `src/utils/premium.ts`

```typescript
export function getMaxGuestLimitByMode(mode: Mode): number {
  return mode === 'premium' ? 10000 : 80;
}

export function getMaxSavedSettingsLimitByMode(mode: Mode): number {
  return mode === 'premium' ? 50 : 5;
}
```

**Status:** ✅ Resolved

---

### Fixed: GuestManager Integrity Check Failures
**Date:** October 19, 2025  
**Symptoms:** Pre-commit hook failing on SHA mismatch  
**Solution:** Updated expected SHA values in `scripts/check-gm-integrity.cjs` after legitimate code changes  
**Status:** ✅ Resolved

---

### Fixed: Invisible Render Gate (Blank Screen)
**Date:** October 19, 2025, 2:45 AM  
**Symptoms:** Reload showed blank white screen instead of loading state  
**Solution:** Replaced `return null` with loading spinner component

**Before:**
```typescript
if (sessionTag === 'INITIALIZING' || sessionTag === 'AUTHENTICATING') return null;
```

**After:**
```typescript
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

**Status:** ✅ Resolved - Users now see proper loading feedback

---

### Fixed: Table Naming and Capacity Changes (Premium)
**Date:** October 19, 2025  
**Symptoms:** Premium users couldn't rename tables or change seating capacity  
**Solution:** Added missing reducer actions and fixed premium status detection

**Changes:**
- Added `UPDATE_TABLE` action to reducer
- Fixed `mode === 'premium'` detection
- Updated TableManager to dispatch correct actions

**Status:** ✅ Resolved - Premium features work correctly

---

## ❌ INCORRECT DIAGNOSES (Lessons Learned)

### Wrong: Missing `id` Columns in Session Tables
**Initial Diagnosis:** `recent_session_states` and `recent_session_settings` lacked `id` columns  
**Proposed Solution:** Use PostgreSQL's `ctid` as workaround

**Actual Reality:** Both tables DO have `id` columns (UUID primary keys)

**Why Wrong:** Misinterpreted Supabase error message as schema issue rather than query syntax issue

**Lesson:** Always verify schema with discovery queries before implementing workarounds

---

### Wrong: `expires_at` Column in Trial Subscriptions
**Initial Diagnosis:** `trial_subscriptions` has both `expires_on` and `expires_at` columns  
**Proposed Solution:** Use `COALESCE(expires_on, expires_at)` logic

**Actual Reality:** Only `expires_on` column exists

**Why Wrong:** Assumed naming convention consistency without verification

**Lesson:** Never assume database schema - always verify with queries

---

### Wrong: Assignment Algorithm Rejection
**Initial Diagnosis:** Seating algorithm rejecting multi-table assignments  
**Proposed Solution:** Fix algorithm parsing logic

**Actual Reality:** Algorithm works perfectly - UI prevented user input

**Why Wrong:** Focused on backend instead of frontend UI feedback loop

**Lesson:** Test algorithm in isolation before debugging. Separate UI bugs from logic bugs.

---

## 💡 KEY LESSONS LEARNED

### 1. Schema Verification First
**Principle:** Never assume database schema - always verify with queries

**Example:**
```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'your_table'
ORDER BY ordinal_position;
```

---

### 2. Error Messages Can Be Misleading
**Principle:** Error messages point to symptoms, not root causes

**Example:**
- Error: "column id does not exist"
- Symptom: Query references wrong column name
- NOT: Column actually missing from table

---

### 3. Test Algorithm in Isolation
**Principle:** Separate backend logic bugs from frontend UI bugs

**Example:**
- Multi-table assignments worked in algorithm
- UI was preventing user input
- Testing algorithm in isolation would have revealed this immediately

---

### 4. Gradual Refactoring > Big Bang Changes
**Principle:** Maintain backward compatibility during transitions

**Example:**
```typescript
// Good: Keep old API while introducing new one
export function isPremiumSubscription(sub: any): boolean {
  // Old implementation for backward compatibility
}

export function checkPremiumByMode(mode: Mode): boolean {
  // New SSOT approach
}
```

---

### 5. Never Return Null from Root Provider
**Principle:** Always show loading UI instead of removing component tree

**Example:**
```typescript
// BAD - Causes blank screen
if (isLoading) return null;

// GOOD - Shows loading feedback
if (isLoading) return <LoadingSpinner />;
```

---

### 6. Test Reload Behavior Before Deployment
**Principle:** Browser reload is a critical user workflow that must be tested

**Checklist:**
- [ ] Test on multiple routes
- [ ] Test with anonymous users
- [ ] Test with premium users
- [ ] Test hard refresh (Cmd/Ctrl + Shift + R)
- [ ] Check browser console for errors

---

### 7. Distinguish Sign Out from Reload
**Principle:** Only RESET state on explicit sign out, not on page reload

**Example:**
```typescript
if (event === 'SIGNED_OUT') {
  dispatch({ type: 'RESET_APP_STATE' });
  localStorage.removeItem('seatyr_app_state');
} else if (!session) {
  // Reload - keep data, just restore from localStorage
  const saved = localStorage.getItem('seatyr_app_state');
  if (saved) dispatch({ type: 'IMPORT_STATE', payload: JSON.parse(saved) });
}
```

---

### 8. Uncontrolled Input for Editing, Controlled for Display
**Principle:** Prevent feedback loops in form inputs

**Example:**
```typescript
const [rawInput, setRawInput] = useState({});

<input 
  value={rawInput[id] ?? normalizedValue}  // Raw while editing
  onChange={e => setRawInput(prev => ({ ...prev, [id]: e.target.value }))}
  onBlur={e => {
    normalize(e.target.value);  // Parse on blur
    setRawInput(prev => {
      const { [id]: _, ...rest } = prev;
      return rest;  // Clear raw after save
    });
  }}
/>
```

---

## 📊 REGRESSION ANALYSIS

### Version Comparison: Reload Behavior

| Feature | v1015at230am | v1019at1224am | v1019at230am | v1019at331am |
|---------|--------------|---------------|--------------|--------------|
| Anonymous reload (main) | ✅ Works | ❌ Lost | ❌ Blank | ❌ Spinner |
| Anonymous reload (seating) | ✅ Works | ❌ Lost | ❌ Blank | 🟡 Partial |
| Premium reload (main) | 🟡 Needs 2s wait | ✅ Works | ❌ Blank | ✅ Works |
| Premium reload (seating) | 🟡 Needs 2s wait | ❌ Lost | ❌ Blank | ❌ Spinner |
| Table naming | ✅ Works | ✅ Works | ✅ Works | ✅ Works |
| Table capacity | ✅ Works | ✅ Works | ✅ Works | ✅ Works |
| Multi-table assign | ❌ Broken | ❌ Broken | ❌ Broken | ❌ Broken |

**Trend:** Reload functionality has regressed from v1015at230am baseline.

---

## 🎯 ROLLBACK INSTRUCTIONS

### To Stable Baseline (v1015at230am)
```bash
git checkout v1015at230am
npm run build
netlify deploy --prod
```

**When to Use:** If current version has critical bugs blocking users

---

### To Previous Version (any)
```bash
git checkout [version-tag]
npm run build
netlify deploy --prod
```

**Available Tags:**
- `v1019at331am` (current)
- `v1019at230am` (reverted)
- `v1019at1224am` (stable with issues)
- `v1015at230am` (baseline)

---

## 📝 DEPLOYMENT HISTORY

| Date | Version | Deploy ID | Status | Notes |
|------|---------|-----------|--------|-------|
| Oct 19, 3:31 AM | v1019at331am | 68f493027f664790b5b55dc1 | **CURRENT** | Route-dependent reload |
| Oct 19, 2:45 AM | Fix blank screen | 68f48e79de2571841a2c6dd5 | Deployed | Loading spinner fix |
| Oct 19, 2:30 AM | v1019at230am | 68f484e0e0e1f26e4e77a60a | Reverted | Blank screen regression |
| Oct 19, 12:24 AM | v1019at1224am | a3f269a | Stable | Table features work |
| Oct 15, 2:30 AM | v1015at230am | 882cee5 | **BASELINE** | Last fully stable |

---

## 🔧 TECHNICAL DEBT

### Code Quality
- Multiple version documentation files (this consolidates them)
- Some redundant error handling
- Inconsistent logging patterns
- No automated tests for critical paths

### Architecture
- AppContext session initialization is fragile
- Multiple auth state handlers can race
- Route-specific data requirements not clearly defined
- State restoration timing is unpredictable

### Testing
- No automated tests for critical user workflows
- Manual testing required for each fix
- Edge cases not systematically covered
- No regression test suite

---

## 📞 SUPPORT INFORMATION

### For Debugging
Check browser console for these log patterns:
- `[Init]` - Session initialization
- `[Auth]` - Authentication events
- `[Session Restore]` - State restoration
- `[Anonymous Persist]` - LocalStorage saves
- `[Assignment Debug]` - Assignment processing

### Common Fixes
1. **Perpetual spinner** → Check if sessionTag is stuck at 'INITIALIZING'
2. **Blank screen** → Check if component trying to access undefined state
3. **Data loss** → Check if RESET_APP_STATE fired inappropriately
4. **403/406 errors** → Check RLS policies in Supabase

---

*This document provides historical context for the Seatyr project. For current status and active issues, see PROJECT-STATUS.md*

