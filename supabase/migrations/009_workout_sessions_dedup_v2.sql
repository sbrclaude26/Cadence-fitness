-- Fix workout-session dedup. The previous unique index keyed on rounded
-- duration_min, but the ingest upsert passes raw duration_min — so the
-- index could never be used for conflict resolution, and tiny duration
-- drift from HealthKit (e.g. 30.1 vs 30.2 min) created silent duplicates.
--
-- New dedup key: (user_id, date, name). Two different workouts on the
-- same day with the same name is vanishingly rare; the ingest will treat
-- them as the same row and ignoreDuplicates.

-- 1. Collapse any existing duplicates (keep the earliest by created_at).
delete from public.workout_sessions s
using public.workout_sessions s2
where s.user_id = s2.user_id
  and s.date    = s2.date
  and s.name    = s2.name
  and s.created_at > s2.created_at;

-- 2. Drop the old index that referenced round(duration_min).
drop index if exists public.workout_sessions_dedup_idx;

-- 3. Create the new column-only unique index.
create unique index if not exists workout_sessions_dedup_v2_idx
  on public.workout_sessions (user_id, date, name);
