-- Cadence Fitness — pin each cycle to an explicit Day-1 start date.
--
-- Previously every surface (Today, Log, Trends) derived a plan's first day
-- from `generated_at`. That timestamp is UTC and is *reset* whenever a plan is
-- rebuilt or a queued plan is promoted, so a newly generated cycle could
-- silently re-govern dates an earlier cycle already owned — making historical
-- calorie/macro goals appear to change retroactively.
--
-- `cycle_start_date` is an immutable local date (YYYY-MM-DD) that records the
-- day a plan's Day 1 maps to. Goal/day-of-cycle resolution keys off this column
-- instead of `generated_at`, and the user can now choose it when building a plan.
--
-- Nullable on purpose: historical rows are backfilled best-effort from
-- generated_at, and application code falls back to the generated_at local date
-- when the column is null, so old plans still resolve.

alter table public.plans
  add column if not exists cycle_start_date date;

update public.plans
  set cycle_start_date = (generated_at at time zone 'UTC')::date
  where cycle_start_date is null;
