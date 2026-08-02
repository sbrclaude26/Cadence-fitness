-- Background plan builds.
--
-- A cycle build is one multi-minute Claude call. It used to run inside the
-- request the user's phone was holding open, so the app sat on a spinner for
-- the whole generation and backgrounding the PWA (or locking the phone) left
-- the user with no way to see the result — the plan landed in the DB but the
-- client that started it was gone.
--
-- The build now runs after the response is sent and reports progress through
-- this table, so the client can poll, navigate away, or close the app and
-- pick the result up later.

create table if not exists public.plan_builds (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'building' check (status in ('building', 'done', 'error')),
  mode         text not null check (mode in ('current', 'queued')),
  start_date   date not null,
  user_notes   text,
  no_adjustments boolean not null default false,
  plan_id      uuid references public.plans(id) on delete set null,
  error        text,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz
);

-- The client polls "my most recent build" — index the lookup.
create index if not exists plan_builds_user_started_idx
  on public.plan_builds (user_id, started_at desc);

alter table public.plan_builds enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'plan_builds' and policyname = 'plan_builds_select_own'
  ) then
    create policy plan_builds_select_own on public.plan_builds
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'plan_builds' and policyname = 'plan_builds_insert_own'
  ) then
    create policy plan_builds_insert_own on public.plan_builds
      for insert with check (auth.uid() = user_id);
  end if;

  -- Updates come from the server-side background task using the service role,
  -- which bypasses RLS; users never write status transitions themselves.
end $$;

comment on table public.plan_builds is 'In-flight and completed background cycle builds, so the client can poll instead of holding the request open.';
