-- ============================================================================
-- Phase A: Database Hardening for Seatyr (PRODUCTION-READY)
-- ============================================================================
-- Purpose: Eliminate duplicates, enforce uniqueness, optimize queries, enable RLS
-- Safety: Run inside a transaction; ROLLBACK if counts look wrong
-- Version: 2.0 (incorporating Supabase recommendations)
-- ============================================================================

BEGIN;

-- ============================================================================
-- PREFLIGHT: Preview Duplicate Counts (Optional but Recommended)
-- ============================================================================
-- Run this first to see what will be deleted

SELECT 'PREFLIGHT DUPLICATE COUNTS' AS section;

SELECT 'subscriptions dupes' AS scope, COUNT(*) AS dupe_user_count FROM (
  SELECT user_id FROM public.subscriptions GROUP BY user_id HAVING COUNT(*) > 1
) s
UNION ALL
SELECT 'trial_subscriptions dupes', COUNT(*) FROM (
  SELECT user_id FROM public.trial_subscriptions GROUP BY user_id HAVING COUNT(*) > 1
) t
UNION ALL
SELECT 'recent_session_states dupes', COUNT(*) FROM (
  SELECT user_id FROM public.recent_session_states GROUP BY user_id HAVING COUNT(*) > 1
) rs
UNION ALL
SELECT 'recent_session_settings dupes', COUNT(*) FROM (
  SELECT user_id FROM public.recent_session_settings GROUP BY user_id HAVING COUNT(*) > 1
) rset;

-- ============================================================================
-- A1) DETERMINISTIC DE-DUPLICATION
-- ============================================================================
-- Keep the most recent/relevant row per user_id and delete all others
-- Using DELETE ... RETURNING pattern for accurate row counts

-- Subscriptions: keep the row with latest current_period_end
WITH ranked_subs AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY current_period_end DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.subscriptions
),
deleted AS (
  DELETE FROM public.subscriptions s
  USING ranked_subs r
  WHERE s.id = r.id AND r.rn > 1
  RETURNING 1
)
SELECT 'Subscriptions deduplication complete. Rows deleted: ' || COUNT(*) AS result
FROM deleted;

-- Trials: keep the latest-expiring per user
WITH ranked_trials AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY expires_on DESC NULLS LAST, id DESC
         ) AS rn
  FROM public.trial_subscriptions
),
deleted AS (
  DELETE FROM public.trial_subscriptions t
  USING ranked_trials r
  WHERE t.id = r.id AND r.rn > 1
  RETURNING 1
)
SELECT 'Trial subscriptions deduplication complete. Rows deleted: ' || COUNT(*) AS result
FROM deleted;

-- Recent session states: keep newest per user (with guarded timestamp casting)
-- Note: Using ctid (physical row identifier) since this table may not have an 'id' column
WITH ranked_states AS (
  SELECT ctid,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY COALESCE(
             CASE
               WHEN (data->>'timestamp') ~ '^\d{4}-\d{2}-\d{2}[T ]' 
                 THEN (data->>'timestamp')::timestamptz
               ELSE NULL
             END,
             updated_at,
             created_at,
             '1970-01-01'::timestamptz
           ) DESC
         ) AS rn
  FROM public.recent_session_states
),
deleted AS (
  DELETE FROM public.recent_session_states s
  USING ranked_states r
  WHERE s.ctid = r.ctid AND r.rn > 1
  RETURNING 1
)
SELECT 'Recent session states deduplication complete. Rows deleted: ' || COUNT(*) AS result
FROM deleted;

-- Recent session settings: keep newest per user (with guarded timestamp casting)
-- Note: Using ctid (physical row identifier) since this table may not have an 'id' column
WITH ranked_settings AS (
  SELECT ctid,
         ROW_NUMBER() OVER (
           PARTITION BY user_id
           ORDER BY COALESCE(
             CASE
               WHEN (data->>'timestamp') ~ '^\d{4}-\d{2}-\d{2}[T ]' 
                 THEN (data->>'timestamp')::timestamptz
               ELSE NULL
             END,
             updated_at,
             created_at,
             '1970-01-01'::timestamptz
           ) DESC
         ) AS rn
  FROM public.recent_session_settings
),
deleted AS (
  DELETE FROM public.recent_session_settings s
  USING ranked_settings r
  WHERE s.ctid = r.ctid AND r.rn > 1
  RETURNING 1
)
SELECT 'Recent session settings deduplication complete. Rows deleted: ' || COUNT(*) AS result
FROM deleted;

-- ============================================================================
-- A2) ENFORCE UNIQUENESS (prevents future PGRST116 errors)
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_unique 
  ON public.subscriptions(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS trial_subscriptions_user_unique 
  ON public.trial_subscriptions(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS recent_session_states_user_unique 
  ON public.recent_session_states(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS recent_session_settings_user_unique 
  ON public.recent_session_settings(user_id);

-- Sanity check: should return 0 rows; if not, STOP and re-run A1
DO $$
DECLARE
  dupe_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO dupe_count
  FROM (
    SELECT user_id
    FROM public.subscriptions
    GROUP BY user_id
    HAVING COUNT(*) > 1
  ) dupes;
  
  IF dupe_count > 0 THEN
    RAISE EXCEPTION 'Found % users with duplicate subscriptions! Re-run A1', dupe_count;
  ELSE
    RAISE NOTICE 'Uniqueness verified: no duplicate subscriptions remain';
  END IF;
END $$;

-- ============================================================================
-- A3) PERFORMANCE INDEXES
-- ============================================================================

-- Remove any accidental UNIQUE constraint or index on saved_settings
-- Try both constraint and index drops to be safe (schema-qualified for safety)
ALTER TABLE public.saved_settings DROP CONSTRAINT IF EXISTS saved_settings_user_id_key;
DROP INDEX IF EXISTS public.saved_settings_user_id_key;

-- Add performance indexes for saved_settings (multi-row per user allowed)
CREATE INDEX IF NOT EXISTS idx_saved_settings_user_id 
  ON public.saved_settings (user_id);

CREATE INDEX IF NOT EXISTS idx_saved_settings_user_updated_at 
  ON public.saved_settings (user_id, updated_at DESC);

-- Add indexes to support deduplication queries and common filters
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_period 
  ON public.subscriptions(user_id, current_period_end DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS idx_trial_subscriptions_user_expires 
  ON public.trial_subscriptions(user_id, expires_on DESC NULLS LAST, id DESC);

CREATE INDEX IF NOT EXISTS idx_recent_states_user_updated 
  ON public.recent_session_states(user_id, updated_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_recent_settings_user_updated 
  ON public.recent_session_settings(user_id, updated_at DESC NULLS LAST);

-- ============================================================================
-- A4) ROW-LEVEL SECURITY (RLS)
-- ============================================================================
-- Note: Service role (used by Edge Functions) bypasses RLS automatically

-- Ensure authenticated role has necessary grants
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.trial_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recent_session_states TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.recent_session_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.saved_settings TO authenticated;

-- Enable RLS and create policies
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own subscription" ON public.subscriptions;
CREATE POLICY "Users can manage own subscription" 
  ON public.subscriptions 
  FOR ALL 
  TO authenticated 
  USING ((SELECT auth.uid()) = user_id) 
  WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER TABLE public.trial_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own trial" ON public.trial_subscriptions;
CREATE POLICY "Users can manage own trial" 
  ON public.trial_subscriptions 
  FOR ALL 
  TO authenticated 
  USING ((SELECT auth.uid()) = user_id) 
  WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER TABLE public.recent_session_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own recent state" ON public.recent_session_states;
CREATE POLICY "Users can manage own recent state" 
  ON public.recent_session_states 
  FOR ALL 
  TO authenticated 
  USING ((SELECT auth.uid()) = user_id) 
  WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER TABLE public.recent_session_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own recent settings" ON public.recent_session_settings;
CREATE POLICY "Users can manage own recent settings" 
  ON public.recent_session_settings 
  FOR ALL 
  TO authenticated 
  USING ((SELECT auth.uid()) = user_id) 
  WITH CHECK ((SELECT auth.uid()) = user_id);

ALTER TABLE public.saved_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own saved settings" ON public.saved_settings;
CREATE POLICY "Users can manage own saved settings" 
  ON public.saved_settings 
  FOR ALL 
  TO authenticated 
  USING ((SELECT auth.uid()) = user_id) 
  WITH CHECK ((SELECT auth.uid()) = user_id);

-- ============================================================================
-- A5) VERIFICATION QUERIES
-- ============================================================================

-- Verify unique indexes were created
DO $$
DECLARE
  index_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO index_count
  FROM pg_indexes
  WHERE indexname IN (
    'subscriptions_user_unique',
    'trial_subscriptions_user_unique',
    'recent_session_states_user_unique',
    'recent_session_settings_user_unique'
  );
  
  IF index_count = 4 THEN
    RAISE NOTICE 'Verification PASS: All 4 unique indexes created';
  ELSE
    RAISE WARNING 'Verification FAIL: Expected 4 unique indexes, found %', index_count;
  END IF;
END $$;

-- Verify RLS is enabled (using pg_class.relrowsecurity)
DO $$
DECLARE
  rls_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO rls_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN (
      'subscriptions', 
      'trial_subscriptions', 
      'recent_session_states', 
      'recent_session_settings', 
      'saved_settings'
    )
    AND c.relkind = 'r'
    AND c.relrowsecurity = true;
  
  IF rls_count = 5 THEN
    RAISE NOTICE 'Verification PASS: RLS enabled on all 5 tables';
  ELSE
    RAISE WARNING 'Verification FAIL: Expected RLS on 5 tables, found %', rls_count;
  END IF;
END $$;

-- Verify exact policies were created (resilient to extra policies)
DO $$
DECLARE
  missing_count INTEGER;
BEGIN
  SELECT 5 - COUNT(*)
  INTO missing_count
  FROM pg_policies
  WHERE (schemaname, tablename, policyname) IN (
    ('public','subscriptions','Users can manage own subscription'),
    ('public','trial_subscriptions','Users can manage own trial'),
    ('public','recent_session_states','Users can manage own recent state'),
    ('public','recent_session_settings','Users can manage own recent settings'),
    ('public','saved_settings','Users can manage own saved settings')
  );
  
  IF missing_count = 0 THEN
    RAISE NOTICE 'Verification PASS: All expected RLS policies present';
  ELSE
    RAISE WARNING 'Verification FAIL: % RLS policies missing', missing_count;
  END IF;
END $$;

-- ============================================================================
-- FINAL SUMMARY
-- ============================================================================

SELECT 
  'Phase A Database Hardening Complete' AS status,
  NOW() AS completed_at;

-- ============================================================================
-- DECISION POINT: Review output above
-- ============================================================================
-- If all verifications PASS and deletion counts look correct:
--   → Uncomment COMMIT below and run it
--
-- If anything looks wrong:
--   → Uncomment ROLLBACK below to undo all changes
-- ============================================================================

-- COMMIT;    -- Uncomment to commit changes
-- ROLLBACK;  -- Uncomment to rollback if something looks wrong
