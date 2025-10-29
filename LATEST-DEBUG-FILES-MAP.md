# Latest Debug Rounds - File Involvement Map

## Issue: Erroneous Table ID Warnings & Seating Plan Generation Failure/h3>

## Root Cause Analysis

### **Primary Issue: Seating Plans Not Generating Despite Valid Logic**

**Diagnosis:** The `normalizeAssignmentInputToIdsWithWarnings` function in `src/utils/assignments.ts` was returning an empty `idCsv` string when ANY warnings existed, even if some tokens were successfully resolved to valid table IDs.

**Impact:** This caused the seating algorithm engine to receive empty assignment restrictions (`allowedTables.size === 0`), which triggered the validation error "No common allowed table for grouped guests" and prevented ANY seating plans from being generated.

### **Secondary Issue: Partial Warnings Causing Full Rejection**

When a user entered "2, 3, 99" (table 99 doesn't exist):
- The old code would: `warnings: ["Unknown table ID: 99"]`, `idCsv: ""` (EMPTY - all work lost)
- The new code will: `warnings: ["Unknown table ID: 99"]`, `idCsv: "2,3"` (PARTIAL - valid IDs preserved)

---

## Files Modified in Latest Debug Round

### **1. `src/utils/assignments.ts`** (MODIFIED - 2024-10-28 02:38AM)
- **Function:** `normalizeAssignmentInputToIdsWithWarnings()`
- **Lines:** 51-61
- **Change:** Modified to return partial valid IDs when warnings exist
- **Logic:** 
  ```typescript
  // OLD: Always returned idCsv, even if empty due to warnings
  return { idCsv, warnings };
  
  // NEW: Returns partial valid IDs or empty only if NO valid IDs found
  if (resolved.size > 0) {
    return { idCsv, warnings };
  } else {
    return { idCsv: "", warnings };
  }
  ```

### **2. `src/utils/seatingAlgorithm.ts`** (MODIFIED - 2024-10-28 02:38AM)
- **Lines:** 97-98
- **Change:** Added diagnostic logging for assignment mapping
- **Purpose:** Track exactly what assignments are passed to the engine

### **3. `src/utils/seatingAlgorithm.ts`** (MODIFIED - Previously)
- **Lines:** 134
- **Change:** Fixed capacity calculation from `appTable?.seats ?? 0` to `getCapacity(appTable)`
- **Issue:** Capacity was returning 0 or array instead of number

### **4. `src/pages/SeatingPlanViewer.tsx`** (MODIFIED - Previously)
- **Lines:** 314
- **Change:** Changed capacity source from `capacityById.get(table.id)` to `table.capacity ?? capacityById.get(table.id)`
- **Issue:** Using state.tables capacity instead of plan's table.capacity

### **5. `src/pages/TableManager.tsx`** (ROLLED BACK - 2024-10-28)
- **Lines:** 180-207 (was added, then removed)
- **Issue:** useEffect with state.assignments dependency caused infinite render loop
- **Result:** Changes rolled back to previous working state

---

## Related Core Files (Not Modified in This Round)

### **6. `src/context/AppContext.tsx`**
- **Function:** `reducer()` - Lines 187-523
- **Function:** `debouncedGeneratePlans()` - Lines 830-860
- **Function:** `applySanitizedState()` - Lines 154-175
- **Purpose:** State management, generation triggers, persistence integration
- **Note:** Core seating plan generation orchestration happens here

### **7. `src/utils/seatingAlgorithm.engine.ts`**
- **Function:** `validateAndGroup()` - Lines 349-546
- **Function:** `generateSeatingPlans()` - Lines 788-898
- **Function:** `placeGroups()` - Lines 560-630
- **Purpose:** Core algorithm validation and plan generation
- **Issue Line 609:** `if (gi.allowedTables && gi.allowedTables.size > 0 && !gi.allowedTables.has(String(ts.table.id)))`
- **Impact:** When `allowedTables.size === 0` after assignment validation, this causes generation failure

### **8. `src/utils/persistence.ts`**
- **Functions:** `saveAppState()`, `loadAppState()`, `sanitizeAndMigrateAppState()`, `saveLKG()`, `loadLKG()`
- **Purpose:** Robust persistence system with atomic writes, orphaned key recovery, and session versioning
- **Status:** Already fixed in earlier rounds

---

## Issue Timeline

### **2024-10-27 - Initial Issue**
- **Symptom:** Erroneous "Unknown table ID" warnings even for valid table IDs
- **Diagnosis:** Assignment validation logic not properly handling input parsing

### **2024-10-28 02:38 AM - Current Issue**
- **Symptom:** Seating plans not generating at all despite logically valid permutations
- **Root Cause:** `normalizeAssignmentInputToIdsWithWarnings()` returning empty `idCsv` when warnings exist
- **Impact:** Zero valid table assignments → validation rejects all possibilities → no plans generated
- **Fix Applied:** Modified function to return partial valid IDs when some tokens are invalid

### **2024-10-28 02:38 AM - Previous Regression**
- **Symptom:** Navigation lockout due to infinite render loop in `TableManager.tsx`
- **Cause:** useEffect with `state.assignments` dependency
- **Resolution:** Rolled back all `TableManager.tsx` changes

---

## Critical Code Path

1. **User Input:** "2, 3, 99" (table 99 doesn't exist)
2. **`normalizeAssignmentInputToIdsWithWarnings()`** (assignments.ts:4-62)
   - Parses tokens: ["2", "3", "99"]
   - Resolves: `resolved = Set([2, 3])`
   - Warnings: `["Unknown table ID: 99"]`
   - **OLD:** Returns `{ idCsv: "", warnings: ["Unknown table ID: 99"] }`
   - **NEW:** Returns `{ idCsv: "2,3", warnings: ["Unknown table ID: 99"] }`
3. **Adapter** (seatingAlgorithm.ts:80-99)
   - Receives `idCsv: "2,3"` and warnings
   - Passes to engine: `engineAssignments[gid] = "2,3"`
4. **Engine** (seatingAlgorithm.engine.ts:424-490)
   - Creates `memberAllowed = Set(["2", "3"])`
   - Intersects across group members
   - Sets `gi.allowedTables = Set(["2", "3"])`
5. **Placement** (seatingAlgorithm.engine.ts:609)
   - Checks: `if (gi.allowedTables && gi.allowedTables.size > 0 && !gi.allowedTables.has(String(ts.table.id)))`
   - With `allowedTables.size === 2`, placement succeeds

---

## Testing Plan for Red Teams

### **Test Case 1: Partial Invalid Assignment**
- **Input:** Guest "Alice" assigned to tables "2, 3, 99" (99 doesn't exist)
- **Expected:** 
  - Warning displayed: "Unknown table ID: 99"
  - Plans generated with Alice restricted to tables 2 and 3

### **Test Case 2: Fully Invalid Assignment**
- **Input:** Guest "Bob" assigned to tables "99, 100" (both don't exist)
- **Expected:**
  - Warning displayed: "Unknown table IDs: 99, 100"
  - No assignment restriction applied (Bob can sit anywhere)

### **Test Case 3: Valid Assignment**
- **Input:** Guest "Charlie" assigned to tables "2, 3, 7" (all exist)
- **Expected:**
  - No warnings
  - Plans generated with Charlie restricted to tables 2, 3, and 7

### **Test Case 4: Mixed Valid/Invalid Across Group**
- **Input:** Group of 4 guests
  - Guest 1: assigned to "2, 3"
  - Guest 2: assigned to "2" (valid)
  - Guest 3: assigned to "99" (invalid)
  - Guest 4: no assignment
- **Expected:**
  - Warnings for Guest 1 and Guest 3
  - Intersection calculation: `["2", "3"] ∩ ["2"] ∩ [] ∩ []` = `["2"]`
  - Plans generated with entire group restricted to table 2

---

## Files Summary

### **Primary Files (Directly Involved in Current Issue)**
1. `src/utils/assignments.ts` - Core assignment validation (MODIFIED)
2. `src/utils/seatingAlgorithm.ts` - Adapter layer (MODIFIED)
3. `src/utils/seatingAlgorithm.engine.ts` - Core algorithm (NOT MODIFIED but involved)

### **Related Files (Involved in Overall Context)**
4. `src/pages/TableManager.tsx` - UI component (ROLLED BACK)
5. `src/pages/SeatingPlanViewer.tsx` - Display component (PREVIOUSLY FIXED)
6. `src/context/AppContext.tsx` - State management (NOT MODIFIED but involved)

### **Persistence Files (Earlier Fixes)**
7. `src/utils/persistence.ts` - Robust persistence (ALREADY FIXED)
8. `src/types/index.ts` - Type definitions (ALREADY FIXED)

---

## Critical Debugging Insight

**The fundamental issue:** When parsing "2, 3, 99" (where 99 is invalid):
- **Old behavior:** Return `{ idCsv: "", warnings: [...] }` → Engine sees empty assignment → Validation fails → No plans
- **New behavior:** Return `{ idCsv: "2,3", warnings: [...] }` → Engine sees partial assignment → Validation succeeds → Plans generate with restriction to tables 2 and 3

**Key Line of Code:** `src/utils/assignments.ts:56-60`
```typescript
if (resolved.size > 0) {
  return { idCsv, warnings };  // Return partial valid IDs
} else {
  return { idCsv: "", warnings }; // Only empty if NO valid IDs found
}
```

This change allows graceful degradation: accept valid IDs while warning about invalid ones, rather than rejecting the entire assignment.


