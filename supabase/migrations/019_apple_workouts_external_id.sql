-- Cadence Fitness — make apple_workouts dedup use HealthKit UUID, not (date,name).
--
-- BEFORE: unique(user_id, date, name) collapsed two walks on the same day into
-- one row. AFTER: dedup on a HealthKit-supplied external_id when present;
-- otherwise allow multiple rows per (date, name).
--
-- Also corrects existing rows where the Shortcut sent HKWorkout.duration (which
-- HealthKit returns in seconds) into a column labeled duration_min. Anything
-- over 6h of "minutes" is treated as seconds and divided by 60.

drop index if exists public.apple_workouts_dedup_idx;

alter table public.apple_workouts
  add column if not exists external_id text;

create unique index if not exists apple_workouts_external_id_idx
  on public.apple_workouts (user_id, external_id)
  where external_id is not null;

update public.apple_workouts
   set duration_min = round((duration_min / 60.0)::numeric, 2)
 where duration_min is not null
   and duration_min > 360;
