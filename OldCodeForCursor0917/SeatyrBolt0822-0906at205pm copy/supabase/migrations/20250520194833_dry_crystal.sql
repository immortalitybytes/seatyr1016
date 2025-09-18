/*
  # Security improvements for subscription logic
  
  1. Changes
    - Replace user_subscription_status view to NOT use SECURITY DEFINER
    - Add get_max_saved_settings function with fixed search_path
  
  2. Security
    - Removes SECURITY DEFINER from view
    - Adds SET search_path = public to function to prevent search path vulnerabilities
    - Maintains RLS protections throughout
*/

-- Drop existing view if it exists
DROP VIEW IF EXISTS public.user_subscription_status;

-- Recreate the view without SECURITY DEFINER
CREATE VIEW public.user_subscription_status AS
SELECT
  u.id AS user_id,
  s.status AS subscription_status,
  s.current_period_end,
  s.cancel_at_period_end,
  t.expires_on AS trial_expires_on
FROM auth.users u
LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status = 'active' AND s.current_period_end > NOW()
LEFT JOIN trial_subscriptions t ON t.user_id = u.id AND t.expires_on > NOW();

-- Grant SELECT permission to authenticated users
GRANT SELECT ON public.user_subscription_status TO authenticated;

-- Create or replace the function with fixed search_path
CREATE OR REPLACE FUNCTION public.get_max_saved_settings(user_id UUID)
RETURNS INTEGER
LANGUAGE sql
SET search_path = public
AS $$
  SELECT
    CASE
      WHEN EXISTS (
        SELECT 1 FROM subscriptions
        WHERE subscriptions.user_id = user_id
          AND subscriptions.status = 'active'
          AND subscriptions.current_period_end > NOW()
      )
      THEN 50
      WHEN EXISTS (
        SELECT 1 FROM trial_subscriptions
        WHERE trial_subscriptions.user_id = user_id
          AND trial_subscriptions.expires_on > NOW()
      )
      THEN 50
      ELSE 5
  END;
$$;