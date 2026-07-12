-- TDEE (energy-balance) inputs.
--
-- profiles: static BMR inputs (Mifflin-St Jeor needs sex, age, height — weight
--   already lives in current_weight) plus the user's default non-exercise
--   activity level. All nullable: the Energy card shows an inline setup form
--   until sex/birth_year/height_in are filled in.
-- vitals: per-day activity_level override ("today was mostly on my feet")
--   layered over the profile default. Null = use the profile default.
--
-- activity_level values describe NON-exercise time only (job, chores, walking
-- around) — logged workouts are counted separately, so these are deliberately
-- smaller than the classic 1.2–1.9 TDEE multipliers that bake exercise in.

alter table public.profiles
  add column if not exists sex text check (sex in ('male', 'female')),
  add column if not exists birth_year integer check (birth_year between 1900 and 2100),
  add column if not exists height_in numeric check (height_in > 0),
  add column if not exists activity_level text
    check (activity_level in ('sedentary', 'light', 'moderate', 'very'));

alter table public.vitals
  add column if not exists activity_level text
    check (activity_level in ('sedentary', 'light', 'moderate', 'very'));

comment on column public.profiles.sex is 'Biological sex for the Mifflin-St Jeor BMR constant.';
comment on column public.profiles.birth_year is 'Birth year — enough precision for BMR age; avoids storing full DOB.';
comment on column public.profiles.height_in is 'Height in inches (app is lb/inches throughout).';
comment on column public.profiles.activity_level is 'Default non-exercise activity level for NEAT. Null = sedentary (conservative).';
comment on column public.vitals.activity_level is 'Per-day non-exercise activity override for the Energy card. Null = profile default.';
