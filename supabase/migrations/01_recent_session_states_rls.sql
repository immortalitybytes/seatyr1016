-- Migration: Enable RLS and create policies for recent_session_states table
-- This ensures authenticated users can only access their own session data

-- Enable RLS on the table
ALTER TABLE public.recent_session_states ENABLE ROW LEVEL SECURITY;

-- Create comprehensive policy for user data access
-- This policy allows authenticated users to perform all operations (SELECT, INSERT, UPDATE, DELETE)
-- on their own rows only, identified by auth.uid() = user_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'recent_session_states'
      AND policyname = 'Users can manage their own recent session state'
  ) THEN
    CREATE POLICY "Users can manage their own recent session state"
    ON public.recent_session_states
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;
END$$;

-- Also ensure other critical tables have proper RLS policies
-- subscriptions table
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'subscriptions'
      AND policyname = 'Users can manage their own subscription'
  ) THEN
    CREATE POLICY "Users can manage their own subscription"
    ON public.subscriptions
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;
END$$;

-- trial_subscriptions table
ALTER TABLE public.trial_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'trial_subscriptions'
      AND policyname = 'Users can manage their own trial subscription'
  ) THEN
    CREATE POLICY "Users can manage their own trial subscription"
    ON public.trial_subscriptions
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;
END$$;

-- saved_settings table
ALTER TABLE public.saved_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'saved_settings'
      AND policyname = 'Users can manage their own saved settings'
  ) THEN
    CREATE POLICY "Users can manage their own saved settings"
    ON public.saved_settings
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
  END IF;
END$$;

-- recent_session_settings table (if it exists)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'recent_session_settings' AND table_schema = 'public') THEN
    ALTER TABLE public.recent_session_settings ENABLE ROW LEVEL SECURITY;
    
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename  = 'recent_session_settings'
        AND policyname = 'Users can manage their own recent session settings'
    ) THEN
      CREATE POLICY "Users can manage their own recent session settings"
      ON public.recent_session_settings
      FOR ALL
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
    END IF;
  END IF;
END$$;
