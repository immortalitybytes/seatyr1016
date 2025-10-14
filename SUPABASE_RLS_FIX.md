# Supabase RLS Policy Fix for recent_session_states Table

## Problem
HTTP 403 errors when accessing `recent_session_states` table:
```
Failed to load resource: the server responded with a status of 403 (Forbidden)
Error saving most recent state: new row violates row-level security policy for table "recent_session_states"
```

## Root Cause
The `recent_session_states` table has Row-Level Security (RLS) enabled but lacks proper policies to allow authenticated users to read/write their own data.

## Solution
Execute these SQL commands in your Supabase SQL Editor:

### 1. Enable RLS (if not already enabled)
```sql
ALTER TABLE recent_session_states ENABLE ROW LEVEL SECURITY;
```

### 2. Create Policy for Users to Read Their Own Data
```sql
CREATE POLICY "Users can read their own recent session state" ON recent_session_states
FOR SELECT USING (auth.uid() = user_id);
```

### 3. Create Policy for Users to Insert Their Own Data
```sql
CREATE POLICY "Users can insert their own recent session state" ON recent_session_states
FOR INSERT WITH CHECK (auth.uid() = user_id);
```

### 4. Create Policy for Users to Update Their Own Data
```sql
CREATE POLICY "Users can update their own recent session state" ON recent_session_states
FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

### 5. Create Policy for Users to Delete Their Own Data
```sql
CREATE POLICY "Users can delete their own recent session state" ON recent_session_states
FOR DELETE USING (auth.uid() = user_id);
```

## Alternative: Single Comprehensive Policy
If you prefer a single policy that covers all operations:

```sql
-- Drop existing policies first (if any)
DROP POLICY IF EXISTS "Users can read their own recent session state" ON recent_session_states;
DROP POLICY IF EXISTS "Users can insert their own recent session state" ON recent_session_states;
DROP POLICY IF EXISTS "Users can update their own recent session state" ON recent_session_states;
DROP POLICY IF EXISTS "Users can delete their own recent session state" ON recent_session_states;

-- Create comprehensive policy
CREATE POLICY "Users can manage their own recent session state" ON recent_session_states
FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

## Verification
After applying these policies:

1. **Test as Premium User**:
   - Sign in to the app
   - Make changes to guests/tables
   - Reload the page
   - Should see "Most Recent" restore modal

2. **Check Console**:
   - No more 403 errors for `recent_session_states`
   - Auto-save should work without errors

3. **Test Cross-User Security**:
   - User A should not be able to access User B's session data
   - Anonymous users should not be able to access any session data

## Additional Tables to Check
If you're still getting 403 errors, also check these tables:

### subscriptions table
```sql
CREATE POLICY "Users can read their own subscription" ON subscriptions
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own subscription" ON subscriptions
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own subscription" ON subscriptions
FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

### trial_subscriptions table
```sql
CREATE POLICY "Users can read their own trial subscription" ON trial_subscriptions
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own trial subscription" ON trial_subscriptions
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own trial subscription" ON trial_subscriptions
FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

### saved_settings table
```sql
CREATE POLICY "Users can manage their own saved settings" ON saved_settings
FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

## Testing Commands
After applying policies, test with these SQL queries:

```sql
-- Test read access (should work for authenticated users)
SELECT * FROM recent_session_states WHERE user_id = auth.uid();

-- Test insert access (should work for authenticated users)
INSERT INTO recent_session_states (user_id, data) 
VALUES (auth.uid(), '{"test": "data"}');

-- Test update access (should work for authenticated users)
UPDATE recent_session_states 
SET data = '{"updated": "data"}' 
WHERE user_id = auth.uid();

-- Test delete access (should work for authenticated users)
DELETE FROM recent_session_states WHERE user_id = auth.uid();
```

## Notes
- These policies assume your `user_id` column stores UUID values that match `auth.uid()`
- If your `user_id` column has a different name or type, adjust the policies accordingly
- Always test policies in a development environment first
- Consider adding indexes on `user_id` columns for better performance
