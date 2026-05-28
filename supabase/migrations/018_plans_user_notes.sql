-- Cadence Fitness — capture optional user feedback at plan-build time.
--
-- The Plan page now opens a modal before rebuild/queue. The athlete can either
-- (a) write free-text notes about what worked, what didn't, or what they want
-- different this cycle, or (b) confirm the cycle build with no adjustments.
-- Both signals are persisted on the plans row so future cycles can reason
-- about what the athlete asked for last time alongside what actually happened.

alter table public.plans
  add column if not exists user_notes text,
  add column if not exists no_adjustments boolean not null default false;
