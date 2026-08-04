-- Opt out of recipe generation for a cycle.
--
-- Recipes are the largest generated section after the workout days. An athlete
-- who cooks from their own repertoire pays for them on every build and never
-- opens the Meals tab, so the build can skip them entirely.
--
-- Recorded per plan rather than inferred from an empty suggestions array,
-- because "you chose not to build recipes" and "this plan predates recipes" are
-- different states and the Meals tab should say the right one.

alter table public.plans
  add column if not exists recipes_included boolean not null default true;

comment on column public.plans.recipes_included is
  'False when the athlete opted out of recipe generation for this cycle — an empty suggestions array is then intentional, not missing data.';
