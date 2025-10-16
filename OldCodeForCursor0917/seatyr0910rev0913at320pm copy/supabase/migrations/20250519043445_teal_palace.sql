/*
  # Add Beta Tester Codes

  1. New Data
    - Insert 12 beta tester codes into the `beta_codes` table
    - Each code has a 90-day expiration and 3 maximum uses
  2. Security
    - No changes to security policies (using existing policies)
*/

-- Insert beta tester codes with 90-day expiration and 3 maximum uses
INSERT INTO public.beta_codes (code, expires_on, max_uses, uses)
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
ON CONFLICT (code) 
DO UPDATE SET 
  expires_on = EXCLUDED.expires_on,
  max_uses = EXCLUDED.max_uses;