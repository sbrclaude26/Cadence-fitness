-- Link workout_logs to the canonical library. `custom` already exists from
-- 001_initial.sql and now means "this log is freeform, not from the library".
-- library_slug is the FK; null when custom=true.

alter table public.workout_logs
  add column library_slug text references public.workout_library(slug) on delete set null;

create index workout_logs_library_slug_idx on public.workout_logs (library_slug);

-- workout_sessions stores cardio entries; mirror the same link so the Brain's
-- history join can include descriptions for both strength and cardio.
alter table public.workout_sessions
  add column library_slug text references public.workout_library(slug) on delete set null;

create index workout_sessions_library_slug_idx on public.workout_sessions (library_slug);
