-- Workout sessions: cardio, strength, or any Watch-recorded activity
CREATE TABLE IF NOT EXISTS workout_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES auth.users NOT NULL,
  date         date NOT NULL,
  type         text NOT NULL CHECK (type IN ('strength','cardio','walk','run','other')),
  name         text,
  duration_min numeric,
  distance_km  numeric,
  calories     int,
  avg_hr       int,
  max_hr       int,
  source       text NOT NULL DEFAULT 'healthkit',
  notes        text,
  created_at   timestamptz DEFAULT now()
);

ALTER TABLE workout_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD own workout_sessions"
  ON workout_sessions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
