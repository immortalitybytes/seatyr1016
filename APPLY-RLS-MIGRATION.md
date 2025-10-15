# Apply RLS Migration - CRITICAL STEP

**IMPORTANT**: This migration must be applied in Supabase to fix the reload and saved settings issues.

---

## Why This Is Required

The code changes fix the race conditions and timing issues, but the database also needs proper Row-Level Security (RLS) policies and indexes to:

1. ✅ Allow users to access their own data
2. ✅ Prevent 403/406 errors when loading saved settings
3. ✅ Improve query performance with user_id indexes
4. ✅ Secure user data so users can only see their own records

---

## How to Apply the Migration

### Step 1: Log into Supabase Dashboard

1. Go to https://app.supabase.com
2. Select your Seatyr project
3. Click **SQL Editor** in the left sidebar

### Step 2: Run the Migration

1. Click **New Query**
2. Copy the ENTIRE contents of this file:
   ```
   supabase/migrations/02_comprehensive_rls_and_indexes.sql
   ```
3. Paste into the SQL Editor
4. Click **Run** (or press Cmd+Enter / Ctrl+Enter)

### Step 3: Verify Success

You should see output like:
```
NOTICE: Missing tables: (none)
NOTICE: Tables missing user_id column: (none)
NOTICE: Comprehensive RLS policies and indexes migration completed successfully
```

If you see notices about missing tables, that's OK - the migration skips those tables safely.

### Step 4: Verify RLS Policies Are Active

1. In Supabase Dashboard, go to **Table Editor**
2. Click on each table:
   - subscriptions
   - trial_subscriptions
   - saved_settings
   - recent_session_states
   - recent_session_settings (if exists)
   - beta_codes (if exists)
   - email_logs (if exists)

3. For each table, click the **RLS** tab (top of page)
4. You should see:
   - ✅ RLS is **enabled** (toggle should be ON)
   - ✅ Policy exists: "Users manage own [table_name]"
   - ✅ Policy is **enabled**

### Step 5: Verify Indexes Created

1. In Supabase Dashboard, go to **Database** → **Indexes**
2. Search for "user_id"
3. You should see indexes like:
   - `subscriptions_user_id_idx`
   - `trial_subscriptions_user_id_idx`
   - `saved_settings_user_id_idx`
   - etc.

---

## What If Migration Fails?

### Error: "relation does not exist"

**Meaning**: One of the tables doesn't exist in your database  
**Solution**: This is normal and safe - the migration skips missing tables

### Error: "permission denied"

**Meaning**: Your Supabase user doesn't have permission to create policies  
**Solution**: 
1. Make sure you're logged in as the project owner
2. Try running in the SQL Editor (not the Functions editor)
3. Contact Supabase support if issue persists

### Error: "policy already exists"

**Meaning**: The policy was already created  
**Solution**: This is safe - the migration is idempotent and will skip existing policies

---

## After Applying Migration

### Test the Application

1. **Hard refresh browser**: Cmd+Shift+R (Mac) or Ctrl+Shift+R (Windows)
2. **Sign in** to your premium account
3. **Check console**: Should NOT see any 403 or 406 errors
4. **Test saved settings**: Create and load multiple settings
5. **Test reload**: Reload browser and verify data persists

### Expected Results

✅ No 403/406 errors in Network tab  
✅ Saved settings load consistently (all of them, not just some)  
✅ Premium status shows correctly without flicker  
✅ Data persists across reloads  
✅ Only 1-2 subscription API calls on page load (not 4+)

---

## Rollback (If Needed)

If the migration causes issues, you can disable RLS temporarily:

```sql
ALTER TABLE public.subscriptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_subscriptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_settings DISABLE ROW LEVEL SECURITY;
-- etc. for each table
```

**WARNING**: This makes your data publicly accessible! Only use for debugging.

---

## Status

- ✅ Migration file created: `supabase/migrations/02_comprehensive_rls_and_indexes.sql`
- ❌ Not yet applied to database
- ❌ Not yet verified

**Next Action**: Apply the migration in Supabase SQL Editor as described above.

---

**Created**: October 15, 2025  
**For Version**: 1015at1225am  
**User**: Daniel Abrams

