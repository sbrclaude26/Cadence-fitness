-- Cadence Fitness — store AI batch recipe suggestions on plans
-- Replaces the per-day per-slot meal schedule. days[].meals stays for
-- backward compatibility with archived plans (kept as empty arrays going forward).

alter table public.plans
  add column if not exists suggestions jsonb not null default '[]'::jsonb;
