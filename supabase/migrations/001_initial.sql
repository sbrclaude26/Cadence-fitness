-- Cadence Fitness — initial schema

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ─── profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  start_weight     numeric,
  current_weight   numeric,
  goal_weight      numeric,
  start_date       date,
  target_rate      numeric default 1,
  primary_goal     text,
  goal_event_date  date,
  experience       text default 'Intermediate',
  training_history text,
  exclusions       text,
  equipment        text,
  workout_days     text,
  diet_prefs       text,
  pantry           text,
  disruptions      text,
  vitals_ingest_token uuid default gen_random_uuid() not null,
  created_at       timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can read own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = user_id);

-- ─── weight_logs ─────────────────────────────────────────────────────────────
create table public.weight_logs (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users(id) on delete cascade,
  date     date not null,
  value    numeric not null,
  created_at timestamptz default now()
);

alter table public.weight_logs enable row level security;

create policy "Users can manage own weight logs"
  on public.weight_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index on public.weight_logs (user_id, date desc);

-- ─── meal_logs ───────────────────────────────────────────────────────────────
create table public.meal_logs (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null references auth.users(id) on delete cascade,
  date     date not null,
  name     text not null,
  calories integer not null default 0,
  protein  numeric not null default 0,
  carbs    numeric not null default 0,
  fat      numeric not null default 0,
  planned  boolean not null default false,
  created_at timestamptz default now()
);

alter table public.meal_logs enable row level security;

create policy "Users can manage own meal logs"
  on public.meal_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index on public.meal_logs (user_id, date desc);

-- ─── workout_logs ─────────────────────────────────────────────────────────────
create table public.workout_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  date          date not null,
  exercise_name text not null,
  sets          integer not null default 0,
  reps          integer not null default 0,
  weight        numeric not null default 0,
  custom        boolean not null default false,
  created_at    timestamptz default now()
);

alter table public.workout_logs enable row level security;

create policy "Users can manage own workout logs"
  on public.workout_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index on public.workout_logs (user_id, date desc);
create index on public.workout_logs (user_id, exercise_name, date desc);

-- ─── vitals ──────────────────────────────────────────────────────────────────
create table public.vitals (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  date               date not null,
  resting_hr         integer,
  avg_hr             integer,
  active_energy_kcal numeric,
  steps              integer,
  source             text not null default 'manual' check (source in ('manual', 'healthkit')),
  created_at         timestamptz default now(),
  unique (user_id, date)
);

alter table public.vitals enable row level security;

create policy "Users can manage own vitals"
  on public.vitals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index on public.vitals (user_id, date desc);

-- ─── plans ───────────────────────────────────────────────────────────────────
create table public.plans (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  cycle_number   integer not null default 1,
  status         text not null default 'current' check (status in ('current', 'queued', 'archived')),
  generated_at   timestamptz not null default now(),
  calorie_target integer not null,
  macros         jsonb not null,
  what_changed   text,
  days           jsonb not null,
  groceries      jsonb not null default '[]'::jsonb,
  created_at     timestamptz default now()
);

alter table public.plans enable row level security;

create policy "Users can manage own plans"
  on public.plans for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index on public.plans (user_id, status);
create index on public.plans (user_id, generated_at desc);

-- ─── vitals ingest (service-role bypass for webhook) ─────────────────────────
-- The webhook route uses the service role key so it bypasses RLS
-- The token lookup happens in application code
