-- Canonical food library shared by the meal builder picker and the AI planner.
-- Seeded from USDA FoodData Central (generics) + a curated Open Food Facts
-- subset (popular branded items) + a small hand-authored curated set. Slug is
-- the stable id used by both the picker UI and the AI's plan output. See
-- scripts/seedFoodLibrary.ts.

-- Trigram extension powers fuzzy substring search on food names. Idempotent.
create extension if not exists pg_trgm;

create table if not exists public.food_library (
  slug                text primary key,
  name                text not null,
  brand               text,                                      -- null for generics
  category            text not null,                             -- "protein" | "dairy" | "grain" | "fat" | "veg" | "fruit" | "snack" | "condiment" | "beverage" | "other"
  calories_per_100g   numeric(7,2) not null,
  protein_per_100g    numeric(6,2) not null,
  carbs_per_100g      numeric(6,2) not null,
  fat_per_100g        numeric(6,2) not null,
  source              text not null,                             -- "usda_foundation" | "usda_sr_legacy" | "usda_fndds" | "off" | "curated"
  source_ref          text,                                       -- USDA fdc_id or OFF barcode
  aliases             text[] not null default '{}',              -- search synonyms ("greek yogurt", "yoghurt")
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Household measure equivalents (grams per common unit) — populated from USDA
-- foodPortions where available, otherwise from generic defaults in the seeder.
create table if not exists public.food_portions (
  id                  bigserial primary key,
  food_slug           text not null references public.food_library(slug) on delete cascade,
  unit                text not null,                              -- "g" | "oz" | "tbsp" | "tsp" | "cup" | "slice" | "piece" | "scoop" | "ml"
  grams_per_unit      numeric(8,3) not null,
  description         text,                                       -- "1 tbsp (13.5g)"
  is_default          boolean not null default false              -- shown first in dropdown
);

create index if not exists food_library_name_lower_idx
  on public.food_library (lower(name));
create index if not exists food_library_name_trgm_idx
  on public.food_library using gin (name gin_trgm_ops);
create index if not exists food_library_brand_idx
  on public.food_library (brand) where brand is not null;
create index if not exists food_library_category_idx
  on public.food_library (category);
create index if not exists food_portions_slug_idx
  on public.food_portions (food_slug);

-- Public read — non-sensitive reference data needed by every picker on every
-- meal log. Writes go through the service role only (seed script), so no
-- write policies are created.
alter table public.food_library enable row level security;
alter table public.food_portions enable row level security;

drop policy if exists "Food library is readable by authenticated users" on public.food_library;
create policy "Food library is readable by authenticated users"
  on public.food_library for select
  to authenticated
  using (true);

drop policy if exists "Food portions are readable by authenticated users" on public.food_portions;
create policy "Food portions are readable by authenticated users"
  on public.food_portions for select
  to authenticated
  using (true);
