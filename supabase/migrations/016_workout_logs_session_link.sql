-- Associate logged exercises with Apple Watch (workout_sessions) records.
-- One workout_session → many workout_logs. Nullable: association is optional,
-- and existing rows stay untouched. ON DELETE SET NULL so removing a session
-- never destroys the logged exercise — only the link is dropped.

alter table public.workout_logs
  add column if not exists workout_session_id uuid
    references public.workout_sessions(id) on delete set null;

create index if not exists workout_logs_workout_session_id_idx
  on public.workout_logs (workout_session_id);
