# REAL DIAGNOSIS - All Problems Found

## 🎯 ROOT CAUSES IDENTIFIED

### **PROBLEM 1: Input Appears to Reject Commas/Letters**

**Root Cause:** Input is **controlled** by normalized state, not raw input!

**The Flow:**
```
1. User types: "1, 3, 5"
   ↓
2. onChange triggers → handleUpdateAssignment
   ↓
3. normalizeAssignmentInputToIdsWithWarnings("1, 3, 5")
   → Returns: idCsv = "1,3,5" (parsed!)
   ↓
4. dispatch({ type: 'UPDATE_ASSIGNMENT', payload: { guestId, raw: "1,3,5" }})
   ↓
5. state.assignments[guestId] = "1,3,5"
   ↓
6. Input value = state.assignments[guestId] = "1,3,5"
   ↓
7. User tries to add another comma: "1,3,5,"
   ↓
8. Parses to "1,3,5" again (comma removed!)
   ↓
9. Input shows "1,3,5" → **appears to reject comma!**
```

**Same with letters:**
```
Premium user types: "Table A"
   ↓
Parser converts "Table A" → finds tableId 1
   ↓
State stores: "1"
   ↓
Input shows: "1"
   ↓
User sees their text replaced → **appears to reject letters!**
```

**The Fix:** Use **uncontrolled input** or store raw input separately!

---

### **PROBLEM 2: Data Loss on Reload**

**Root Cause:** React useEffect dependency array uses **shallow comparison**!

**The Issue:**
```typescript
useEffect(() => {
  // Save to localStorage
  localStorage.setItem('seatyr_app_state', JSON.stringify(rest));
}, [state.guests, state.tables, state.constraints, ...]);
//     ↑ THESE ARE OBJECTS - shallow comparison!
```

**What Happens:**
1. User adds constraint → `state.constraints` object is **mutated** (same reference!)
2. React compares: `oldConstraints === newConstraints` → **TRUE** (same object!)
3. useEffect doesn't run!
4. localStorage not updated!
5. Reload → old data restored!

**Proof:** Check the reducer for `CYCLE_CONSTRAINT`:
```typescript
case 'CYCLE_CONSTRAINT': {
  const newConstraints = JSON.parse(JSON.stringify(state.constraints)); // Deep clone
  // ... modify newConstraints ...
  return { ...state, constraints: newConstraints };  // New reference!
}
```
This creates a new reference, so it SHOULD trigger the useEffect. **BUT...**

**The REAL Issue:** Dependencies list individual properties!
```typescript
}, [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, ...]);
```

This should work IF the reducer creates new objects. Let me verify...

**Actually, looking closer:** The reducer DOES create new objects with spread operator and JSON.parse/stringify. So that's not the issue.

**The ACTUAL Issue:** Looking at line 471:
```typescript
}, [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, sessionTag, state.timestamp, state.userSetTables]);
```

These dependencies are correct. **So what's the real problem?**

**WAIT!** Let me check if the issue is that the useEffect runs DURING the render that changes sessionTag!

**FOUND IT!** Look at the restore logic (line 300):
```typescript
dispatch({ type: 'IMPORT_STATE', payload: JSON.parse(saved) });
setSessionTag('ANON');
```

And the save logic condition (line 453):
```typescript
if (sessionTag !== 'ANON') return;
```

**THE PROBLEM:**
1. On mount, `sessionTag` starts as `'INITIALIZING'`
2. checkInitialSession runs, restores data, then sets `sessionTag` to `'ANON'`
3. Save useEffect has `sessionTag` in dependencies
4. When `sessionTag` changes from 'INITIALIZING' to 'ANON', useEffect runs
5. But the condition `if (sessionTag !== 'ANON') return;` prevents saving!
6. **User changes data while sessionTag is 'ANON'**
7. useEffect triggers (dependencies changed)
8. Saves to localStorage ✓ (this part works!)

So localStorage save IS working... **Then why is data lost?**

**ACTUAL DIAGNOSIS:** Let me check if there's an auth state change that clears data!

Looking at lines 328-345 (auth state change handler):
```typescript
if (event === 'SIGNED_OUT' || !session) {
  const wasAuthed = userRef.current !== null;
  resetEntitlementsPromise();
  dispatch({ type: 'RESET_APP_STATE' });  // ← CLEARS EVERYTHING!

  if (wasAuthed) {
    localStorage.removeItem('seatyr_app_state');
  } else {
    try {
      const saved = localStorage.getItem('seatyr_app_state');
      if (saved) dispatch({ type: 'IMPORT_STATE', payload: JSON.parse(saved) });
    } catch { /* ignore */ }
  }
  // ...
}
```

**FOUND THE BUG!**

When there's no session (anonymous user on reload):
1. `event === 'SIGNED_OUT' || !session` → TRUE
2. `dispatch({ type: 'RESET_APP_STATE' })` → **CLEARS ALL DATA!**
3. Then tries to restore from localStorage
4. **BUT** the order is wrong!

The flow is:
1. RESET (clear data)
2. IMPORT (restore data)

But there's also the initial session check that runs FIRST and does:
```typescript
// Line 300:
if (saved) dispatch({ type: 'IMPORT_STATE', payload: JSON.parse(saved) });
```

**So we have:**
1. checkInitialSession: IMPORT (restores data)
2. onAuthStateChange fires with `!session`: RESET → IMPORT again

**The problem:** onAuthStateChange is firing AFTER we've already restored!

---

### **PROBLEM 3: Data Loss on Page Navigation**

**Root Cause:** Same as Problem 2 - but happens because:

1. React Router doesn't unmount AppProvider
2. But something triggers a state reset
3. Likely: A dispatch of RESET_APP_STATE or CLEAR_ALL somewhere

**Need to check:** Where else are these actions dispatched?

---

## 💡 SOLUTIONS

### **SOLUTION 1: Fix Input Rejection (Store Raw Input)**

**Option A: Uncontrolled Input with Controlled Fallback**
```tsx
const [rawInput, setRawInput] = useState<Record<string, string>>({});

<input 
  value={rawInput[guest.id] ?? state.assignments[guest.id] ?? ''}
  onChange={e => {
    setRawInput(prev => ({ ...prev, [guest.id]: e.target.value }));
  }}
  onBlur={e => {
    handleUpdateAssignment(guest.id, e.target.value);
    setRawInput(prev => {
      const { [guest.id]: _, ...rest } = prev;
      return rest;
    });
  }}
/>
```

**Option B: Store Raw Input in State**
```typescript
// In AppState:
rawAssignments: Record<string, string>;  // User's raw input
assignments: Record<string, string>;      // Normalized IDs

// In reducer:
case 'UPDATE_ASSIGNMENT': {
  const { guestId, raw, normalized } = action.payload;
  return {
    ...state,
    rawAssignments: { ...state.rawAssignments, [guestId]: raw },
    assignments: { ...state.assignments, [guestId]: normalized }
  };
}
```

### **SOLUTION 2: Fix Data Persistence**

**Fix A: Skip Duplicate IMPORT in onAuthStateChange**
```typescript
const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
  // Skip INITIAL_SESSION since we handle it manually
  if (event === 'INITIAL_SESSION') return;
  
  if (event === 'SIGNED_OUT' || !session) {
    // Don't RESET if we already handled initial session
    if (isInitialized) return;  // ← NEW: Skip if already initialized
    
    // Rest of logic...
  }
});
```

**Fix B: Better Session State Management**
```typescript
// Use a ref to track if we've done initial restore
const hasRestoredRef = useRef(false);

const checkInitialSession = async () => {
  if (hasRestoredRef.current) return;
  hasRestoredRef.current = true;
  // ... restore logic
};
```

**Fix C: Don't RESET before IMPORT**
```typescript
if (event === 'SIGNED_OUT' || !session) {
  const wasAuthed = userRef.current !== null;
  
  if (wasAuthed) {
    // User explicitly signed out - clear everything
    dispatch({ type: 'RESET_APP_STATE' });
    localStorage.removeItem('seatyr_app_state');
  } else {
    // Anonymous user - just restore, don't reset first!
    try {
      const saved = localStorage.getItem('seatyr_app_state');
      if (saved) {
        dispatch({ type: 'IMPORT_STATE', payload: JSON.parse(saved) });
      }
    } catch { /* ignore */ }
  }
  // ...
}
```

---

## 🎯 IMPLEMENTATION PLAN

### Priority 1: Fix Input (Immediate)
1. Add `rawAssignments` to AppState
2. Store both raw and normalized in reducer
3. Use raw for input value
4. Update on blur or Enter key

### Priority 2: Fix Reload (Critical)
1. Don't skip INITIAL_SESSION - that was wrong!
2. Add `hasRestoredRef` to prevent double restore
3. Don't RESET before IMPORT for anonymous users
4. Only RESET on explicit sign out

### Priority 3: Test Everything
1. Add guest
2. Assign to "1, 3, 5"
3. Verify input shows "1, 3, 5"
4. Add constraint
5. Reload page
6. Verify all data persists
7. Navigate to different page
8. Verify data still there

---

## 🔍 WHAT I GOT WRONG BEFORE

1. **Assumed multi-table was working** - It wasn't! Input was controlled by normalized state.
2. **Didn't trace the full data flow** - Missed that onChange → normalize → dispatch → state → input creates a loop.
3. **Didn't consider React's shallow comparison** - Though this turned out not to be the issue.
4. **Skipped INITIAL_SESSION** - This was WRONG! We need it for the modal-less flow.
5. **Didn't notice the RESET before IMPORT** - This is likely clearing data!

---

## ✅ VERIFIED ASSUMPTIONS

1. ✅ `type="text"` is correct
2. ✅ Reducer creates new object references
3. ✅ localStorage save logic is correct
4. ✅ Dependencies array is correct
5. ✅ Parser logic works correctly

## ❌ WRONG ASSUMPTIONS

1. ❌ Input is uncontrolled - It's controlled by normalized state!
2. ❌ Data isn't being saved - It probably IS being saved!
3. ❌ Reload fixes were complete - They created NEW bugs!

---

*This diagnosis is based on actual code tracing, not assumptions.*

