-- Cadence Fitness — meal prep batches
-- A "batch" is a giant cooked portion (e.g., 2 lb chuck steak + 5 cups rice).
-- Users log a meal by selecting a batch + entering the % they ate; that
-- percentage of the batch's total macros gets snapshotted into meal_logs.

create table public.meal_prep_batches (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  name                text not null,
  ingredients         jsonb not null default '[]'::jsonb,
  recipe              text default '',
  total_calories      numeric not null default 0,
  total_protein       numeric not null default 0,
  total_carbs         numeric not null default 0,
  total_fat           numeric not null default 0,
  suggested_servings  numeric,
  consumed_pct        numeric not null default 0
                       check (consumed_pct >= 0 and consumed_pct <= 100),
  archived            boolean not null default false,
  source              text not null default 'manual'
                       check (source in ('manual', 'ai_suggestion', 'recipe')),
  source_ref          text,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

alter table public.meal_prep_batches enable row level security;

create policy "Users manage own batches"
  on public.meal_prep_batches for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index on public.meal_prep_batches (user_id, archived, created_at desc);
