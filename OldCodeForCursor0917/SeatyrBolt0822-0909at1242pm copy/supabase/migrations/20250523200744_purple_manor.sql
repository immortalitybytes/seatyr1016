/*
  # Add Recent Session Settings table for Premium Users

  1. New Tables
    - `recent_session_settings` - Stores recently used table settings
      - `id` (uuid, primary key)
      - `user_id` (uuid, references auth.users)
      - `data` (jsonb, contains table settings)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)

  2. Security
    - Enable RLS on the new table
    - Add policy for users to manage their own settings
*/

-- Create the table for storing recent session settings
CREATE TABLE IF NOT EXISTS recent_session_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE recent_session_settings ENABLE ROW LEVEL SECURITY;

-- Add policy for users to manage their own recent session settings
CREATE POLICY "Users can manage their own recent session settings"
ON recent_session_settings
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Create trigger for updating the timestamp
CREATE TRIGGER update_recent_session_settings_updated_at
BEFORE UPDATE ON recent_session_settings
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();