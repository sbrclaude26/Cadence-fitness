-- Cadence Fitness — link meal logs to prep batches
-- slot was written by the app but never in 001_initial.sql; formalize it here.
-- batch_id + portion_pct let a log row reference its source batch while still
-- carrying snapshot macros so daily totals remain immutable.

alter table public.meal_logs
  add column if not exists slot text
    check (slot in ('Breakfast','Lunch','Dinner','Snack') or slot is null),
  add column if not exists batch_id uuid
    references public.meal_prep_batches(id) on delete set null,
  add column if not exists portion_pct numeric
    check (portion_pct > 0 and portion_pct <= 100);

create index if not exists meal_logs_batch_id_idx
  on public.meal_logs (batch_id) where batch_id is not null;
