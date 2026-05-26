-- Capture session ordering for cardio actuals so the brain can tell
-- "zone-2 after lifting" from "zone-2 standalone" — mirrors what
-- workout_logs.position_in_session does for strength.
alter table public.workout_sessions
  add column if not exists position_in_session integer;
