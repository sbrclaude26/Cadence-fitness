-- Canonical exercise library shared by the Brain (planner) and the picker UI.
-- Seeded from the public-domain Free Exercise DB plus a hand-authored cardio
-- supplement. Slug is the stable id used by both the AI's plan output and the
-- workout_logs foreign key. See scripts/seedWorkoutLibrary.ts.

create table public.workout_library (
  slug             text primary key,
  name             text not null,
  category         text not null,
  level            text,
  force            text,
  mechanic         text,
  equipment        text,
  primary_muscles  text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  description      text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Public read — the library is non-sensitive reference data and the picker
-- needs to query it from any signed-in user. Writes are restricted to the
-- service role (seed script), so no write policy is created.
alter table public.workout_library enable row level security;

create policy "Library is readable by authenticated users"
  on public.workout_library for select
  to authenticated
  using (true);

-- Search aids: name prefix lookups (picker autocomplete) and category filters.
create index workout_library_name_lower_idx on public.workout_library (lower(name));
create index workout_library_category_idx on public.workout_library (category);
