/*
  # Subscription Analytics Dashboard Views
  
  1. New Views
    - `subscription_analytics` - Subscription metrics for monitoring and reporting
    - `user_engagement_metrics` - Track user activity and engagement
    - `beta_code_performance` - Track beta code usage and conversion
    
  2. Security
    - All views are secured with RLS
    - Only service_role can access these analytics views
*/

-- First create a view for subscription analytics
CREATE OR REPLACE VIEW public.subscription_analytics AS
SELECT
  date_trunc('day', subscriptions.created)::date AS date,
  COUNT(*) FILTER (WHERE subscriptions.created >= date_trunc('day', subscriptions.created) AND subscriptions.created < date_trunc('day', subscriptions.created) + interval '1 day') AS new_subscriptions,
  COUNT(*) FILTER (WHERE subscriptions.status = 'active') AS active_subscriptions,
  COUNT(*) FILTER (WHERE subscriptions.status = 'canceled' AND subscriptions.canceled_at >= date_trunc('day', subscriptions.created) AND subscriptions.canceled_at < date_trunc('day', subscriptions.created) + interval '1 day') AS cancellations,
  COUNT(*) FILTER (WHERE subscriptions.status = 'past_due') AS past_due_subscriptions,
  COUNT(*) FILTER (WHERE subscriptions.cancel_at_period_end) AS non_renewing_subscriptions,
  COALESCE(ROUND(
    COUNT(*) FILTER (WHERE subscriptions.status != 'canceled' AND subscriptions.created < date_trunc('month', CURRENT_DATE) - interval '1 month')::numeric /
    NULLIF(COUNT(*) FILTER (WHERE subscriptions.created < date_trunc('month', CURRENT_DATE) - interval '1 month')::numeric, 0) * 100
  , 2), 0) AS retention_rate
FROM
  subscriptions
GROUP BY
  date_trunc('day', subscriptions.created)::date
ORDER BY
  date DESC;

-- Create a view for user engagement metrics
CREATE OR REPLACE VIEW public.user_engagement_metrics AS
SELECT
  date_trunc('day', saved_settings.created_at)::date AS date,
  COUNT(DISTINCT saved_settings.user_id) AS active_users,
  COUNT(*) AS total_settings_saved,
  COUNT(*) / COUNT(DISTINCT saved_settings.user_id)::float AS avg_settings_per_user,
  COUNT(*) FILTER (WHERE recent_session_states.data IS NOT NULL) AS users_with_recent_state,
  ROUND(AVG(EXTRACT(EPOCH FROM (recent_session_states.updated_at - saved_settings.created_at)) / 3600)) AS avg_session_duration_hours
FROM
  saved_settings
LEFT JOIN
  recent_session_states ON saved_settings.user_id = recent_session_states.user_id
GROUP BY
  date_trunc('day', saved_settings.created_at)::date
ORDER BY
  date DESC;

-- Create a view for beta code performance
CREATE OR REPLACE VIEW public.beta_code_performance AS
SELECT
  beta_codes.code,
  beta_codes.uses,
  beta_codes.max_uses,
  COUNT(DISTINCT trial_subscriptions.user_id) AS total_trials,
  COUNT(DISTINCT s.user_id) AS converted_to_paid,
  CASE 
    WHEN COUNT(DISTINCT trial_subscriptions.user_id) > 0 
    THEN ROUND(COUNT(DISTINCT s.user_id)::numeric / COUNT(DISTINCT trial_subscriptions.user_id)::numeric * 100, 2)
    ELSE 0
  END AS conversion_rate,
  beta_codes.expires_on,
  (beta_codes.expires_on < CURRENT_DATE) AS is_expired
FROM
  beta_codes
LEFT JOIN
  trial_subscriptions ON beta_codes.code = trial_subscriptions.trial_code
LEFT JOIN
  subscriptions s ON trial_subscriptions.user_id = s.user_id AND s.status = 'active' AND s.created > trial_subscriptions.start_date
GROUP BY
  beta_codes.code, beta_codes.uses, beta_codes.max_uses, beta_codes.expires_on
ORDER BY
  beta_codes.uses DESC;

-- Create a daily metrics rollup view
CREATE OR REPLACE VIEW public.daily_metrics_summary AS
SELECT
  CURRENT_DATE AS report_date,
  (SELECT COUNT(*) FROM auth.users) AS total_users,
  (SELECT COUNT(*) FROM subscriptions WHERE status = 'active') AS active_subscriptions,
  (SELECT COUNT(*) FROM trial_subscriptions WHERE expires_on > CURRENT_TIMESTAMP) AS active_trials,
  (SELECT COUNT(*) FROM saved_settings) AS total_saved_settings,
  (SELECT COUNT(*) FROM recent_session_states WHERE updated_at > CURRENT_TIMESTAMP - INTERVAL '7 days') AS active_users_last_7_days,
  (SELECT AVG(uses) FROM beta_codes) AS avg_beta_code_usage,
  (SELECT COUNT(*) FROM coupon_codes WHERE used_at IS NOT NULL) AS used_coupons,
  (SELECT COUNT(*) FROM coupon_codes WHERE expires_at > CURRENT_TIMESTAMP AND used_at IS NULL) AS available_coupons
;

-- Enable RLS on all views
ALTER VIEW public.subscription_analytics ENABLE ROW LEVEL SECURITY;
ALTER VIEW public.user_engagement_metrics ENABLE ROW LEVEL SECURITY;
ALTER VIEW public.beta_code_performance ENABLE ROW LEVEL SECURITY;
ALTER VIEW public.daily_metrics_summary ENABLE ROW LEVEL SECURITY;

-- Create policies to only allow service_role to access these views
CREATE POLICY "Service role can view analytics" 
ON public.subscription_analytics FOR SELECT TO service_role USING (true);

CREATE POLICY "Service role can view engagement metrics" 
ON public.user_engagement_metrics FOR SELECT TO service_role USING (true);

CREATE POLICY "Service role can view beta code performance" 
ON public.beta_code_performance FOR SELECT TO service_role USING (true);

CREATE POLICY "Service role can view daily metrics summary" 
ON public.daily_metrics_summary FOR SELECT TO service_role USING (true);