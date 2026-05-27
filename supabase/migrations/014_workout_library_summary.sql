-- 2-3 sentence prose summary per library entry, generated once by Claude from
-- the entry's name + instructions + muscles. Persistent so the rich panel and
-- the Brain prompt can read it cheaply on every render/plan.

alter table public.workout_library
  add column summary text;
