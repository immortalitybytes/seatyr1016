# Seatyr - Project Status & Active Issues

**Last Updated:** October 20, 2025  
**Current Version:** `v1019at331am`  
**Production URL:** https://seatyr.com  
**Netlify Site:** `seatyroctober`

---

## 🎯 CURRENT STATUS

### ✅ What's Working
- **Premium table renaming** - Can rename tables
- **Seating capacity changes** - Can adjust seats per table
- **Basic guest management** - Add/remove/edit guests
- **Constraint management** - Add must/cannot constraints
- **Partial reload functionality** - Works on some routes for premium users

### 🔴 Critical Issues (Priority 0)
1. **Route-Dependent Reload Failures** - Page reload behavior varies by route and user type
2. **Anonymous User Data Loss** - Data lost on reload for unsigned-in users
3. **Orphaned Data Cleanup Incomplete** - Database migration needs schema verification

### 🟡 High Priority Issues (Priority 1)
4. **Multi-Table Assignment UI** - Cannot assign guest to multiple tables (e.g., "1, 3, 5")
5. **Premium Table Name Assignments** - Cannot use table names in assignments
6. **Star Emoji Display** - Adjacent-pairing star emojis not showing in constraint grid

---

## 🚨 CRITICAL: Route-Dependent Reload Behavior

### Anonymous Users (Unsigned-In)
| Route | Reload Behavior | Navigation Behavior |
|-------|----------------|-------------------|
| **Main (Guests)** | ❌ BLANKS/RESETS (perpetual spinner) | ❌ Data lost |
| **Tables** | ❌ Broken | ❌ Data lost |
| **Your Rules** | ❌ Broken | ❌ Data lost |
| **Seating** | 🟡 Stable reload | ❌ Data lost on nav |

**Summary:** Anonymous reload is critically broken. Even Seating page (which reloads) loses data when navigating to other pages.

### Premium Users (Signed-In)
| Route | Reload Behavior | Navigation Behavior |
|-------|----------------|-------------------|
| **Guests (main)** | ✅ STABLE | ✅ Works |
| **Tables** | ❌ BROKEN | ? |
| **Your Rules** | ✅ STABLE | ✅ Works |
| **Seating** | ❌ BROKEN | ? |

**Summary:** Premium has partial functionality. Main and Rules pages work, Tables and Seating do not.

### Technical Analysis
**Root Causes Identified:**
1. **Async Init Not Completing** - Session check fails silently, sessionTag stays 'INITIALIZING'
2. **Data Not Restored Before Route Renders** - State restore happens after component tries to read it
3. **Navigation Clears State** - State cleared during route changes

**Files Affected:**
- `src/context/AppContext.tsx` - Session initialization, state restoration
- `src/pages/SeatingPlanViewer.tsx` - Requires seatingPlans data
- `src/pages/TableManager.tsx` - Requires tables data

---

## 🗄️ DATABASE MIGRATION STATUS

### Phase A: Database Hardening
**File:** `supabase/migrations/phase_a_database_hardening_v3_robust.sql`

**Completed:**
- ✅ Deduplication (A1) - Removed duplicate records from all tables
- ✅ Unique constraints (A2) - Added to prevent future duplicates
- ✅ Performance indexes (A3) - Created user_id indexes for all tables
- ✅ RLS policies (A4) - Enabled and verified for all user tables

**Incomplete:**
- ❌ **Orphaned data cleanup (A5)** - BLOCKED on schema verification

### Current Issue: Schema Mismatch
**Error:** `column rss.id does not exist`

**Discovered:** Both `recent_session_states` and `recent_session_settings` tables **DO** have `id` columns (UUID primary keys)

**Next Steps:**
1. Verify actual column names in migration script (line 28 area)
2. Run schema discovery queries to confirm table structure
3. Update cleanup queries to use correct column references
4. Execute cleanup safely using `BEGIN; ... ROLLBACK;` then `COMMIT;`

**Schema Discovery Queries:**
```sql
-- Verify table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name IN ('recent_session_states', 'recent_session_settings')
ORDER BY table_name, ordinal_position;
```

---

## 🐛 KNOWN ISSUES

### 1. Multi-Table Assignment UI (P1)
**Issue:** Users cannot assign a guest to multiple tables as options

**Expected Behavior:**
- User types: "1, 3, 5"
- Guest can be seated at table 1, 3, OR 5
- Algorithm chooses best option

**Current State:**
- Algorithm supports multi-table assignments ✓
- `normalizeAssignmentInputToIdsWithWarnings` works correctly ✓
- UI input field rejects user keystrokes ✗

**Root Cause:** React controlled input feedback loop

**Solution Implemented (but needs verification):**
```typescript
// Local state for raw input
const [rawAssignmentInput, setRawAssignmentInput] = useState<Record<string, string>>({});

<input 
  value={rawAssignmentInput[guest.id] ?? assignedTables}
  onChange={e => setRawAssignmentInput(prev => ({ ...prev, [guest.id]: e.target.value }))}
  onBlur={e => handleUpdateAssignment(guest.id, e.target.value)}
/>
```

**Files:** `src/pages/TableManager.tsx`

---

### 2. Premium Table Name Assignments (P1)
**Issue:** Premium users cannot use table names in assignments

**Expected Behavior:**
- User renames table 1 to "Head Table"
- User can assign guest to "Head Table" (not just "1")
- Input accepts: "Head Table, VIP Table, 5"

**Current State:**
- Table naming works ✓
- Assignment by name blocked by input UI ✗

**Root Cause:** Same as multi-table assignment issue

**Files:** `src/pages/TableManager.tsx`, `src/utils/assignments.ts`

---

### 3. Star Emoji Display (P1)
**Issue:** Star emojis (⭐) not displaying for adjacent-pairing constraints

**Expected Behavior:**
- Double-click two guests creates MUST + ADJACENT constraint
- Grid shows "⭐ & ⭐" in intersecting cells
- Headers show star emoji for adjacent guests

**Current State:**
- Logic appears correct
- Star emojis not rendering

**Attempted Fixes:**
- Tried different color schemes
- Tried copying from old codebases
- All attempts failed

**Files:** `src/pages/ConstraintManager.tsx`

---

## 📁 FILE STRUCTURE

### Core Application Files
- `src/App.tsx` - Main application component
- `src/context/AppContext.tsx` - **CRITICAL** - Single Source of Truth (SSOT) state management
- `src/main.tsx` - Application entry point

### Page Components
- `src/pages/GuestManager.tsx` - Guest list and management
- `src/pages/TableManager.tsx` - Table configuration and assignments
- `src/pages/ConstraintManager.tsx` - Must/cannot/adjacent constraints
- `src/pages/SeatingPlanViewer.tsx` - Generated seating plan display
- `src/pages/SavedSettings.tsx` - Premium saved settings management
- `src/pages/Account.tsx` - User account and subscription

### Critical Utilities
- `src/utils/seatingAlgorithm.ts` - Algorithm adapter (prepares data for engine)
- `src/utils/seatingAlgorithm.engine.ts` - Core seating algorithm logic
- `src/utils/assignments.ts` - **normalizeAssignmentInputToIdsWithWarnings** function
- `src/utils/premium.ts` - Mode detection and feature gating
- `src/lib/mostRecentState.ts` - Premium user state persistence

### Database
- `supabase/migrations/phase_a_database_hardening_v3_robust.sql` - **ACTIVE** migration file

---

## 🔧 RECOMMENDED NEXT STEPS

### Immediate (Do First)
1. **Fix Database Migration**
   - Verify column names in migration script
   - Complete orphaned data cleanup (A5)
   - Confirm all Phase A steps complete

2. **Diagnose Route-Dependent Reload**
   - Add comprehensive logging to AppContext session initialization
   - Test each route individually
   - Identify exact failure points

### High Priority (Do Next)
3. **Fix Multi-Table Assignment UI**
   - Verify local state solution is deployed
   - Test input accepts commas and letters
   - Verify assignment saves correctly

4. **Fix Anonymous Data Persistence**
   - Ensure localStorage saves before reload
   - Prevent premature RESET_APP_STATE calls
   - Test anonymous workflow end-to-end

### Medium Priority (After Above)
5. **Fix Star Emoji Display**
   - Debug constraint grid rendering
   - Verify isAdjacent logic
   - Test with actual adjacent constraints

6. **Improve Error Handling**
   - Add user-facing error messages
   - Improve loading states
   - Add timeout handling

---

## 🧪 TESTING CHECKLIST

Before considering any fix complete:

### Anonymous Users
- [ ] Add guests → Data persists
- [ ] Reload main page → Data persists
- [ ] Navigate between pages → Data persists
- [ ] Add constraints → Data persists on reload
- [ ] Multi-table assignment "1, 3, 5" → Works

### Premium Users
- [ ] Sign in → Premium badge shows
- [ ] Rename table → Name persists
- [ ] Reload main page → Data auto-restores
- [ ] Reload Seating page → No blank screen
- [ ] Multi-table assignment by name → Works
- [ ] Save settings → Load on next session

### Constraints
- [ ] MUST constraint → Enforced in seating plan
- [ ] CANNOT constraint → Enforced in seating plan
- [ ] Adjacent pairing → Star emoji shows in grid
- [ ] Complex chains → Work correctly

---

## 📊 VERSION COMPARISON

| Version | Date | Status | Key Changes |
|---------|------|--------|-------------|
| v1019at331am | Oct 19, 3:31 AM | **CURRENT** | Route-dependent reload issues |
| v1019at230am | Oct 19, 2:30 AM | Reverted | Blank screen on reload |
| v1019at1224am | Oct 19, 12:24 AM | Stable | Table naming/capacity work |
| v1015at230am | Oct 15, 2:30 AM | Stable baseline | Pre-reload fixes |

---

## 🚀 DEPLOYMENT INFO

**Production:**
- URL: https://seatyr.com
- Netlify Site: `seatyroctober`
- Deploy ID: `68f493027f664790b5b55dc1`

**Build Status:** ✅ Passing  
**Lint Status:** ✅ Clean  
**Bundle Size:** 424.86 kB (gzipped: 113.95 kB)

---

## 📞 SUPPORT & DEBUGGING

### Console Logging
The application includes comprehensive console logging:
- `[Init]` - Session initialization
- `[Auth]` - Authentication events
- `[Session Restore]` - State restoration
- `[Anonymous Persist]` - LocalStorage saves
- `[Assignment Debug]` - Assignment processing
- `[Group Debug]` - Constraint grouping

### Common Error Patterns
1. **Perpetual spinner** → Session tag stuck at 'INITIALIZING'
2. **Blank screen** → Route rendering before data ready
3. **Data loss** → Premature RESET_APP_STATE dispatch
4. **403/406 errors** → RLS policies or missing indexes

---

## 📝 NOTES FOR FUTURE DEVELOPERS

### Architecture Decisions
- **SSOT Pattern:** All state in AppContext, accessed via useApp() hook
- **FSM for Auth:** Finite State Machine manages auth/entitlement states
- **ETag Autosave:** Prevents overwrite conflicts for premium users
- **Mode-Based Feature Gating:** `mode === 'premium'` for all checks

### Critical Code Sections
- `AppContext.tsx:265-300` - Initial session check (FRAGILE)
- `AppContext.tsx:305-353` - Auth state change handler (FRAGILE)
- `AppContext.tsx:411-428` - Anonymous persistence (TIMING SENSITIVE)
- `TableManager.tsx:270-290` - Assignment handling (UI ISSUE)
- `seatingAlgorithm.engine.ts:405` - Assignment parsing (CRITICAL)

### Known Gotchas
1. **Don't return null from AppProvider** - Causes blank screen
2. **RESET_APP_STATE only on explicit sign out** - Not on reload
3. **Use local state for input editing** - Prevents feedback loops
4. **Mode detection must be consistent** - Always use `mode === 'premium'`

---

*This document tracks the current state of the Seatyr project. For historical information, see VERSION-HISTORY.md*

