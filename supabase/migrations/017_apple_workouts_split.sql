-- Split Apple Watch ingest out of workout_sessions into its own table.
--
-- BEFORE: workout_sessions held two unrelated things:
--   1. User-logged cardio + holds (source='manual')
--   2. Raw Apple Watch dumps from the ingest webhook (source='healthkit')
-- workout_logs.workout_session_id pointed at #2 to share Watch metrics across
-- the strength exercises that happened during one Apple Watch "Strength" session.
--
-- AFTER:
--   - workout_sessions: ONLY user-logged cardio + holds. source column dropped.
--   - apple_workouts:   raw Apple Watch ingest (everything that was source='healthkit').
--   - workout_logs.apple_workout_id:    strength exercise → Apple Watch session.
--   - workout_sessions.apple_workout_id: cardio/hold → Apple Watch session (new).

-- ─── 1. Create apple_workouts ────────────────────────────────────────────────
create table if not exists public.apple_workouts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  date         date not null,
  type         text not null check (type in ('strength','cardio','walk','run','other')),
  name         text,
  duration_min numeric,
  distance_km  numeric,
  calories     int,
  avg_hr       int,
  max_hr       int,
  notes        text,
  created_at   timestamptz default now()
);

alter table public.apple_workouts enable row level security;

create policy "Users can manage own apple_workouts"
  on public.apple_workouts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists apple_workouts_user_date_idx
  on public.apple_workouts (user_id, date desc);

-- Same dedup key the ingest upsert used to use on workout_sessions.
create unique index if not exists apple_workouts_dedup_idx
  on public.apple_workouts (user_id, date, name);

-- ─── 2. Add apple_workout_id to both consumer tables ─────────────────────────
alter table public.workout_logs
  add column if not exists apple_workout_id uuid
    references public.apple_workouts(id) on delete set null;

create index if not exists workout_logs_apple_workout_id_idx
  on public.workout_logs (apple_workout_id);

alter table public.workout_sessions
  add column if not exists apple_workout_id uuid
    references public.apple_workouts(id) on delete set null;

create index if not exists workout_sessions_apple_workout_id_idx
  on public.workout_sessions (apple_workout_id);

-- ─── 3. Backfill apple_workouts from existing source='healthkit' rows ────────
-- Preserve the original UUIDs so workout_logs.workout_session_id remappings
-- become a simple column-to-column copy.
insert into public.apple_workouts (id, user_id, date, type, name, duration_min, distance_km, calories, avg_hr, max_hr, notes, created_at)
select id, user_id, date, type, name, duration_min, distance_km, calories, avg_hr, max_hr, notes, created_at
from public.workout_sessions
where source = 'healthkit'
on conflict (id) do nothing;

-- ─── 4. Remap workout_logs.workout_session_id → apple_workout_id ─────────────
-- Every existing workout_session_id pointed at a healthkit row (that was the
-- only intended use of the link). Copy the value across, then drop the old column.
update public.workout_logs
   set apple_workout_id = workout_session_id
 where workout_session_id is not null
   and apple_workout_id is null;

alter table public.workout_logs
  drop column if exists workout_session_id;

-- ─── 5. Delete migrated healthkit rows from workout_sessions ─────────────────
-- Their data now lives in apple_workouts (same UUIDs). workout_sessions from
-- here on is exclusively user-logged cardio + holds.
delete from public.workout_sessions where source = 'healthkit';

-- ─── 6. Drop the source column from workout_sessions ─────────────────────────
-- Only 'manual' rows remain; the column has no remaining meaning.
alter table public.workout_sessions
  drop column if exists source;

-- The old dedup index keyed on (user_id, date, name) was sized for HealthKit
-- duplicate suppression. Manual entries don't need it (users can legitimately
-- log two cardio blocks with the same name on the same day, e.g. two
-- "Treadmill" rows split across morning/evening). Drop it.
drop index if exists public.workout_sessions_dedup_v2_idx;
