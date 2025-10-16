-- Fix conflict: drop policies if they already exist
DROP POLICY IF EXISTS "Authenticated users can read valid beta codes" ON valid_beta_codes_ui;
DROP POLICY IF EXISTS "Service role can manage valid beta codes" ON valid_beta_codes_ui;

-- Enable RLS (harmless if already enabled)
ALTER TABLE valid_beta_codes_ui ENABLE ROW LEVEL SECURITY;

-- Recreate policies cleanly
CREATE POLICY "Authenticated users can read valid beta codes"
  ON valid_beta_codes_ui
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage valid beta codes"
  ON valid_beta_codes_ui
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);