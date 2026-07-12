-- Cadence Fitness — per-user food selection history ("Recents").
-- One row per (user, food) with a use counter and last-used timestamp so the
-- FoodPicker can surface frequently/recently picked foods before the user
-- types a search. Bumped via the bump_food_selection RPC on every pick.

create table if not exists public.food_selections (
  user_id      uuid not null references auth.users(id) on delete cascade,
  food_slug    text not null references public.food_library(slug) on delete cascade,
  use_count    integer not null default 1,
  last_used_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  primary key (user_id, food_slug)
);

create index if not exists food_selections_user_recent_idx
  on public.food_selections (user_id, last_used_at desc);

alter table public.food_selections enable row level security;

drop policy if exists "Users can read own food selections" on public.food_selections;
create policy "Users can read own food selections"
  on public.food_selections for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own food selections" on public.food_selections;
create policy "Users can insert own food selections"
  on public.food_selections for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own food selections" on public.food_selections;
create policy "Users can update own food selections"
  on public.food_selections for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own food selections" on public.food_selections;
create policy "Users can delete own food selections"
  on public.food_selections for delete
  using (auth.uid() = user_id);

-- Atomic "record a pick": insert or bump the counter + timestamp in one shot.
-- Silently no-ops when the slug no longer exists in food_library (stale
-- client cache after a reseed) rather than erroring the picker.
create or replace function public.bump_food_selection(p_food_slug text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (select 1 from public.food_library where slug = p_food_slug) then
    return;
  end if;
  insert into public.food_selections (user_id, food_slug)
  values (auth.uid(), p_food_slug)
  on conflict (user_id, food_slug)
  do update set use_count    = public.food_selections.use_count + 1,
                last_used_at = now();
end
$$;

grant execute on function public.bump_food_selection(text) to authenticated;
