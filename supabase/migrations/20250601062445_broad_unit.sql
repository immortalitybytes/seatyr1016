/*
  # Analytics and Reporting Functions
  
  1. New Functions
    - `get_subscription_growth_rate` - Calculate growth rate between two time periods
    - `get_trial_conversion_rate` - Calculate what percentage of trials convert to paid
    - `get_retention_rate` - Calculate retention rate over a specified period
    - `get_subscription_health` - Overall subscription health score
  
  2. Security
    - Functions use security definer to allow service_role access to secure data
    - Fixed search_path to prevent SQL injection
*/

-- Subscription Growth Rate Function
CREATE OR REPLACE FUNCTION public.get_subscription_growth_rate(
  period_start timestamp with time zone,
  period_end timestamp with time zone
)
RETURNS TABLE (
  new_subscriptions bigint,
  previous_period_subscriptions bigint,
  growth_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  period_length interval;
  previous_period_start timestamp with time zone;
  previous_period_end timestamp with time zone;
BEGIN
  -- Calculate the length of the requested period
  period_length := period_end - period_start;
  
  -- Calculate the previous period with the same length
  previous_period_end := period_start;
  previous_period_start := period_start - period_length;
  
  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM subscriptions 
     WHERE created >= period_start AND created < period_end) AS new_subscriptions,
    (SELECT COUNT(*) FROM subscriptions 
     WHERE created >= previous_period_start AND created < previous_period_end) AS previous_period_subscriptions,
    CASE
      WHEN (SELECT COUNT(*) FROM subscriptions 
            WHERE created >= previous_period_start AND created < previous_period_end) = 0 THEN NULL
      ELSE (
        ((SELECT COUNT(*) FROM subscriptions 
          WHERE created >= period_start AND created < period_end)::numeric /
         (SELECT COUNT(*) FROM subscriptions 
          WHERE created >= previous_period_start AND created < previous_period_end)::numeric) - 1
      ) * 100
    END AS growth_rate;
END;
$$;

-- Trial Conversion Rate Function
CREATE OR REPLACE FUNCTION public.get_trial_conversion_rate(
  start_date timestamp with time zone DEFAULT NULL,
  end_date timestamp with time zone DEFAULT NULL
)
RETURNS TABLE (
  total_trials bigint,
  converted_trials bigint,
  conversion_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actual_start_date timestamp with time zone;
  actual_end_date timestamp with time zone;
BEGIN
  -- Set default date range if not provided
  actual_start_date := COALESCE(start_date, '2025-01-01'::timestamp with time zone);
  actual_end_date := COALESCE(end_date, CURRENT_TIMESTAMP);
  
  RETURN QUERY
  WITH completed_trials AS (
    SELECT
      t.id,
      t.user_id,
      t.start_date,
      t.expires_on,
      EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.user_id = t.user_id
          AND s.status IN ('active', 'trialing', 'past_due')
          AND s.created > t.start_date
          AND s.created < t.expires_on + interval '7 days' -- Allow 7 days after trial for conversion
      ) AS converted
    FROM trial_subscriptions t
    WHERE t.start_date >= actual_start_date
      AND t.start_date < actual_end_date
      AND t.expires_on < CURRENT_TIMESTAMP -- Only include completed trials
  )
  SELECT
    COUNT(*) AS total_trials,
    COUNT(*) FILTER (WHERE converted) AS converted_trials,
    CASE
      WHEN COUNT(*) = 0 THEN 0
      ELSE ROUND((COUNT(*) FILTER (WHERE converted))::numeric / COUNT(*)::numeric * 100, 2)
    END AS conversion_rate
  FROM completed_trials;
END;
$$;

-- Retention Rate Function
CREATE OR REPLACE FUNCTION public.get_retention_rate(
  cohort_start_date timestamp with time zone,
  cohort_end_date timestamp with time zone,
  retention_period interval
)
RETURNS TABLE (
  cohort_size bigint,
  retained_users bigint,
  retention_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  WITH cohort AS (
    SELECT DISTINCT s.user_id
    FROM subscriptions s
    WHERE s.created >= cohort_start_date AND s.created < cohort_end_date
  ),
  retained AS (
    SELECT c.user_id
    FROM cohort c
    WHERE EXISTS (
      SELECT 1 
      FROM subscriptions s
      WHERE s.user_id = c.user_id
        AND s.status = 'active'
        AND s.created < (cohort_end_date + retention_period)
        AND (s.ended_at IS NULL OR s.ended_at > (cohort_end_date + retention_period))
    )
  )
  SELECT
    COUNT(*)::bigint AS cohort_size,
    (SELECT COUNT(*)::bigint FROM retained) AS retained_users,
    CASE
      WHEN COUNT(*) = 0 THEN 0
      ELSE ROUND((SELECT COUNT(*) FROM retained)::numeric / COUNT(*)::numeric * 100, 2)
    END AS retention_rate
  FROM cohort;
END;
$$;

-- Subscription Health Score Function
CREATE OR REPLACE FUNCTION public.get_subscription_health()
RETURNS TABLE (
  active_subscriptions bigint,
  cancellations_last_30_days bigint,
  past_due_subscriptions bigint,
  new_subscriptions_last_30_days bigint,
  trial_conversion_rate numeric,
  churn_rate numeric,
  overall_health_score numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  active_count bigint;
  cancellation_count bigint;
  past_due_count bigint;
  new_sub_count bigint;
  conversion_rate_val numeric;
  churn_rate_val numeric;
  health_score numeric;
BEGIN
  -- Get active subscriptions
  SELECT COUNT(*) INTO active_count
  FROM subscriptions
  WHERE status = 'active';
  
  -- Get cancellations in last 30 days
  SELECT COUNT(*) INTO cancellation_count
  FROM subscriptions
  WHERE status = 'canceled'
    AND canceled_at > CURRENT_TIMESTAMP - interval '30 days';
  
  -- Get past due subscriptions
  SELECT COUNT(*) INTO past_due_count
  FROM subscriptions
  WHERE status = 'past_due';
  
  -- Get new subscriptions in last 30 days
  SELECT COUNT(*) INTO new_sub_count
  FROM subscriptions
  WHERE created > CURRENT_TIMESTAMP - interval '30 days';
  
  -- Get trial conversion rate
  SELECT conversion_rate INTO conversion_rate_val
  FROM get_trial_conversion_rate(CURRENT_TIMESTAMP - interval '90 days', CURRENT_TIMESTAMP);
  
  -- Calculate churn rate
  churn_rate_val := CASE
    WHEN active_count = 0 THEN 100
    ELSE ROUND((cancellation_count::numeric / NULLIF(active_count::numeric, 0)) * 100, 2)
  END;
  
  -- Calculate health score (simple formula: 100 - churn_rate + (conversion_rate/10))
  health_score := GREATEST(0, LEAST(100, 100 - churn_rate_val + (conversion_rate_val/10)));
  
  RETURN QUERY
  SELECT
    active_count,
    cancellation_count,
    past_due_count,
    new_sub_count,
    conversion_rate_val,
    churn_rate_val,
    health_score;
END;
$$;

-- Grant access to service role
GRANT EXECUTE ON FUNCTION public.get_subscription_growth_rate TO service_role;
GRANT EXECUTE ON FUNCTION public.get_trial_conversion_rate TO service_role;
GRANT EXECUTE ON FUNCTION public.get_retention_rate TO service_role;
GRANT EXECUTE ON FUNCTION public.get_subscription_health TO service_role;