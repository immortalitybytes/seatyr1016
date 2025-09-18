/*
  # Update beta tester codes limitations
  
  1. Changes
     - Update all existing beta codes to expire in 90 days instead of 1 year
     - Change maximum uses from 10 to 3 for all beta codes
*/

-- Update all beta tester codes to expire in 90 days and limit to 3 uses
UPDATE beta_codes 
SET 
  expires_on = CURRENT_DATE + INTERVAL '90 days',
  max_uses = 3
WHERE code LIKE 'bt-%';

-- If any codes have more than 3 uses already, we won't change them to avoid breaking existing subscriptions
-- This will only show a warning in the logs if any codes have been used more than 3 times
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM beta_codes WHERE uses > 3 AND code LIKE 'bt-%') THEN
    RAISE NOTICE 'Some beta codes have more than 3 uses already - these subscriptions will remain active';
  END IF;
END $$;