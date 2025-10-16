/*
  # Safe beta code validation system
  
  1. Changes
    - Safely inserts all required beta codes if they don't already exist
    - Creates a validation table for UI-based beta code activation
    - Populates the validation table with approved beta codes
    - Sets up proper security policies
  
  2. Security
    - Uses ON CONFLICT DO NOTHING to avoid modifying existing codes
    - Preserves all foreign key relationships and trial subscriptions
    - Only adds missing data, never deletes or updates existing data
*/

-- 1. First ensure all beta codes exist in the beta_codes table
INSERT INTO beta_codes (code)
VALUES 
  ('bt-rabbit-car'),
  ('bt-dog-bike'),
  ('bt-cat-swing'),
  ('bt-mouse-portal'),
  ('bt-tiger-columbia'),
  ('bt-elephant-skis'),
  ('bt-deer-sled'),
  ('bt-cougar-glider'),
  ('bt-squirrel-slide'),
  ('bt-eagle-carabiner'),
  ('bt-snake-ladder'),
  ('bt-hawk-clogs'),
  ('bt-moose-rollerskates'),
  ('bt-puma-skateboard'),
  ('bt-wolf-parachute'),
  ('bt-vulture-bobsled'),
  ('bt-bison-jetpack'),
  ('bt-fox-floaties'),
  ('bt-leopard-sled'),
  ('bt-hyena-toboggan')
ON CONFLICT (code) DO NOTHING;

-- 2. Create validation table if it doesn't already exist
CREATE TABLE IF NOT EXISTS valid_beta_codes_ui (
  code TEXT PRIMARY KEY REFERENCES beta_codes(code) ON DELETE CASCADE
);

-- 3. Set up RLS for the validation table
ALTER TABLE valid_beta_codes_ui ENABLE ROW LEVEL SECURITY;

-- 4. Create policies for the validation table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'valid_beta_codes_ui' 
    AND policyname = 'Authenticated users can read valid beta codes'
  ) THEN
    CREATE POLICY "Authenticated users can read valid beta codes" 
    ON valid_beta_codes_ui FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'valid_beta_codes_ui' 
    AND policyname = 'Service role can manage valid beta codes'
  ) THEN
    CREATE POLICY "Service role can manage valid beta codes" 
    ON valid_beta_codes_ui FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 5. Populate the validation table with approved codes
INSERT INTO valid_beta_codes_ui (code)
VALUES
  ('bt-rabbit-car'),
  ('bt-dog-bike'),
  ('bt-cat-swing'),
  ('bt-mouse-portal'),
  ('bt-tiger-columbia'),
  ('bt-elephant-skis'),
  ('bt-deer-sled'),
  ('bt-cougar-glider'),
  ('bt-squirrel-slide'),
  ('bt-eagle-carabiner'),
  ('bt-snake-ladder'),
  ('bt-hawk-clogs'),
  ('bt-moose-rollerskates'),
  ('bt-puma-skateboard'),
  ('bt-wolf-parachute'),
  ('bt-vulture-bobsled'),
  ('bt-bison-jetpack'),
  ('bt-fox-floaties'),
  ('bt-leopard-sled'),
  ('bt-hyena-toboggan')
ON CONFLICT (code) DO NOTHING;