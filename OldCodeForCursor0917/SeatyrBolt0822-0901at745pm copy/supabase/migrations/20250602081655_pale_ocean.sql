-- Create views for subscription analytics dashboard
-- These views are designed to provide aggregated metrics for the admin dashboard

-- 1. Daily metrics summary view
CREATE OR REPLACE VIEW public.daily_metrics_summary AS
SELECT
  COUNT(DISTINCT u.id) AS total_users,
  (SELECT COUNT(*) FROM public.subscriptions WHERE status = 'active') AS active_subscriptions,
  (SELECT COUNT(*) FROM public.subscriptions WHERE status = 'past_due') AS past_due_subscriptions,
  (SELECT COUNT(*) FROM public.subscriptions WHERE status = 'canceled' AND canceled_at > CURRENT_TIMESTAMP - INTERVAL '30 days') AS recent_cancellations,
  (SELECT COUNT(*) FROM public.trial_subscriptions WHERE expires_on > CURRENT_TIMESTAMP) AS active_trials,
  (SELECT COUNT(*) FROM public.saved_settings) AS total_saved_settings,
  (SELECT COUNT(DISTINCT user_id) FROM public.recent_session_states WHERE updated_at > CURRENT_TIMESTAMP - INTERVAL '7 days') AS active_users_last_7_days
FROM auth.users u;

COMMENT ON VIEW public.daily_metrics_summary IS 'Summary metrics for the admin dashboard showing current counts of users, subscriptions and trials';

-- 2. Subscription metrics over time
CREATE OR REPLACE VIEW public.subscription_analytics AS
WITH dates AS (
  SELECT generate_series(
    date_trunc('day', CURRENT_DATE - INTERVAL '90 days'),
    date_trunc('day', CURRENT_DATE),
    '1 day'::interval
  )::date AS date
)
SELECT
  d.date,
  COUNT(s.id) FILTER (WHERE s.created::date = d.date) AS new_subscriptions,
  COUNT(s.id) FILTER (WHERE s.status = 'active' AND d.date BETWEEN s.current_period_start::date AND s.current_period_end::date) AS active_subscriptions,
  COUNT(s.id) FILTER (WHERE s.status = 'past_due' AND d.date BETWEEN s.current_period_start::date AND s.current_period_end::date) AS past_due_subscriptions,
  COUNT(s.id) FILTER (WHERE s.status = 'canceled' AND s.canceled_at::date = d.date) AS cancellations,
  COUNT(s.id) FILTER (WHERE s.cancel_at_period_end = true AND d.date BETWEEN s.current_period_start::date AND s.current_period_end::date) AS non_renewing_subscriptions,
  CASE
    WHEN SUM(CASE WHEN s.created::date < d.date - INTERVAL '30 days' AND
                   (s.status = 'active' OR
                    (s.status = 'canceled' AND s.canceled_at::date >= d.date - INTERVAL '30 days'))
                   THEN 1 ELSE 0 END) = 0 THEN 0
    ELSE ROUND(
      (SUM(CASE WHEN s.created::date < d.date - INTERVAL '30 days' AND 
                     s.status = 'active' AND 
                     d.date BETWEEN s.current_period_start::date AND s.current_period_end::date
                THEN 1 ELSE 0 END)::numeric /
       NULLIF(SUM(CASE WHEN s.created::date < d.date - INTERVAL '30 days' THEN 1 ELSE 0 END)::numeric, 0)) * 100,
      1
    )
  END AS retention_rate
FROM dates d
LEFT JOIN public.subscriptions s ON true
GROUP BY d.date
ORDER BY d.date DESC;

COMMENT ON VIEW public.subscription_analytics IS 'Daily subscription metrics over time for tracking growth and churn';

-- 3. Beta code performance metrics
CREATE OR REPLACE VIEW public.beta_code_performance AS
SELECT
  b.code,
  b.max_uses,
  b.uses,
  b.expires_on,
  COUNT(t.id) AS total_trials,
  SUM(CASE WHEN EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = t.user_id 
    AND s.status IN ('active', 'trialing', 'past_due')
    AND s.created > t.start_date
  ) THEN 1 ELSE 0 END) AS converted_to_paid,
  CASE 
    WHEN COUNT(t.id) = 0 THEN 0
    ELSE ROUND((SUM(CASE WHEN EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.user_id = t.user_id 
      AND s.status IN ('active', 'trialing', 'past_due')
      AND s.created > t.start_date
    ) THEN 1 ELSE 0 END)::numeric / COUNT(t.id)::numeric) * 100, 1)
  END AS conversion_rate,
  b.expires_on < CURRENT_DATE AS is_expired
FROM public.beta_codes b
LEFT JOIN public.trial_subscriptions t ON t.trial_code = b.code
GROUP BY b.code, b.max_uses, b.uses, b.expires_on;

COMMENT ON VIEW public.beta_code_performance IS 'Analytics for beta code usage and conversion rates';

-- 4. User activity and engagement
CREATE OR REPLACE VIEW public.user_activity_metrics AS
SELECT
  date_trunc('day', rs.updated_at)::date AS activity_date,
  COUNT(DISTINCT rs.user_id) AS active_users,
  COUNT(DISTINCT ss.user_id) AS users_with_saved_settings,
  (SELECT COUNT(DISTINCT user_id) FROM public.subscriptions WHERE status = 'active') AS total_premium_users,
  ROUND(
    COUNT(DISTINCT rs.user_id)::numeric / NULLIF((SELECT COUNT(*) FROM auth.users), 0)::numeric * 100,
    1
  ) AS daily_active_user_percentage
FROM public.recent_session_states rs
LEFT JOIN public.saved_settings ss ON ss.updated_at::date = date_trunc('day', rs.updated_at)::date
WHERE rs.updated_at > CURRENT_DATE - INTERVAL '30 days'
GROUP BY activity_date
ORDER BY activity_date DESC;

COMMENT ON VIEW public.user_activity_metrics IS 'User engagement metrics showing daily active users and saved settings';

-- Set view ownership
ALTER VIEW public.daily_metrics_summary OWNER TO postgres;
ALTER VIEW public.subscription_analytics OWNER TO postgres;
ALTER VIEW public.beta_code_performance OWNER TO postgres;
ALTER VIEW public.user_activity_metrics OWNER TO postgres;

-- Grant access to the service role
GRANT SELECT ON public.daily_metrics_summary TO service_role;
GRANT SELECT ON public.subscription_analytics TO service_role;
GRANT SELECT ON public.beta_code_performance TO service_role;
GRANT SELECT ON public.user_activity_metrics TO service_role;