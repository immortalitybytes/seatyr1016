# Table Deletion Issues - Comprehensive Diagnosis

**Date:** November 21, 2024  
**Status:** Critical Issues Identified  
**Priority:** HIGH

## 🎯 **PROBLEM SUMMARY**

When tables are deleted, two major issues occur:
1. **Guest assignments on Tables page appear corrupted** - Invalid table IDs/names are displayed
2. **Current Plan on Seating page generates results incompliant with constraints & assignments** - Algorithm uses invalid assignments referencing deleted tables

---

## 🔍 **ROOT CAUSE ANALYSIS**

### **Issue 1: parseAssignmentIds Regex Mismatch**

**Location:** `src/utils/assignments.ts` line 87-93

**Problem:**
- `parseAssignmentIds()` uses OLD regex: `/[,\s.]+/` (splits on commas, spaces, and periods)
- `normalizeAssignmentInputToIdsWithWarnings()` uses NEW regex: `/[;,]+/` (only splits on commas/semicolons)
- **Mismatch causes inconsistent parsing**

**Impact:**
- When `REMOVE_TABLE` filters assignments, it uses `parseAssignmentIds()` which may not correctly parse assignments that were saved with the new tokenizer
- Display logic on Tables page uses `parseAssignmentIds()` which may show corrupted assignments
- Algorithm validation uses different regex than input normalization

**Current Code:**
```typescript
export function parseAssignmentIds(csv: string | undefined | null): number[] {
  if (!csv) return [];
  return String(csv)
    .split(/[,\s.]+/)  // ❌ OLD REGEX - splits on spaces
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}
```

**Expected Behavior:**
- Should use same tokenization logic as `normalizeAssignmentInputToIdsWithWarnings`
- Should handle table names (for premium users) or at least validate against current tables
- Should filter out invalid/deleted table IDs

---

### **Issue 2: parseAssignmentIds Doesn't Handle Table Names**

**Location:** `src/utils/assignments.ts` line 87-93

**Problem:**
- `parseAssignmentIds()` only parses numeric IDs
- Premium users can save assignments with table names (e.g., "Head Table")
- When these are displayed or filtered, they're lost or corrupted

**Impact:**
- Premium users who assigned guests to "Head Table" see corrupted assignments after table deletion
- `REMOVE_TABLE` can't properly filter assignments that contain table names
- Display on Tables page shows invalid assignments

**Example:**
- User assigns guest to "Head Table" (table ID 1)
- User deletes table 1
- Assignment still contains "Head Table" or "1"
- `parseAssignmentIds("Head Table")` returns `[]` (empty array)
- Assignment appears as empty/corrupted

---

### **Issue 3: REMOVE_TABLE Doesn't Clean Up lockedTableAssignments**

**Location:** `src/context/AppContext.tsx` lines 443-466

**Problem:**
- When a table is deleted, `REMOVE_TABLE` case:
  - ✅ Filters `tables` array
  - ✅ Filters `assignments` object
  - ❌ **Does NOT clean up `lockedTableAssignments`**

**Impact:**
- `lockedTableAssignments[deletedTableId]` remains in state
- Seating algorithm receives locked assignments for non-existent tables
- Can cause algorithm errors or invalid plan generation
- Locked assignments reference deleted tables

**Current Code:**
```typescript
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
  
  // ❌ MISSING: Clean up lockedTableAssignments
  // lockedTableAssignments[tableId] should be deleted
  
  return {
    ...state,
    tables: filteredTables,
    assignments: filteredAssignments,
    // ❌ lockedTableAssignments not cleaned up
    ...
  };
}
```

---

### **Issue 4: Algorithm Assignment Validation Uses Old Regex**

**Location:** `src/utils/seatingAlgorithm.engine.ts` line 432

**Problem:**
- Algorithm's assignment validation uses: `String(raw).split(/[,\s]+/)`
- This is different from both:
  - `normalizeAssignmentInputToIdsWithWarnings` (uses `/[;,]+/`)
  - `parseAssignmentIds` (uses `/[,\s.]+/`)
- **Three different regex patterns for the same data!**

**Impact:**
- Algorithm may not correctly parse assignments
- Invalid table IDs may not be filtered correctly
- Assignments referencing deleted tables may pass validation

**Current Code:**
```typescript
const list = (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/).filter(Boolean))
  .map((t) => String(t).replace(/\.$/, ''))
  .map((t) => String(t))
  .filter((tid) => idToTable.has(String(tid)));  // ✅ Filters invalid IDs
```

**Note:** The algorithm DOES filter by `idToTable.has()`, which is good, but the initial parsing is inconsistent.

---

### **Issue 5: Assignment Display Doesn't Validate Against Current Tables**

**Location:** `src/pages/TableManager.tsx` line 734, `src/utils/formatters.ts` line 75-149

**Problem:**
- `parseAssignmentIds()` is used to display assignments
- It doesn't validate that table IDs exist in current `state.tables`
- Deleted table IDs are still shown in assignment inputs

**Impact:**
- User sees assignments like "1, 3, 5" but table 3 was deleted
- No visual indication that assignment is invalid
- User may not realize assignment needs to be updated

**Current Code:**
```typescript
// TableManager.tsx line 734
{assignedTables && parseAssignmentIds(assignedTables).length > 1 && (
  // Shows multi-table option, but doesn't validate tables exist
)}

// formatters.ts line 120-134
for (const token of parts) {
  const tableId = Number(token);
  const table = tableById.get(tableId);
  if (!table) {
    labels.push(`Table #${token}`); // Shows unknown table, but doesn't warn
    continue;
  }
}
```

---

## 📋 **SPECIFIC PROBLEM SCENARIOS**

### **Scenario 1: Premium User with Named Tables**
1. User creates table 1, names it "Head Table"
2. User assigns Guest A to "Head Table"
3. Assignment saved as: `assignments[guestA.id] = "Head Table"` or `"1"`
4. User deletes table 1
5. **Problem:** Assignment still references "Head Table" or "1"
6. **Result:** 
   - Tables page shows corrupted assignment (empty or invalid)
   - Algorithm receives invalid assignment
   - Plan generation may fail or produce invalid results

### **Scenario 2: Multi-Table Assignment**
1. User assigns Guest B to tables "1, 3, 5"
2. User deletes table 3
3. **Problem:** `REMOVE_TABLE` uses `parseAssignmentIds("1, 3, 5")` which may not correctly parse
4. **Result:**
   - Assignment may become "1, 5" (correct) OR "1, , 5" (corrupted)
   - Display shows invalid assignment
   - Algorithm may receive malformed assignment

### **Scenario 3: Locked Table Assignment**
1. User locks table 2 with Guest C
2. `lockedTableAssignments[2] = [guestC.id]`
3. User deletes table 2
4. **Problem:** `lockedTableAssignments[2]` is NOT cleaned up
5. **Result:**
   - Algorithm receives locked assignment for non-existent table
   - Plan generation may fail or produce invalid results
   - State contains orphaned locked assignments

### **Scenario 4: Saved Settings with Deleted Tables**
1. User saves setting with table 4 assigned to Guest D
2. User deletes table 4
3. User loads saved setting
4. **Problem:** Saved setting contains assignment to deleted table 4
5. **Result:**
   - Assignment references non-existent table
   - Display shows corrupted assignment
   - Algorithm receives invalid assignment

---

## 🔧 **REQUIRED FIXES**

### **Fix 1: Unify Assignment Parsing Logic**

**Files:** `src/utils/assignments.ts`

**Changes:**
1. Update `parseAssignmentIds()` to use same regex as `normalizeAssignmentInputToIdsWithWarnings`
2. Add table validation parameter to filter invalid IDs
3. Handle table names (for premium users) or convert to IDs

**Proposed Code:**
```typescript
export function parseAssignmentIds(
  csv: string | undefined | null,
  tables?: Array<{ id: number; name?: string | null }>,
  isPremium?: boolean
): number[] {
  if (!csv) return [];
  
  // Use same tokenizer as normalizeAssignmentInputToIdsWithWarnings
  const tokens = String(csv)
    .split(/[;,]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(tok => tok.replace(/\.$/, ""))
    .filter(Boolean);
  
  const validIds = new Set<number>();
  const nameToId = new Map<string, number>();
  
  if (tables) {
    for (const t of tables) {
      if (t && Number.isInteger(t.id)) validIds.add(t.id);
      if (t?.name && isPremium) nameToId.set(t.name.trim().toLowerCase(), t.id);
    }
  }
  
  const resolved = new Set<number>();
  for (const token of tokens) {
    const n = Number(token);
    if (Number.isFinite(n) && Number.isInteger(n) && n > 0) {
      if (!tables || validIds.has(n)) {
        resolved.add(n);
      }
      // If tables provided and ID invalid, skip it (deleted table)
      continue;
    }
    
    if (isPremium && tables) {
      const id = nameToId.get(token.toLowerCase());
      if (typeof id === "number" && validIds.has(id)) {
        resolved.add(id);
      }
      // If name not found or table deleted, skip it
    }
  }
  
  return Array.from(resolved).sort((a, b) => a - b);
}
```

---

### **Fix 2: Clean Up lockedTableAssignments in REMOVE_TABLE**

**Files:** `src/context/AppContext.tsx`

**Changes:**
1. Delete `lockedTableAssignments[tableId]` when table is removed
2. Clean up any locked assignments referencing deleted table

**Proposed Code:**
```typescript
case 'REMOVE_TABLE': {
  const tableId = action.payload;
  const filteredTables = state.tables.filter(t => t.id !== tableId);
  
  // Remove assignments referencing deleted table
  const filteredAssignments = Object.fromEntries(
    Object.entries(state.assignments).map(([guestId, raw]) => {
      const ids = parseAssignmentIds(raw, filteredTables, isPremium);
      const filtered = ids.filter(id => id !== tableId);
      return [guestId, filtered.join(',')];
    })
  );
  
  // CRITICAL FIX: Clean up lockedTableAssignments
  const filteredLocked: LockedTableAssignments = { ...state.lockedTableAssignments };
  delete filteredLocked[tableId];
  
  console.log('[Table Change] Removing table - regenerating plans (constraint addition)');
  return {
    ...state,
    tables: filteredTables,
    assignments: filteredAssignments,
    lockedTableAssignments: filteredLocked,  // ✅ Cleaned up
    userSetTables: true,
    regenerationNeeded: true,
    seatingPlans: [],
    currentPlanIndex: 0,
    sessionVersion: state.sessionVersion + 1
  };
}
```

---

### **Fix 3: Update Algorithm Assignment Parsing**

**Files:** `src/utils/seatingAlgorithm.engine.ts`

**Changes:**
1. Use consistent tokenization logic
2. Ensure invalid table IDs are filtered

**Proposed Code:**
```typescript
// Line 432 - Use consistent tokenization
const list = (Array.isArray(raw) ? raw : String(raw).split(/[;,]+/).filter(Boolean))
  .map((t) => String(t).trim().replace(/\.$/, ''))
  .filter(Boolean)
  .filter((tid) => idToTable.has(String(tid)));  // ✅ Already filters invalid IDs
```

---

### **Fix 4: Validate Assignments on Display**

**Files:** `src/pages/TableManager.tsx`, `src/utils/formatters.ts`

**Changes:**
1. Validate assignments against current tables when displaying
2. Show warnings for invalid/deleted table references
3. Filter out invalid table IDs from display

**Proposed Code:**
```typescript
// In TableManager.tsx - validate before displaying
const validAssignmentIds = parseAssignmentIds(
  assignedTables, 
  state.tables, 
  isPremium
);

if (validAssignmentIds.length !== parseAssignmentIds(assignedTables).length) {
  // Show warning: some table IDs are invalid
}
```

---

## 📊 **IMPACT ASSESSMENT**

### **Severity: HIGH**

**Affected Features:**
- Table deletion
- Guest assignments display
- Seating plan generation
- Saved settings loading
- Locked table assignments

**User Impact:**
- Corrupted assignments visible to users
- Invalid seating plans generated
- Confusion about assignment validity
- Potential data loss when tables are deleted

**Data Integrity:**
- State contains orphaned references
- Assignments reference non-existent tables
- Locked assignments reference deleted tables

---

## 🧪 **TESTING SCENARIOS**

### **Test 1: Delete Table with Assignments**
1. Create 3 tables
2. Assign Guest A to "1, 2, 3"
3. Delete table 2
4. **Verify:** Assignment shows "1, 3" (not "1, , 3" or corrupted)
5. **Verify:** Generate plan - should work correctly

### **Test 2: Delete Table with Named Assignment**
1. Create table 1, name it "Head Table"
2. Assign Guest B to "Head Table"
3. Delete table 1
4. **Verify:** Assignment is cleared or shows warning
5. **Verify:** No corrupted display

### **Test 3: Delete Locked Table**
1. Generate seating plan
2. Lock table 3
3. Delete table 3
4. **Verify:** `lockedTableAssignments[3]` is removed
5. **Verify:** Generate new plan - should work correctly

### **Test 4: Load Saved Setting with Deleted Tables**
1. Save setting with table 5 assigned to Guest C
2. Delete table 5
3. Load saved setting
4. **Verify:** Assignment is cleaned up or shows warning
5. **Verify:** Plan generation works correctly

---

## 📝 **FILES REQUIRING CHANGES**

1. **`src/utils/assignments.ts`**
   - Update `parseAssignmentIds()` to use consistent tokenization
   - Add table validation parameter
   - Handle table names for premium users

2. **`src/context/AppContext.tsx`**
   - Clean up `lockedTableAssignments` in `REMOVE_TABLE` case
   - Use updated `parseAssignmentIds()` with table validation

3. **`src/utils/seatingAlgorithm.engine.ts`**
   - Update assignment parsing to use consistent regex
   - Ensure invalid table IDs are filtered

4. **`src/pages/TableManager.tsx`**
   - Validate assignments against current tables
   - Show warnings for invalid assignments
   - Filter invalid table IDs from display

5. **`src/utils/formatters.ts`**
   - Validate table IDs exist before formatting
   - Show warnings for invalid table references

---

## 🎯 **RECOMMENDED IMPLEMENTATION ORDER**

1. **Fix 1:** Unify assignment parsing logic (foundation for all other fixes)
2. **Fix 2:** Clean up lockedTableAssignments (prevents algorithm errors)
3. **Fix 3:** Update algorithm parsing (ensures consistency)
4. **Fix 4:** Validate assignments on display (improves UX)

---

**This diagnosis identifies all root causes of table deletion issues. The fixes are surgical and targeted, maintaining existing functionality while resolving the corruption and compliance problems.**

