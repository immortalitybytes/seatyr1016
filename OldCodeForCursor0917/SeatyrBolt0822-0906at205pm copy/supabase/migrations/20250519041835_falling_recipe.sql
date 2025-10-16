/*
  # Create beta code tables

  1. New Tables
    - `beta_codes` - Store beta tester codes
      - `code` (text, primary key)
      - `expires_on` (date, nullable)
      - `max_uses` (integer, nullable)
      - `uses` (integer, default 0)
    - `trial_subscriptions` - Store user trial subscriptions
      - `user_id` (uuid, FK to users)
      - `trial_code` (text, FK to beta_codes)
      - `start_date` (timestamp, required)
      - `expires_on` (timestamp, required)
  
  2. Security
    - Enable RLS on both tables
    - Add policies for accessing trial subscriptions
*/

-- Create beta_codes table
CREATE TABLE IF NOT EXISTS beta_codes (
  code TEXT PRIMARY KEY,
  expires_on DATE,
  max_uses INTEGER,
  uses INTEGER DEFAULT 0
);

-- Create trial_subscriptions table
CREATE TABLE IF NOT EXISTS trial_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  trial_code TEXT NOT NULL REFERENCES beta_codes(code),
  start_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  expires_on TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Enable RLS
ALTER TABLE beta_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE trial_subscriptions ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Authenticated users can read beta codes"
  ON beta_codes
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "User can read their trial"
  ON trial_subscriptions
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage beta codes"
  ON beta_codes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can manage trial subscriptions"
  ON trial_subscriptions
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);