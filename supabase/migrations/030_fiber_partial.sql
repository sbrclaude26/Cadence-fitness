-- Partial fiber totals.
--
-- Migration 028 made fiber all-or-nothing: one ingredient with no fiber data
-- nulled the whole meal. In practice that discarded a lot of real signal —
-- across the athlete's batches, 28 of the 36 that came back "unknown" actually
-- had ~75% of their ingredients resolved, usually blocked by a single soy
-- sauce or protein powder.
--
-- Now the known ingredients are summed and the row records whether anything
-- was missing. A partial total is a FLOOR: the true value is at least this
-- much. The UI renders it as "≥ 14g" so it is never confused with an exact
-- figure, which keeps the number honest while making it useful.

alter table public.meal_logs
  add column if not exists fiber_partial boolean not null default false;

alter table public.meal_recipes
  add column if not exists fiber_partial boolean not null default false;

alter table public.meal_prep_batches
  add column if not exists total_fiber_partial boolean not null default false;

comment on column public.meal_logs.fiber_partial is
  'True when at least one ingredient had no fiber data — fiber is a floor, not an exact total.';
comment on column public.meal_recipes.fiber_partial is
  'True when at least one ingredient had no fiber data — fiber is a floor, not an exact total.';
comment on column public.meal_prep_batches.total_fiber_partial is
  'True when at least one ingredient had no fiber data — total_fiber is a floor, not an exact total.';
