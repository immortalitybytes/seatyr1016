<!-- a1976a21-bd84-4753-9f2a-87e89e9949e5 520117a2-27be-424e-b559-952e5457b9fc -->
# Fix isPremium Race Condition (Hybrid Approach)

## Root Cause

Console shows `isPremium: false` when it should be `true`, causing:

- RLS blocking Supabase queries (manifesting as network errors)
- Saved settings fetch loops (`ERR_INSUFFICIENT_RESOURCES`)
- Table renames not persisting
- Multi-table assignment instability

## Phase 1: Create Local Environment (IMMEDIATE)

**A1. Create `.env.local`**

```bash
VITE_SUPABASE_URL=https://xuakhnuxkxjopfrshsny.supabase.co
VITE_SUPABASE_ANON_KEY=<from-supabase-dashboard>
```

**A2. Restart dev server**

```bash
# Kill current server (Ctrl+C)
npm run dev
```

## Phase 2: Add Entitlement Fetch Guards (SURGICAL)

**B1. Read and analyze current code**

Files to examine:

- `src/context/AppContext.tsx` - Check auth listener and `loadEntitlementsOnce`
- `src/utils/premium.ts` - Verify `isPremiumSubscription` logic
- `src/types.ts` or `src/types/index.ts` - Check `AppState` definition

**B2. Update `AppState` type (if not already present)**

In `src/types.ts` or wherever `AppState` is defined:

```typescript
export interface AppState {
  // ... existing fields
  loadedEntitlements: boolean; // Add this flag
}
```

**B3. Update `AppContext.tsx` initialization**

```typescript
const initialState: AppState = {
  // ... existing fields
  loadedEntitlements: false, // Add this
};
```

**B4. Add reducer case**

```typescript
case 'SET_LOADED_ENTITLEMENTS':
  return { ...state, loadedEntitlements: action.payload };
```

**B5. Fix auth listener INITIAL_SESSION handler**

Replace the existing INITIAL_SESSION block with:

```typescript
if (event === 'INITIAL_SESSION') {
  if (session?.user) {
    dispatch({ type: 'SET_USER', payload: session.user });
    userRef.current = session.user;

    try {
      const { subscription, trial } = await loadEntitlementsOnce(session.user.id);
      console.log('[ENTITLEMENT DEBUG]', { 
        subscription, 
        trial, 
        isPremium: isPremiumSubscription(subscription, trial) 
      });
      
      dispatch({ type: 'SET_SUBSCRIPTION', payload: subscription });
      dispatch({ type: 'SET_TRIAL', payload: trial });
      dispatch({ type: 'SET_LOADED_ENTITLEMENTS', payload: true });
      setSessionTag('ENTITLED');

      // PATH B: Auto-restore if premium
      if (isPremiumSubscription(subscription, trial)) {
        try {
          const data = await getMostRecentState(session.user.id);
          if (mounted && data?.guests?.length > 0) {
            dispatch({ type: 'LOAD_MOST_RECENT', payload: data });
          }
        } catch (err) {
          console.error('[Auto-restore failed]', err);
        }
      }
    } catch (err) {
      console.error('[Entitlements fetch failed]', err);
      // CRITICAL: Graceful degradation
      setSessionTag('ANON');
      dispatch({ type: 'SET_SUBSCRIPTION', payload: null });
      dispatch({ type: 'SET_TRIAL', payload: null });
      dispatch({ type: 'SET_LOADED_ENTITLEMENTS', payload: true });
    }
  } else {
    setSessionTag('ANON');
    dispatch({ type: 'SET_LOADED_ENTITLEMENTS', payload: true });
  }
}
```

## Phase 3: Fix Fetch Loops in Saved Settings

**C1. Fix `SavedSettingsAccordion.tsx`**

Add in-flight guard and proper dependencies:

```typescript
const inFlightFetch = useRef(false);
const [reloadKey, setReloadKey] = useState(0);

useEffect(() => {
  // Wait for entitlements to load
  if (sessionTag !== 'ENTITLED' || !user?.id || !state.loadedEntitlements) {
    setSettings([]);
    setLoading(false);
    return;
  }

  // Prevent re-entrant fetches
  if (inFlightFetch.current) return;
  inFlightFetch.current = true;

  const ac = new AbortController();
  setLoading(true);
  setError(null);

  supabase
    .from('recent_session_settings') // CORRECT table name
    .select('id, name, updated_at, data')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(50)
    .abortSignal(ac.signal)
    .then(({ data, error }) => {
      if (error && error.name !== 'AbortError') {
        setError(error.message);
      } else if (data) {
        setSettings(data ?? []);
      }
    })
    .finally(() => {
      if (!ac.signal.aborted) {
        setLoading(false);
        inFlightFetch.current = false;
      }
    });

  return () => {
    ac.abort();
    inFlightFetch.current = false;
  };
}, [sessionTag, user?.id, state.loadedEntitlements, reloadKey]);
```

**C2. Apply same fix to `SavedSettings.tsx`**

Duplicate the pattern from C1.

## Phase 4: Improve Autosave Stability (OPTIONAL)

**D1. Add simple hash-based change detection**

Only if current autosave is causing unnecessary writes:

```typescript
// Near top of AppContext.tsx
function simpleHash(obj: any): string {
  return JSON.stringify(obj).split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0).toString(36);
}

// Before autosave useEffect
const autosavePayload = useMemo(() => ({
  guests: state.guests,
  tables: state.tables,
  constraints: state.constraints,
  adjacents: state.adjacents,
  assignments: state.assignments,
  timestamp: state.timestamp,
  userSetTables: state.userSetTables,
}), [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.timestamp, state.userSetTables]);

const autosaveSignature = useMemo(() => simpleHash(autosavePayload), [autosavePayload]);
const lastSigRef = useRef('');

// In autosave useEffect
if (autosaveSignature === lastSigRef.current) return;

// After successful save
lastSigRef.current = autosaveSignature;
```

## Phase 5: Fix Table Rename Persistence

**E1. In reducer LOAD_MOST_RECENT case**

```typescript
case 'LOAD_MOST_RECENT':
case 'LOAD_SAVED_SETTING': {
  const incoming = action.payload;
  if (!incoming || !incoming.guests) return state;

  return {
    ...initialState,
    ...incoming,
    // CRITICAL: Preserve saved tables
    tables: (incoming.tables?.length > 0) ? incoming.tables : defaultTables,
    user: state.user,
    subscription: state.subscription,
    trial: state.trial,
    loadedEntitlements: state.loadedEntitlements,
    seatingPlans: [],
    currentPlanIndex: 0,
    warnings: [],
  };
}
```

## Phase 6: Verification

**F1. Build check**

```bash
npm run build
npx tsc --noEmit
```

**F2. Network test (premium)**

- Sign in → Navigate to /seating → Hard reload
- ✅ Expect: ONE fetch to `recent_session_states`, no loops

**F3. Saved settings test**

- Navigate to saved settings page
- ✅ Expect: Loads once, no spinner stuck

**F4. Table rename persistence**

- Rename "Table 1" to "Head Table"
- Navigate away and back
- Hard reload
- ✅ Expect: "Head Table" persists

**F5. Assignment persistence**

- Assign guest to "1, 3, 5"
- Navigate away, reload
- ✅ Expect: Assignment persists

**F6. Anonymous persistence**

- Log out, add guests in incognito
- Hard reload
- ✅ Expect: Guests persist from localStorage

## Critical Success Factors

1. **`.env.local` MUST exist** - Without it, entitlements can't be fetched locally
2. **`AppState` type MUST be updated** - Otherwise TypeScript will fail
3. **Correct table name** - Use `recent_session_settings` not `saved_settings`
4. **In-flight guards** - Prevent fetch loops
5. **Graceful degradation** - Even if entitlement fetch fails, app should function

## Files Modified

- `.env.local` (create)
- `src/types.ts` or `src/types/index.ts` (add `loadedEntitlements`)
- `src/context/AppContext.tsx` (auth listener, reducer, flags)
- `src/components/SavedSettingsAccordion.tsx` (fetch guard)
- `src/pages/SavedSettings.tsx` (fetch guard)

### To-dos

- [ ] Get VITE_SUPABASE_ANON_KEY from Supabase Dashboard (USER ACTION)
- [ ] Create .env.local with Supabase credentials
- [ ] Read src/types.ts or src/types/index.ts to find AppState definition
- [ ] Read src/context/AppContext.tsx to analyze current auth listener
- [ ] Read src/utils/premium.ts to verify isPremiumSubscription
- [ ] Add loadedEntitlements: boolean to AppState interface
- [ ] Add loadedEntitlements: false to initialState
- [ ] Add SET_LOADED_ENTITLEMENTS reducer case
- [ ] Update INITIAL_SESSION handler with error handling and entitlement flag
- [ ] Add in-flight guard and loadedEntitlements dependency to SavedSettingsAccordion.tsx
- [ ] Add in-flight guard and loadedEntitlements dependency to SavedSettings.tsx
- [ ] Update LOAD_MOST_RECENT to preserve saved tables over defaultTables
- [ ] Restart dev server to load .env.local
- [ ] Run npm run build and tsc --noEmit
- [ ] Test premium reload for single fetch, no loops
- [ ] Verify saved settings load without infinite spinner
- [ ] Verify table renames persist across navigation and reload
- [ ] Verify multi-table assignments persist
- [ ] Verify anonymous localStorage persistence works