-- Ensure the 20 codes are in valid_beta_codes_ui
INSERT INTO valid_beta_codes_ui (code) VALUES
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
ON CONFLICT DO NOTHING;