# Outstanding Issues, Problems, Concerns, and Unused Files

**Date:** November 20, 2024  
**Last Updated:** November 20, 2024 at 1:55 PM  
**Current Version:** `Nov20at155pm`

---

## 🔴 CRITICAL OUTSTANDING ISSUES

### 1. Cannot Sit With Constraint Input Not Working
**Status:** 🟡 IN PROGRESS  
**Priority:** HIGH  
**First Mentioned:** November 20, 2024 (Version Nov20at155pm)

**Description:**
- On Tables page, Guest Assignments section, "Cannot Sit With" autocomplete appears to work but selected names do not persist
- Autocomplete suggestions appear correctly
- Selection may not persist or function correctly
- Chips may not be added or may disappear after selection

**Expected Behavior:**
- User types in "Cannot Sit With" field
- Autocomplete suggestions appear
- Clicking suggestion adds chip that persists
- Manual entry (typing + Enter) adds chip that persists
- Constraints appear on Constraints page
- Constraints are respected in seating plan generation

**Current State:**
- "Must Sit With" works correctly ✅
- "Cannot Sit With" does not work ❌
- Same `SET_CONSTRAINT` reducer handles both types, so issue may be in UI handling or constraint type detection

**Investigation Needed:**
1. Check if `updateConstraints()` correctly identifies "cannot" type
2. Verify `SET_CONSTRAINT` action payload includes correct `value: 'cannot'`
3. Check if reducer correctly processes "cannot" constraints
4. Verify `getGuestConstraints()` correctly retrieves "cannot" constraints
5. Check if there's a re-render issue clearing "cannot" chips
6. Verify "cannot" constraints are saved to state
7. Check if constraints are filtered out somewhere

**Files Affected:**
- `src/pages/TableManager.tsx` - ConstraintChipsInput component, updateConstraints function
- `src/context/AppContext.tsx` - SET_CONSTRAINT reducer case (may need verification for "cannot" type)
- `src/pages/ConstraintManager.tsx` - May need to verify constraint display

**Related Code:**
- `src/pages/TableManager.tsx` lines 401-430 (updateConstraints function)
- `src/pages/TableManager.tsx` lines 441-454 (getGuestConstraints function)
- `src/context/AppContext.tsx` lines 650-703 (SET_CONSTRAINT reducer case)

---

### 2. Route-Dependent Reload Failures
**Status:** 🔴 CRITICAL  
**Priority:** P0  
**First Mentioned:** October 19, 2025 (Version v1019at331am)

**Description:**
- Page reload behavior varies by route and user type
- Anonymous users experience data loss on reload
- Premium users have partial functionality

**Anonymous Users (Unsigned-In):**
- Main (Guests): ❌ BLANKS/RESETS (perpetual spinner)
- Tables: ❌ Broken
- Your Rules: ❌ Broken
- Seating: 🟡 Stable reload (but data lost on navigation)

**Premium Users (Signed-In):**
- Guests (main): ✅ STABLE
- Tables: ❌ BROKEN
- Your Rules: ✅ STABLE
- Seating: ❌ BROKEN

**Root Causes Identified:**
1. Async Init Not Completing - Session check fails silently, sessionTag stays 'INITIALIZING'
2. Data Not Restored Before Route Renders - State restore happens after component tries to read it
3. Navigation Clears State - State cleared during route changes

**Files Affected:**
- `src/context/AppContext.tsx` - Session initialization, state restoration (lines 265-300, 305-353, 411-428)
- `src/pages/SeatingPlanViewer.tsx` - Requires seatingPlans data
- `src/pages/TableManager.tsx` - Requires tables data
- `src/pages/GuestManager.tsx` - May be affected by state restoration timing

**Related Documentation:**
- `PROJECT-STATUS.md` - Detailed analysis of reload behavior
- `VERSION-HISTORY.md` - Historical context of reload issues

---

### 3. Anonymous User Data Loss
**Status:** 🔴 CRITICAL  
**Priority:** P0  
**First Mentioned:** October 19, 2025 (Version v1019at331am)

**Description:**
- Data lost on reload for unsigned-in users
- Data lost when navigating between pages
- Even Seating page (which reloads) loses data when navigating to other pages

**Files Affected:**
- `src/context/AppContext.tsx` - Anonymous persistence logic (lines 411-428)
- `src/utils/persistence.ts` - localStorage save/load functions
- All page components that depend on state data

---

## 🟡 HIGH PRIORITY ISSUES

### 4. Multi-Table Assignment UI
**Status:** 🟡 HIGH PRIORITY  
**Priority:** P1  
**First Mentioned:** October 19, 2025 (Version v1019at331am)

**Description:**
- Users cannot assign a guest to multiple tables as options (e.g., "1, 3, 5")
- Algorithm supports multi-table assignments ✓
- `normalizeAssignmentInputToIdsWithWarnings` works correctly ✓
- UI input field rejects user keystrokes ✗

**Expected Behavior:**
- User types: "1, 3, 5"
- Guest can be seated at table 1, 3, OR 5
- Algorithm chooses best option

**Root Cause:** React controlled input feedback loop

**Solution Implemented (but needs verification):**
- Local state for raw input (`rawAssignmentInput`)
- Input uses raw state while editing
- Normalizes on blur

**Files Affected:**
- `src/pages/TableManager.tsx` - Assignment input handling (lines 228-262)
- `src/utils/assignments.ts` - Assignment parsing functions

---

### 5. Premium Table Name Assignments
**Status:** 🟡 HIGH PRIORITY  
**Priority:** P1  
**First Mentioned:** October 19, 2025 (Version v1019at331am)

**Description:**
- Premium users cannot use table names in assignments
- Table naming works ✓
- Assignment by name blocked by input UI ✗

**Expected Behavior:**
- User renames table 1 to "Head Table"
- User can assign guest to "Head Table" (not just "1")
- Input accepts: "Head Table, VIP Table, 5"

**Root Cause:** Same as multi-table assignment issue (React controlled input feedback loop)

**Files Affected:**
- `src/pages/TableManager.tsx` - Assignment input handling
- `src/utils/assignments.ts` - Assignment parsing (needs to handle table names)

---

### 6. Star Emoji Display for Adjacent Pairing
**Status:** 🟡 HIGH PRIORITY  
**Priority:** P1  
**First Mentioned:** October 19, 2025 (Version v1019at331am)

**Description:**
- Star emojis (⭐) not displaying for adjacent-pairing constraints
- Logic appears correct
- Star emojis not rendering

**Expected Behavior:**
- Double-click two guests creates MUST + ADJACENT constraint
- Grid shows "⭐ & ⭐" in intersecting cells
- Headers show star emoji for adjacent guests

**Attempted Fixes:**
- Tried different color schemes
- Tried copying from old codebases
- All attempts failed

**Files Affected:**
- `src/pages/ConstraintManager.tsx` - Constraint grid rendering
- `src/pages/TableManager.tsx` - Adjacent guest display in Guest Assignments section

---

## 🟠 MEDIUM PRIORITY ISSUES

### 7. Database Migration - Orphaned Data Cleanup
**Status:** 🟠 MEDIUM PRIORITY  
**Priority:** P1  
**First Mentioned:** October 20, 2025

**Description:**
- Phase A step A5 (orphaned data cleanup) is incomplete
- Blocked on schema verification
- Error: `column rss.id does not exist` (but columns DO exist)

**Completed:**
- ✅ Deduplication (A1)
- ✅ Unique constraints (A2)
- ✅ Performance indexes (A3)
- ✅ RLS policies (A4)

**Incomplete:**
- ❌ Orphaned data cleanup (A5)

**Files Affected:**
- `supabase/migrations/phase_a_database_hardening_v3_robust.sql` - Migration script (line 28 area)

**Next Steps:**
1. Verify actual column names in migration script
2. Run schema discovery queries to confirm table structure
3. Update cleanup queries to use correct column references
4. Execute cleanup safely using `BEGIN; ... ROLLBACK;` then `COMMIT;`

---

### 8. Dev Server Port Configuration
**Status:** 🟠 LOW PRIORITY  
**Priority:** P2  
**First Mentioned:** November 20, 2024 (Version Nov20at155pm)

**Description:**
- Dev server may run on ports 5174/5175 instead of default 5173
- Occurs when port 5173 is already in use
- Vite automatically increments to next available port

**Impact:**
- Users must check terminal or try multiple ports
- Not a code issue, but UX inconvenience

**Files Affected:**
- `vite.config.ts` - Could add explicit port configuration
- No code changes needed (works as designed)

**Potential Solution:**
- Add explicit port configuration in `vite.config.ts`
- Or document that users should check terminal output for actual port

---

## 💡 NOT-YET-IMPLEMENTED IDEAS

### 1. Enhanced Visual Signifiers (Partially Implemented)
**Status:** 🟡 PARTIALLY IMPLEMENTED  
**Priority:** LOW

**Description:**
- Table locking visual signifiers are implemented ✅
- Guest-level locked-assignment signifiers are implemented ✅
- Additional ideas mentioned but not yet implemented:
  - Optional "extra loud" premium toggle for lock emojis next to every guest name
  - Additional visual indicators for locked tables

**Files Affected:**
- `src/pages/SeatingPlanViewer.tsx` - Visual signifier implementation

---

## 📁 UNUSED FILES AND FOLDERS

### Backup Folders (No Longer Needed)

#### 1. `src/pages.backup/`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/src/pages.backup/`  
**Contents:** 16 files (15 .tsx files, 1 .rtf file)
- Account.tsx
- AdminDashboard.tsx
- AssignmentManager.tsx
- AuthCallback.tsx
- BetaCodeAdmin.tsx
- ConstraintManager.tsx
- Gemini0927at347pm.rtf
- GuestManager.tsx
- PaymentSuccess.tsx
- PremiumCancel.tsx
- PremiumSuccess.tsx
- PrivacyPolicy.tsx
- SavedSettings.tsx
- SeatingPlanViewer.tsx
- TableManager.tsx
- TermsOfService.tsx

**Status:** Backup of old page components, no longer needed

---

#### 2. `src/context.backup/`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/src/context.backup/`  
**Contents:** 1 file
- AppContext.tsx

**Status:** Backup of old AppContext, no longer needed

---

#### 3. `src/utils.backup/`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/src/utils.backup/`  
**Contents:** 15 files
- assignments.ts
- conflicts.ts
- conflictsSafe.ts
- formatters.ts
- guestCount.test.ts
- guestCount.ts
- hooks.ts
- migrationScript.ts
- planSignature.ts
- premium.ts
- seatingAlgorithm.engine.ts
- seatingAlgorithm.test.ts
- seatingAlgorithm.ts
- stateSanitizer.ts
- tables.ts

**Status:** Backup of old utility files, no longer needed

---

#### 4. `NewCode to consider/`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/NewCode to consider/`  
**Contents:** 30 files
- AppContext.v1_1.dropin-0929at139pm.tsx
- AssignmentManager-1002at540am.tsx
- AssignmentManager0706.tsx
- AssignmentManager0826.tsx
- AssignmentManager0906.tsx
- AssignmentManager0920.tsx
- ConstraintManager-0903at128pm.tsx
- ConstraintManager-1001at1238pm.tsx
- ConstraintManager-src-components-0929at425pm.tsx
- ConstraintManager-src-pages-0928at514pm.tsx
- ConstraintManager-src-pages-0929at425pm.tsx
- ConstraintManager.dropin-0929at139pm.tsx
- GuestManager1005.tsx
- MostRecentChoiceModal.tsx
- MostRecentChoiceModal0531.tsx
- mostRecentState0531.ts
- mostRecentState0706.ts
- RecentStateModal.tsx
- seatingAlgorithm.adapter.dropin-0929at139pm.ts
- seatingAlgorithm.engine.dropin-0929at425pm.ts
- SeatingPlanViewer-0730.tsx
- SeatingPlanViewer-0829at648pm.tsx
- SeatingPlanViewer-1006at1015pm.tsx
- SeatingPlanViewer-seatyr0627rev0819.tsx
- SeatingPlanViewer0624.tsx
- SeatingPlanViewer0905.tsx
- SSoT - Architecture Modes Report - 1007at533pm.rtf
- table_manager_ultimate_dropin-Grok0929at346pm.ts
- TableManager-0928at950pm.tsx
- TableManager-1001at1238pm.tsx
- TableManager0929at425pm.tsx

**Status:** Archive of code variations considered but not implemented, may be useful for reference but not actively used

---

#### 5. `OldCodeForCursor1120/`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/OldCodeForCursor1120/`  
**Contents:** Empty (recently cleared)

**Status:** Empty folder, can be deleted

---

#### 6. `Old Documentation/`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/Old Documentation/`  
**Contents:** 7 markdown files
- ENHANCED_ADJACENCY_IMPLEMENTATION.md
- IMPLEMENTATION_SUMMARY.md
- UNIFIED_ASSIGNMENTS_UTILITY_IMPLEMENTATION.md
- UNIFIED_CONSTRAINT_MANAGER_IMPLEMENTATION.md
- UNIFIED_FORMATTERS_UTILITY_IMPLEMENTATION.md
- UNIFIED_SEATING_ALGORITHM_IMPLEMENTATION.md
- UNIFIED_SEATING_PLAN_VIEWER_IMPLEMENTATION.md

**Status:** Historical documentation, may be useful for reference but superseded by current documentation

---

### Individual Backup Files

#### 1. `src/pages/TableManager.tsx.backup`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/src/pages/TableManager.tsx.backup`  
**Status:** Backup file, no longer needed

---

#### 2. `SavedSettingsAccordion0820.tsx`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/SavedSettingsAccordion0820.tsx`  
**Status:** Old version file in root, should be in backup folder or deleted

---

#### 3. `SavedSettingsAccordion0903.tsx`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/SavedSettingsAccordion0903.tsx`  
**Status:** Old version file in root, should be in backup folder or deleted

---

### Outdated Documentation Files

#### 1. `KNOWN-ISSUES-Nov18at1am.md`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/KNOWN-ISSUES-Nov18at1am.md`  
**Status:** Superseded by PROJECT-STATUS.md and VERSION-HISTORY.md

---

#### 2. `KNOWN-ISSUES-Nov18at325am.md`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/KNOWN-ISSUES-Nov18at325am.md`  
**Status:** Superseded by PROJECT-STATUS.md and VERSION-HISTORY.md

---

#### 3. `KNOWN-ISSUES-Nov18at426am.md`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/KNOWN-ISSUES-Nov18at426am.md`  
**Status:** Superseded by PROJECT-STATUS.md and VERSION-HISTORY.md

---

#### 4. `VERSION-1020at447pm.md`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/VERSION-1020at447pm.md`  
**Status:** Historical version documentation, information consolidated in VERSION-HISTORY.md

---

#### 5. `VERSION-1024at5pm.md`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/VERSION-1024at5pm.md`  
**Status:** Historical version documentation, information consolidated in VERSION-HISTORY.md

---

#### 6. `COMPLETE-PLAN-EMERGENCY-FIX-CONSENSUS.md`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/COMPLETE-PLAN-EMERGENCY-FIX-CONSENSUS.md`  
**Status:** Historical planning document, may be useful for reference

---

#### 7. `COMPLETE-PLAN-EMERGENCY-FIX-CONSENSUS-REVISED.md`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/COMPLETE-PLAN-EMERGENCY-FIX-CONSENSUS-REVISED.md`  
**Status:** Historical planning document, may be useful for reference

---

#### 8. `COMPREHENSIVE-ISSUES-ANALYSIS-FOR-RED-TEAM.md`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/COMPREHENSIVE-ISSUES-ANALYSIS-FOR-RED-TEAM.md`  
**Status:** Historical analysis document, may be useful for reference

---

#### 9. `LATEST-DEBUG-FILES-MAP.md`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/LATEST-DEBUG-FILES-MAP.md`  
**Status:** Historical debug documentation, may be useful for reference

---

#### 10. `MASTER-DOCUMENT-SSOT-1025at444pm.md`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/MASTER-DOCUMENT-SSOT-1025at444pm.md`  
**Status:** Historical master document, may be useful for reference

---

#### 11. `MODAL-BUTTON-STUCK-DIAGNOSIS.md`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/MODAL-BUTTON-STUCK-DIAGNOSIS.md`  
**Status:** Historical diagnosis document, issue resolved

---

#### 12. `QUOTES-APOSTROPHES-VERIFICATION.md`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/QUOTES-APOSTROPHES-VERIFICATION.md`  
**Status:** Historical verification document, may be useful for reference

---

#### 13. `TEST-SPECIAL-CHARACTERS.md`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/TEST-SPECIAL-CHARACTERS.md`  
**Status:** Historical test documentation, may be useful for reference

---

#### 14. `VIABILITY-ASSESSMENT.md`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/VIABILITY-ASSESSMENT.md`  
**Status:** Historical assessment document, may be useful for reference

---

#### 15. `cycles.txt`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/cycles.txt`  
**Status:** Unknown purpose, may be temporary file

---

### Duplicate/Unused Build Files

#### 1. `dist/_redirects 2`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/dist/_redirects 2`  
**Status:** Duplicate file with space in name, should be removed

---

#### 2. `dist/assets 2/`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/dist/assets 2/`  
**Status:** Duplicate assets folder, should be removed

---

#### 3. `dist/index 2.html`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/dist/index 2.html`  
**Status:** Duplicate index file, should be removed

---

### Context Backup Files

#### 1. `src/context/AppContext.OLDPRE-FSM.tsx`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/src/context/AppContext.OLDPRE-FSM.tsx`  
**Status:** Old version before FSM implementation, backup file

---

#### 2. `src/context/AppContext 2.tsx`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/src/context/AppContext 2.tsx`  
**Status:** Duplicate/backup file with space in name, should be removed

---

#### 3. `src/context/AppContext.NEWFSM.tsx`
**Location:** `/Users/danielabrams/Desktop/seatyr1016/src/context/AppContext.NEWFSM.tsx` (if exists)  
**Status:** Backup file, verify if still needed

---

## 📊 SUMMARY STATISTICS

### Outstanding Issues
- **Critical (P0):** 3 issues
- **High Priority (P1):** 3 issues
- **Medium Priority (P1):** 1 issue
- **Low Priority (P2):** 1 issue
- **Not Yet Implemented:** 1 idea (partially implemented)

**Total:** 9 outstanding issues/concerns

### Unused Files
- **Backup Folders:** 5 folders (62+ files)
- **Individual Backup Files:** 3 files
- **Outdated Documentation:** 15 files
- **Duplicate Build Files:** 3 files/folders
- **Context Backup Files:** 2-3 files

**Total:** ~85+ unused files/folders

---

## 🎯 RECOMMENDED ACTIONS

### Immediate Priority
1. **Fix "Cannot Sit With" constraint input** - High impact, relatively isolated issue
2. **Investigate route-dependent reload failures** - Critical for user experience
3. **Fix anonymous user data loss** - Critical for user retention

### High Priority
4. **Fix multi-table assignment UI** - Important feature for power users
5. **Fix premium table name assignments** - Premium feature enhancement
6. **Fix star emoji display** - Visual feedback issue

### Medium Priority
7. **Complete database migration** - Data integrity and performance
8. **Document dev server port behavior** - UX improvement

### Cleanup
9. **Archive or delete backup folders** - Reduce codebase clutter
10. **Consolidate or archive outdated documentation** - Improve maintainability
11. **Remove duplicate build files** - Clean up dist folder

---

## 📝 NOTES

- This document should be updated as issues are resolved
- Backup files may be useful for reference but should be archived outside the main codebase
- Historical documentation provides valuable context but should be clearly marked as historical
- Consider creating an `archive/` folder for historical files rather than keeping them in root

---

**Last Updated:** November 20, 2024 at 1:55 PM  
**Next Review:** After resolving "Cannot Sit With" issue

