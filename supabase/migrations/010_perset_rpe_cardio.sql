-- Per-set workout data: each set logged individually with RPE + weight basis
create table public.workout_sets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  workout_log_id  uuid not null references public.workout_logs(id) on delete cascade,
  set_index       integer not null,
  reps            integer not null default 0,
  weight          numeric not null default 0,
  weight_basis    text not null default 'total' check (weight_basis in ('total','per_side')),
  rpe             numeric check (rpe is null or (rpe >= 1 and rpe <= 10)),
  created_at      timestamptz default now(),
  unique (workout_log_id, set_index)
);

alter table public.workout_sets enable row level security;

create policy "Users can manage own workout sets"
  on public.workout_sets for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index on public.workout_sets (user_id, workout_log_id);
create index on public.workout_sets (workout_log_id, set_index);

-- Position in session + free-text notes on the parent log
alter table public.workout_logs
  add column if not exists position_in_session integer,
  add column if not exists notes text;

-- Structured cardio actuals (link to the planned exercise)
alter table public.workout_sessions
  add column if not exists avg_speed_mph numeric,
  add column if not exists avg_incline_pct numeric,
  add column if not exists planned_exercise_name text;
