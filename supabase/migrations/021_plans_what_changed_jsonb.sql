-- Cadence Fitness — convert plans.what_changed from TEXT (storing a
-- JSON.stringify(...) blob) to a real JSONB column. Backfills existing rows:
--   * already-JSON rows (start with '{')  → parsed in place
--   * legacy plain-string rows            → wrapped as { cycleRecap: <text> }
--   * null rows                           → null
-- After backfill, the old TEXT column is dropped and the JSONB column
-- assumes its name. The route writes a raw object going forward.

alter table public.plans
  add column if not exists what_changed_json jsonb;

update public.plans
   set what_changed_json =
     case
       when what_changed is null then null
       when btrim(what_changed) like '{%' then what_changed::jsonb
       else jsonb_build_object('cycleRecap', what_changed)
     end
 where what_changed_json is null;

alter table public.plans drop column if exists what_changed;
alter table public.plans rename column what_changed_json to what_changed;
