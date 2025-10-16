/*
  # Update beta codes table with expiration and usage limits
  
  1. Changes
    - Add max_uses column to beta_codes table
    - Update existing beta codes with max_uses=3
    - Set expiration date to 90 days from now
  2. Security
    - No changes to RLS policies
*/

-- Add max_uses column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'beta_codes' AND column_name = 'max_uses'
  ) THEN
    ALTER TABLE beta_codes ADD COLUMN max_uses integer;
  END IF;
END $$;

-- Update existing beta codes with max_uses=3 and expiration date
UPDATE beta_codes
SET 
  max_uses = 3,
  expires_on = CURRENT_DATE + INTERVAL '90 days'
WHERE code IN (
  'bt-rabbit-car',
  'bt-dog-bike',
  'bt-cat-swing',
  'bt-mouse-portal',
  'bt-tiger-columbia',
  'bt-elephant-skis',
  'bt-deer-sled',
  'bt-cougar-glider',
  'bt-squirrel-slide',
  'bt-eagle-carabiner',
  'bt-snake-ladder',
  'bt-hawk-clogs'
);

-- Insert beta codes if they don't exist
INSERT INTO beta_codes (code, expires_on, max_uses, uses)
VALUES
  ('bt-rabbit-car', CURRENT_DATE + INTERVAL '90 days', 3, 0),
  ('bt-dog-bike', CURRENT_DATE + INTERVAL '90 days', 3, 0),
  ('bt-cat-swing', CURRENT_DATE + INTERVAL '90 days', 3, 0),
  ('bt-mouse-portal', CURRENT_DATE + INTERVAL '90 days', 3, 0),
  ('bt-tiger-columbia', CURRENT_DATE + INTERVAL '90 days', 3, 0),
  ('bt-elephant-skis', CURRENT_DATE + INTERVAL '90 days', 3, 0),
  ('bt-deer-sled', CURRENT_DATE + INTERVAL '90 days', 3, 0),
  ('bt-cougar-glider', CURRENT_DATE + INTERVAL '90 days', 3, 0),
  ('bt-squirrel-slide', CURRENT_DATE + INTERVAL '90 days', 3, 0),
  ('bt-eagle-carabiner', CURRENT_DATE + INTERVAL '90 days', 3, 0),
  ('bt-snake-ladder', CURRENT_DATE + INTERVAL '90 days', 3, 0),
  ('bt-hawk-clogs', CURRENT_DATE + INTERVAL '90 days', 3, 0)
ON CONFLICT (code) DO NOTHING;