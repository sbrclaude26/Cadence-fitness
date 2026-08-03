-- Fiber tracking.
--
-- Fiber was never extracted from the source datasets, so it existed nowhere:
-- not in the food library, not on logged meals. The build scripts now pull it
-- (USDA nutrient 1079, Open Food Facts fiber_100g) and these columns give it
-- somewhere to live.
--
-- Every column is NULLABLE on purpose. Fiber is unknown for a large minority
-- of foods — SR Legacy omits it for many entries and OFF only has it when the
-- product label carried it. NULL means "we don't know", which the UI shows
-- differently from a real 0 g. Defaulting to 0 would quietly under-report a
-- day's fiber and make the number untrustworthy.

alter table public.food_library
  add column if not exists fiber_per_100g numeric(6,2);

alter table public.meal_logs
  add column if not exists fiber numeric;

alter table public.meal_recipes
  add column if not exists fiber numeric;

alter table public.meal_prep_batches
  add column if not exists total_fiber numeric;

comment on column public.food_library.fiber_per_100g is
  'Dietary fiber per 100g. NULL = not reported by the source, not zero.';
comment on column public.meal_logs.fiber is
  'Fiber grams for this logged meal. NULL = at least one ingredient had unknown fiber.';
comment on column public.meal_recipes.fiber is
  'Per-serving fiber grams. NULL = unknown for at least one ingredient.';
comment on column public.meal_prep_batches.total_fiber is
  'Whole-batch fiber grams. NULL = unknown for at least one ingredient.';
