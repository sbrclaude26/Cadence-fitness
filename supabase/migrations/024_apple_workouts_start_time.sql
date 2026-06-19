-- Cadence Fitness — let two distinct Apple Watch workouts on the same day coexist.
--
-- BEFORE: when the Shortcut doesn't send an external_id, the ingest endpoint
-- dedupes on (date, name, duration, distance, calories). Two genuine walks
-- with similar metrics (a warm-up walk + a post-lift walk of similar length)
-- collide and the second one is silently dropped.
--
-- AFTER: persist the workout's start instant from HealthKit. The ingest
-- endpoint uses it as an additional dedup discriminator so two walks at
-- different times can never collide. The linker UI also surfaces it so the
-- user can tell warm-up walk vs post-lift walk apart.
--
-- Idempotent: re-running adds the column only if it isn't already there.

alter table public.apple_workouts
  add column if not exists start_time timestamptz;

create index if not exists apple_workouts_user_start_time_idx
  on public.apple_workouts (user_id, start_time desc)
  where start_time is not null;
