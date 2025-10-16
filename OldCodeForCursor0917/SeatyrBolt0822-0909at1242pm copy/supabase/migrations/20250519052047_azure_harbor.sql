-- Add RLS policies for beta_codes and trial_subscriptions if not already exists

-- Check if the beta_codes table has the Allow insert policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'trial_subscriptions'
    AND policyname = 'Allow insert'
  ) THEN
    CREATE POLICY "Allow insert" ON trial_subscriptions
    FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Check if the trial_subscriptions table has the Allow select policy
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'trial_subscriptions'
    AND policyname = 'Allow select'
  ) THEN
    CREATE POLICY "Allow select" ON trial_subscriptions
    FOR SELECT USING (auth.uid() = user_id);
  END IF;
END $$;

-- Ensure the beta_codes table has proper permissions for authenticated users
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE tablename = 'beta_codes'
    AND policyname = 'Authenticated users can read beta codes'
  ) THEN
    CREATE POLICY "Authenticated users can read beta codes"
      ON beta_codes
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;