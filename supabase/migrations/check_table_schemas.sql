-- Quick diagnostic to check what columns exist in each table
-- Run this first to see the actual schema

SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'subscriptions',
    'trial_subscriptions',
    'recent_session_states',
    'recent_session_settings',
    'saved_settings'
  )
ORDER BY table_name, ordinal_position;

