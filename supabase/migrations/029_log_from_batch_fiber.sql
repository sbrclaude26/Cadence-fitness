-- Carry fiber through the batch-portion logging RPC.
--
-- log_meal_from_batch scales a batch's macros by the portion percentage. With
-- fiber added to meal_prep_batches (migration 028) the RPC has to scale it too,
-- otherwise every meal logged from a batch reports no fiber even when the batch
-- knows it. Null propagates: a batch with unknown fiber logs unknown fiber
-- rather than zero.
--
-- Signature, argument order, security mode and search_path are unchanged from
-- migration 007 — altering any of them would create a second overload and
-- leave existing callers on the old body.

create or replace function public.log_meal_from_batch(
  p_batch_id    uuid,
  p_date        date,
  p_slot        text,
  p_portion_pct numeric
)
returns public.meal_logs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch    public.meal_prep_batches;
  v_log      public.meal_logs;
  v_cal      numeric;
  v_protein  numeric;
  v_carbs    numeric;
  v_fat      numeric;
  v_fiber    numeric;
  v_new_pct  numeric;
begin
  if p_portion_pct is null or p_portion_pct <= 0 or p_portion_pct > 100 then
    raise exception 'portion_pct must be in (0, 100]';
  end if;

  select * into v_batch
    from public.meal_prep_batches
   where id = p_batch_id and user_id = auth.uid();

  if not found then
    raise exception 'batch not found';
  end if;

  v_cal     := v_batch.total_calories * p_portion_pct / 100.0;
  v_protein := v_batch.total_protein  * p_portion_pct / 100.0;
  v_carbs   := v_batch.total_carbs    * p_portion_pct / 100.0;
  v_fat     := v_batch.total_fat      * p_portion_pct / 100.0;
  -- Null stays null: unknown fiber must not be logged as 0 g.
  v_fiber   := v_batch.total_fiber    * p_portion_pct / 100.0;
  v_new_pct := least(100, v_batch.consumed_pct + p_portion_pct);

  insert into public.meal_logs (
    user_id, date, name, slot, calories, protein, carbs, fat, fiber,
    planned, batch_id, portion_pct
  ) values (
    auth.uid(), p_date, v_batch.name, p_slot,
    round(v_cal)::integer, v_protein, v_carbs, v_fat, v_fiber,
    true, v_batch.id, p_portion_pct
  )
  returning * into v_log;

  update public.meal_prep_batches
     set consumed_pct = v_new_pct,
         archived     = (v_new_pct >= 99.5),
         updated_at   = now()
   where id = v_batch.id;

  return v_log;
end;
$$;
