/*
  # Create recent session states table for premium users
  
  1. New Tables
    - `recent_session_states` - Stores the most recent session state for premium users
      - `user_id` (uuid, primary key, references auth.users)
      - `data` (jsonb, contains the complete saved state)
      - `updated_at` (timestamp with time zone)
  
  2. Security
    - Enable RLS on the new table
    - Add policy for users to manage only their own recent session state
*/

-- Create the table for storing recent session states
CREATE TABLE IF NOT EXISTS public.recent_session_states (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.recent_session_states ENABLE ROW LEVEL SECURITY;

-- Create policy for users to access only their own recent session state
CREATE POLICY "Allow individual users access to their own recent state"
  ON public.recent_session_states
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create trigger to update the updated_at column
CREATE OR REPLACE FUNCTION update_recent_states_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_recent_states_timestamp
BEFORE UPDATE ON public.recent_session_states
FOR EACH ROW EXECUTE FUNCTION update_recent_states_timestamp();

-- Grant permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.recent_session_states TO authenticated;