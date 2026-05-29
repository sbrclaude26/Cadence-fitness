-- Cadence Fitness — persistent ingredient-name resolution cache.
-- Maps normalized free-text ingredient names ("greek yogurt plain nonfat")
-- to a food_library slug, so the cycle planner's scorer + Haiku fallback
-- only run once per phrase across all users + all requests. Manual
-- overrides let a wrong mapping be corrected without code changes.

create table if not exists public.food_resolutions (
  name_normalized text primary key,
  food_slug       text references public.food_library(slug) on delete set null,
  score           numeric,
  source          text not null default 'auto'
                   check (source in ('auto','ai_guess','manual_override')),
  hit_count       integer not null default 0,
  resolved_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists food_resolutions_slug_idx
  on public.food_resolutions (food_slug) where food_slug is not null;

create index if not exists food_resolutions_hits_idx
  on public.food_resolutions (hit_count desc);

alter table public.food_resolutions enable row level security;

-- The cache is global (the mapping "phrase → slug" is user-agnostic), but we
-- still gate it behind an authenticated session so anonymous traffic can't
-- pollute it. Any signed-in user can read, insert, and bump hit_count.

drop policy if exists "Authenticated users can read resolutions" on public.food_resolutions;
create policy "Authenticated users can read resolutions"
  on public.food_resolutions for select
  using (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can insert resolutions" on public.food_resolutions;
create policy "Authenticated users can insert resolutions"
  on public.food_resolutions for insert
  with check (auth.role() = 'authenticated');

drop policy if exists "Authenticated users can update resolutions" on public.food_resolutions;
create policy "Authenticated users can update resolutions"
  on public.food_resolutions for update
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
