# DEBUGGING: "No common allowed table for grouped guests"

## The Warning
This warning appears when:
1. Guests are grouped together (MUST constraint or adjacency)
2. Each guest has table assignments
3. But there's NO overlap between their allowed tables

## Example Scenario
- Guest A assigned to tables "1, 2"
- Guest B assigned to tables "3, 4"
- Guest A and B have MUST constraint
- Result: No common table → Warning!

## My Recent Changes
I changed how assignments are stored in TableManager.tsx:
- Before: Direct assignment to state
- After: Parse through `normalizeAssignmentInputToIdsWithWarnings` → store `idCsv`

## Potential Issues

### 1. Assignment Format Mismatch
**Adapter (seatingAlgorithm.ts:86):**
```typescript
engineAssignments[gid] = norm.idCsv;  // "1,3,5"
```

**Engine (seatingAlgorithm.engine.ts:405):**
```typescript
const list = (Array.isArray(raw) ? raw : String(raw).split(/[,\s.]+/).filter(Boolean))
```

This should work: "1,3,5" → ["1", "3", "5"]

### 2. Table ID Type Mismatch
**Engine expects:** String IDs that match `idToTable.has(String(tid))`
**We provide:** Numeric IDs converted to strings

### 3. Assignment Processing Bug
The engine processes assignments like this:
```typescript
for (const m of gi.members) {
  const raw = assignments[m];  // "1,3,5"
  if (!raw) continue;
  const list = String(raw).split(/[,\s.]+/).filter(Boolean)  // ["1", "3", "5"]
    .map((t) => String(t))  // ["1", "3", "5"]
    .filter((tid) => idToTable.has(String(tid)));  // Filter valid tables
  const memberAllowed = new Set<ID>(list);
  // ...
}
```

## Debugging Steps Needed

1. **Check what assignments are actually stored:**
   ```javascript
   // In browser console:
   console.log('Assignments:', state.assignments);
   ```

2. **Check what the engine receives:**
   ```javascript
   // Add logging in seatingAlgorithm.ts line 86:
   console.log('Engine assignment for', gid, ':', norm.idCsv);
   ```

3. **Check table ID mapping:**
   ```javascript
   // In engine, check if idToTable has the right keys
   console.log('idToTable keys:', Array.from(idToTable.keys()));
   console.log('Assignment tokens:', list);
   ```

4. **Check if guests are actually grouped:**
   ```javascript
   // Check if MUST constraints exist
   console.log('Constraints:', state.constraints);
   ```

## Most Likely Causes

### Cause 1: Assignment Not Being Saved
- User types assignment but doesn't blur/Enter
- Raw input stored locally but not dispatched
- State still has old/empty assignment

### Cause 2: Table ID Mismatch
- Engine expects string IDs: "1", "2", "3"
- We provide numeric IDs: 1, 2, 3
- `idToTable.has(String(tid))` fails

### Cause 3: Assignment Parsing Bug
- `normalizeAssignmentInputToIdsWithWarnings` returns wrong format
- Empty `idCsv` or malformed CSV

## Quick Fix Test

Add logging to see what's happening:

```typescript
// In seatingAlgorithm.ts line 86:
console.log('Assignment for', gid, ':', {
  raw: raw,
  normalized: norm.idCsv,
  warnings: norm.warnings
});

// In engine line 405:
console.log('Processing assignment for', m, ':', {
  raw: raw,
  list: list,
  memberAllowed: Array.from(memberAllowed)
});
```

## Expected Behavior

If assignments are "1,3" and "2,4" for grouped guests:
- Guest A: memberAllowed = Set(["1", "3"])
- Guest B: memberAllowed = Set(["2", "4"])
- groupAllowed = intersection = Set([]) = empty
- Warning: "No common allowed table for grouped guests"

This is CORRECT behavior if guests are assigned to non-overlapping tables!

## The Real Question

**Is this warning appearing for guests who SHOULD have overlapping assignments?**

If yes → Bug in assignment processing
If no → Expected behavior (user assigned conflicting tables)
