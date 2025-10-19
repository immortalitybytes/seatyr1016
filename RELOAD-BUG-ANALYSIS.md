# Reload Bug Analysis - Route-Dependent Behavior

**Date:** October 19, 2025, 2:35 AM  
**Version:** v1019at230am

---

## 🎯 KEY DISCOVERY

**The reload behavior is ROUTE-DEPENDENT:**

| Route | Reload Behavior |
|-------|----------------|
| **Main page** (`/` or `seatyr.com`) | ✅ Sometimes reloads properly |
| **Seating page** (`/seating`) | ❌ Always blanks screen |

This is a **critical clue** that points to a specific type of bug!

---

## 🔍 WHAT THIS TELLS US

### **NOT a General Auth/State Issue**
If it were a general session restore problem, it would fail on ALL routes equally.

### **LIKELY a React Router Issue**
The fact that different routes behave differently suggests:

1. **Route-specific data dependency**
   - Seating page expects certain state
   - State isn't loaded yet on reload
   - Component tries to render before data is ready
   - Crashes or shows blank screen

2. **Nested route initialization**
   - Main page initializes app state
   - Nested routes depend on that state
   - Direct navigation to nested route skips initialization
   - Missing data → blank screen

3. **Component mounting order**
   - Main page: AppContext → loads data → routes render ✓
   - Direct to /seating: Route renders → AppContext not ready → crash ✗

---

## 🔬 TECHNICAL HYPOTHESIS

### **The Invisible Render Gate**

Looking at `AppContext.tsx`:

```typescript
// Invisible render gate (prevents flicker)
if (sessionTag === 'INITIALIZING' || sessionTag === 'AUTHENTICATING') return null;
```

**Problem:** When you reload on `/seating`:
1. React Router tries to render `<SeatingPlanViewer />` immediately
2. But AppContext is still `INITIALIZING`
3. AppProvider returns `null`
4. Entire component tree disappears
5. React Router shows blank screen

**Why main page sometimes works:**
- Main page (`/`) might have a loading state
- Or default route doesn't require data
- Or timing is different

---

## 🧪 PROBABLE ROOT CAUSE

### **SeatingPlanViewer expects state that doesn't exist yet**

When you reload directly on `/seating`:

```typescript
// SeatingPlanViewer.tsx
const { state } = useApp();  // ← state might be initialState (empty)
const currentPlan = state.seatingPlans[state.currentPlanIndex];  // ← undefined!
```

If the component tries to access `state.seatingPlans` before data is loaded:
- `state.seatingPlans` = `[]` (empty array from initialState)
- `state.currentPlanIndex` = `0`
- `currentPlan` = `undefined`
- Component tries to render `undefined.guests` → crash!

---

## 🎯 WHY MY FIX CAUSED BLANK SCREEN

My attempted fixes likely made this worse:

### **The hasRestoredRef Race Condition**

```typescript
const hasRestoredRef = useRef(false);

const checkInitialSession = async () => {
  if (hasRestoredRef.current) return;  // ← Exits early!
  hasRestoredRef.current = true;
  // ... restore data
};
```

**Problem:**
1. User on `/seating` page
2. User reloads
3. AppContext mounts
4. `checkInitialSession` runs
5. Sets `hasRestoredRef.current = true`
6. **But async restore hasn't completed yet!**
7. React Router tries to render `/seating` route
8. `useApp()` returns empty state (restore not done)
9. SeatingPlanViewer tries to access `undefined` data
10. Crash or blank screen

**The timing window:**
```
Time 0ms:  checkInitialSession() starts
Time 1ms:  hasRestoredRef = true (prevents re-entry)
Time 5ms:  React Router renders /seating
Time 10ms: useApp() returns initialState (empty!)
Time 50ms: async restore completes (TOO LATE!)
Time 51ms: SeatingPlanViewer already crashed
```

---

## 🔧 POTENTIAL FIXES

### **Fix 1: Route-Level Loading States**

```tsx
// SeatingPlanViewer.tsx
const SeatingPlanViewer = () => {
  const { state, sessionTag } = useApp();
  
  // Wait for session to be ready
  if (sessionTag === 'INITIALIZING' || sessionTag === 'AUTHENTICATING') {
    return <div>Loading...</div>;
  }
  
  // Wait for data to exist
  if (!state.seatingPlans || state.seatingPlans.length === 0) {
    return <div>No seating plans yet. Generate one first!</div>;
  }
  
  const currentPlan = state.seatingPlans[state.currentPlanIndex];
  // ... rest of component
};
```

### **Fix 2: Redirect to Main on Missing Data**

```tsx
// SeatingPlanViewer.tsx
import { Navigate } from 'react-router-dom';

const SeatingPlanViewer = () => {
  const { state, sessionTag } = useApp();
  
  if (sessionTag !== 'ANON' && sessionTag !== 'ENTITLED') {
    return <div>Loading...</div>;
  }
  
  if (!state.seatingPlans || state.seatingPlans.length === 0) {
    return <Navigate to="/" replace />;
  }
  
  // ... rest of component
};
```

### **Fix 3: Suspend Rendering Until Ready**

```tsx
// AppContext.tsx
if (sessionTag === 'INITIALIZING' || sessionTag === 'AUTHENTICATING') {
  // Instead of return null, show a global loader
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div>Loading Seatyr...</div>
    </div>
  );
}
```

### **Fix 4: Wait for Async Restore to Complete**

```typescript
// AppContext.tsx
const [isRestoring, setIsRestoring] = useState(true);

const checkInitialSession = async () => {
  if (hasRestoredRef.current) return;
  hasRestoredRef.current = true;
  setIsRestoring(true);
  
  try {
    // ... restore logic
  } finally {
    setIsRestoring(false);
  }
};

// In render:
if (isRestoring) return <div>Loading...</div>;
```

---

## 🧪 HOW TO DIAGNOSE

### **Test Case 1: Reproduce the Bug**
1. Go to `seatyr.com`
2. Add guests, generate seating plan
3. Navigate to Seating Plan page
4. Reload browser (Cmd/Ctrl + R)
5. **Expected:** Blank screen
6. Check browser console for errors

### **Test Case 2: Main Page Reload**
1. Go to `seatyr.com`
2. Add guests
3. Reload browser on main page
4. **Expected:** Sometimes works

### **Test Case 3: Direct Navigation**
1. Go directly to `seatyr.com/seating`
2. **Expected:** Blank screen or redirect

### **What to Look For:**
- Console errors like `Cannot read property 'guests' of undefined`
- React Router errors
- AppContext sessionTag value
- State.seatingPlans value

---

## 📊 COMPARISON: ROUTE BEHAVIOR

### **Main Page (`/`):**
```
✓ AppContext initializes
✓ Loads data (or shows empty state)
✓ Renders guest list (works with empty array)
✓ No required data dependencies
```

### **Seating Page (`/seating`):**
```
✗ Requires state.seatingPlans to exist
✗ Requires state.seatingPlans[index] to be defined
✗ Tries to access plan.guests, plan.tables
✗ Crashes if data is undefined
```

---

## 🎯 ROOT CAUSE SUMMARY

**The bug is NOT just about reload.**

It's about:
1. **Route-specific data requirements**
2. **Async initialization timing**
3. **Component mounting before data is ready**
4. **Missing loading states in nested routes**

**Why it's worse after my fixes:**
- My `hasRestoredRef` made timing worse
- Set flag immediately but async restore takes time
- Created larger race condition window

**Why main page sometimes works:**
- Main page doesn't require seatingPlans
- Can render with empty state
- Doesn't crash on missing data

---

## 🚀 RECOMMENDED APPROACH

### **Phase 1: Add Safe Guards (No Risk)**
1. Add loading state to SeatingPlanViewer
2. Check if data exists before rendering
3. Show helpful message if no plans exist
4. This fixes blank screen WITHOUT touching AppContext

### **Phase 2: Fix Timing (Medium Risk)**
1. Add `isRestoring` state to AppContext
2. Wait for async restore to complete
3. Show loader while restoring
4. Only then allow routes to render

### **Phase 3: Data Persistence (High Risk)**
1. Fix the actual reload data loss
2. But only AFTER routes are safe
3. Test extensively locally first

---

## 💡 IMMEDIATE ACTION

**Quick Win: Make SeatingPlanViewer Safe**

This is a **low-risk** fix that doesn't touch AppContext:

```tsx
const SeatingPlanViewer = () => {
  const { state, sessionTag } = useApp();
  
  // Session not ready yet
  if (sessionTag === 'INITIALIZING') {
    return <div>Loading session...</div>;
  }
  
  // No plans generated yet
  if (!state.seatingPlans?.length) {
    return (
      <div>
        <h2>No Seating Plans Yet</h2>
        <p>Go to Guest Manager and generate a plan first!</p>
        <Link to="/">Back to Guest Manager</Link>
      </div>
    );
  }
  
  // Safe to render
  const currentPlan = state.seatingPlans[state.currentPlanIndex];
  // ... existing code
};
```

This would:
- ✅ Fix blank screen on reload
- ✅ Show helpful message
- ✅ No risk to other pages
- ✅ No AppContext changes needed

---

*Route-dependent behavior is the key to solving this bug.*

