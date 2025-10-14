# Browser Verification Instructions for UPSERT Fix

## Prerequisites
- Supabase RLS policies applied (see `SUPABASE_RLS_FIX.md`)
- App deployed with UPSERT changes
- User signed in as premium user

## A) Browser Network Tab Verification

### Step 1: Open DevTools
1. Go to your deployed app (e.g., `https://seatyr.com`)
2. Open Chrome DevTools (F12)
3. Go to **Network** tab
4. Filter by `recent_session_states` in the search box

### Step 2: Trigger Auto-save
1. Make a small change (add/remove a guest, change table assignment)
2. Wait for auto-save to trigger (usually within 1-2 seconds)
3. Look for POST requests to `recent_session_states`

### Expected Results:
- ✅ **Status**: 200 or 201 (not 403)
- ✅ **Response**: Should contain `user_id` and `updated_at` fields
- ✅ **No duplicate-key errors**: Multiple rapid changes should all return 200/201

### If you see 403 errors:
Copy the Response body and check:
- Is the user properly authenticated?
- Are the RLS policies applied correctly?
- Is the JWT token valid?

## B) SQL Editor Verification

### Step 1: Set up Authenticated Session
In Supabase SQL Editor, run this to simulate your authenticated user:

```sql
-- Replace <YOUR-USER-ID> with your actual user UUID
select set_config(
  'request.jwt.claims',
  json_build_object('sub','<YOUR-USER-ID>','role','authenticated')::text,
  true
);
```

### Step 2: Test UPSERT
```sql
-- Test UPSERT operation
INSERT INTO public.recent_session_states AS rss (user_id, data)
VALUES (auth.uid(), '{"test": "data", "timestamp": "' || now() || '"}'::jsonb)
ON CONFLICT (user_id) DO UPDATE
SET data = EXCLUDED.data,
    updated_at = now()
RETURNING user_id, updated_at;
```

### Step 3: Verify Row
```sql
-- Check that only one row exists for this user
SELECT user_id, updated_at, data
FROM public.recent_session_states
WHERE user_id = auth.uid();
```

### Expected Results:
- ✅ **One row only**: Should return exactly one row
- ✅ **Fresh timestamp**: `updated_at` should be recent
- ✅ **Correct data**: `data` should contain your test payload

## C) Rapid Successive Changes Test

### Purpose: Verify no duplicate-key errors under load

### Steps:
1. Sign in as premium user
2. Open Network tab with `recent_session_states` filter
3. Rapidly make 5-10 changes (add guests, change assignments)
4. Observe network requests

### Expected Results:
- ✅ **All requests return 200/201**: No 403 or 409 errors
- ✅ **No duplicate-key errors**: All UPSERTs succeed
- ✅ **Consistent behavior**: App doesn't crash or show errors

## D) Cross-User Security Test

### Purpose: Verify users can't access each other's data

### Steps:
1. Sign in as User A, make some changes
2. Sign in as User B (different account)
3. Check that User B cannot see User A's data

### Expected Results:
- ✅ **User B sees only their data**: No access to User A's session state
- ✅ **RLS blocks cross-access**: Attempts to read User A's data fail

## Troubleshooting

### If you see 403 Forbidden:
1. Check that RLS policies are applied:
   ```sql
   SELECT * FROM pg_policies WHERE tablename = 'recent_session_states';
   ```
2. Verify user authentication:
   ```sql
   SELECT auth.uid();
   ```
3. Check policy conditions:
   ```sql
   SELECT auth.uid() = user_id FROM recent_session_states LIMIT 1;
   ```

### If you see duplicate-key errors:
1. Verify UPSERT is being used (not INSERT)
2. Check that `onConflict: 'user_id'` is specified
3. Ensure `user_id` is the primary key

### If you see 409 Conflict:
1. This suggests INSERT is still being used somewhere
2. Search codebase for any remaining `.insert()` calls to these tables
3. Replace with `.upsert(..., { onConflict: 'user_id' })`

## Success Criteria

✅ **All network requests return 200/201**  
✅ **No 403 Forbidden errors**  
✅ **No duplicate-key errors (23505)**  
✅ **Rapid successive changes work smoothly**  
✅ **Users can only access their own data**  
✅ **Auto-save works reliably for premium users**  

## Reporting Issues

If verification fails, please provide:
1. Screenshot of Network tab showing the failed request
2. Response body of the failed request
3. Console error messages
4. User ID (for SQL testing)
5. Steps to reproduce the issue
