/*
  # Add Beta Tester Codes

  1. Changes
     - Inserts 12 beta tester codes into the beta_codes table
     - Each code is valid for 1 year and can be used up to 10 times
     - These codes allow users to get 30 days of premium access without requiring payment

  2. Notes
     - These are promotional codes for marketing purposes
     - When a user activates a code, the trial_subscriptions table will record the activation
*/

-- Insert beta tester codes if they don't already exist
INSERT INTO beta_codes (code, expires_on, max_uses, uses)
VALUES 
  ('bt-rabbit-car', CURRENT_DATE + INTERVAL '1 year', 10, 0),
  ('bt-dog-bike', CURRENT_DATE + INTERVAL '1 year', 10, 0),
  ('bt-cat-swing', CURRENT_DATE + INTERVAL '1 year', 10, 0),
  ('bt-mouse-portal', CURRENT_DATE + INTERVAL '1 year', 10, 0),
  ('bt-tiger-columbia', CURRENT_DATE + INTERVAL '1 year', 10, 0),
  ('bt-elephant-skis', CURRENT_DATE + INTERVAL '1 year', 10, 0),
  ('bt-deer-sled', CURRENT_DATE + INTERVAL '1 year', 10, 0),
  ('bt-cougar-glider', CURRENT_DATE + INTERVAL '1 year', 10, 0),
  ('bt-squirrel-slide', CURRENT_DATE + INTERVAL '1 year', 10, 0),
  ('bt-eagle-carabiner', CURRENT_DATE + INTERVAL '1 year', 10, 0),
  ('bt-snake-ladder', CURRENT_DATE + INTERVAL '1 year', 10, 0),
  ('bt-hawk-clogs', CURRENT_DATE + INTERVAL '1 year', 10, 0)
ON CONFLICT (code) 
DO NOTHING;