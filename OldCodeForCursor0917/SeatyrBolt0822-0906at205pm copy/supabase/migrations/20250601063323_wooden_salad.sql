-- Create or replace key business metric functions for the admin dashboard

-- Function to calculate subscription growth month-over-month
CREATE OR REPLACE FUNCTION public.calculate_subscription_growth(
  end_date DATE DEFAULT CURRENT_DATE
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_month_start DATE;
  current_month_end DATE;
  previous_month_start DATE;
  previous_month_end DATE;
  current_month_count INTEGER;
  previous_month_count INTEGER;
  growth_rate NUMERIC;
BEGIN
  -- Set date ranges
  current_month_end := end_date;
  current_month_start := date_trunc('month', current_month_end)::date;
  previous_month_end := current_month_start - INTERVAL '1 day';
  previous_month_start := date_trunc('month', previous_month_end)::date;
  
  -- Get subscription counts
  SELECT COUNT(*) INTO current_month_count
  FROM subscriptions
  WHERE created >= current_month_start AND created <= current_month_end;
  
  SELECT COUNT(*) INTO previous_month_count
  FROM subscriptions
  WHERE created >= previous_month_start AND created <= previous_month_end;
  
  -- Calculate growth rate
  IF previous_month_count = 0 THEN
    growth_rate := NULL; -- Cannot calculate growth rate if previous month had zero
  ELSE
    growth_rate := ((current_month_count::NUMERIC / previous_month_count::NUMERIC) - 1) * 100;
  END IF;
  
  RETURN growth_rate;
END;
$$;

-- Function to calculate trial-to-paid conversion rate
CREATE OR REPLACE FUNCTION public.calculate_trial_conversion_rate(
  days_lookback INTEGER DEFAULT 30
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  start_date DATE;
  end_date DATE;
  total_trials INTEGER;
  converted_trials INTEGER;
  conversion_rate NUMERIC;
BEGIN
  -- Set date range
  end_date := CURRENT_DATE - INTERVAL '15 days'; -- Allow 15 days for conversion after trial ends
  start_date := end_date - (days_lookback || ' days')::INTERVAL;
  
  -- Get total trials that ended in this period
  SELECT COUNT(*) INTO total_trials
  FROM trial_subscriptions
  WHERE expires_on >= start_date AND expires_on <= end_date;
  
  -- Get count of trials that converted to paid
  SELECT COUNT(*) INTO converted_trials
  FROM trial_subscriptions t
  WHERE t.expires_on >= start_date AND t.expires_on <= end_date
  AND EXISTS (
    SELECT 1 
    FROM subscriptions s 
    WHERE s.user_id = t.user_id
    AND s.created > t.start_date
    AND s.created < (t.expires_on + INTERVAL '15 days')
    AND s.status != 'canceled'
  );
  
  -- Calculate conversion rate
  IF total_trials = 0 THEN
    conversion_rate := 0;
  ELSE
    conversion_rate := (converted_trials::NUMERIC / total_trials::NUMERIC) * 100;
  END IF;
  
  RETURN ROUND(conversion_rate, 2);
END;
$$;

-- Function to calculate subscriber retention rate
CREATE OR REPLACE FUNCTION public.calculate_subscriber_retention(
  period_days INTEGER DEFAULT 30
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  period_start DATE;
  period_end DATE;
  subscribers_at_start INTEGER;
  subscribers_remaining INTEGER;
  retention_rate NUMERIC;
BEGIN
  -- Set date range
  period_end := CURRENT_DATE;
  period_start := period_end - (period_days || ' days')::INTERVAL;
  
  -- Count subscribers at the start of period
  SELECT COUNT(*) INTO subscribers_at_start
  FROM subscriptions
  WHERE created < period_start
  AND (
    ended_at IS NULL OR 
    ended_at > period_start
  )
  AND status IN ('active', 'trialing', 'past_due');
  
  -- Count how many of those subscribers are still active
  SELECT COUNT(*) INTO subscribers_remaining
  FROM subscriptions
  WHERE created < period_start
  AND (
    ended_at IS NULL OR 
    ended_at > period_end
  )
  AND status IN ('active', 'trialing', 'past_due');
  
  -- Calculate retention rate
  IF subscribers_at_start = 0 THEN
    retention_rate := 0;
  ELSE
    retention_rate := (subscribers_remaining::NUMERIC / subscribers_at_start::NUMERIC) * 100;
  END IF;
  
  RETURN ROUND(retention_rate, 2);
END;
$$;

-- Function to calculate health score (combined metric)
CREATE OR REPLACE FUNCTION public.calculate_subscription_health_score()
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  growth_score NUMERIC;
  conversion_score NUMERIC;
  retention_score NUMERIC;
  health_score NUMERIC;
BEGIN
  -- Get component scores
  growth_score := COALESCE(public.calculate_subscription_growth(), 0);
  conversion_score := COALESCE(public.calculate_trial_conversion_rate(), 0);
  retention_score := COALESCE(public.calculate_subscriber_retention(), 0);
  
  -- Combine scores with weights
  -- 30% growth, 30% conversion, 40% retention
  health_score := (growth_score * 0.3) + (conversion_score * 0.3) + (retention_score * 0.4);
  
  -- Normalize to 0-100 scale with minimum 0
  health_score := GREATEST(0, LEAST(100, health_score));
  
  RETURN ROUND(health_score, 1);
END;
$$;

-- Grant execution privileges to service role
GRANT EXECUTE ON FUNCTION public.calculate_subscription_growth TO service_role;
GRANT EXECUTE ON FUNCTION public.calculate_trial_conversion_rate TO service_role;
GRANT EXECUTE ON FUNCTION public.calculate_subscriber_retention TO service_role;
GRANT EXECUTE ON FUNCTION public.calculate_subscription_health_score TO service_role;