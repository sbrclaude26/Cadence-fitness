-- Unique constraint to prevent duplicate workout entries
-- Matches on user + date + name + duration (rounded to nearest minute to handle float variance)
CREATE UNIQUE INDEX IF NOT EXISTS workout_sessions_dedup_idx
  ON workout_sessions (user_id, date, name, round(COALESCE(duration_min, 0)::numeric));
