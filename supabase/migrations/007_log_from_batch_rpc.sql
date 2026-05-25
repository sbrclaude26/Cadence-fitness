-- Cadence Fitness — atomic log-from-batch RPC
-- Inserts a meal_logs row and bumps the batch's consumed_pct in one transaction.
-- Auto-archives the batch when consumed_pct >= 99.5.
-- Returns the inserted meal_logs row.

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
  v_new_pct := least(100, v_batch.consumed_pct + p_portion_pct);

  insert into public.meal_logs (
    user_id, date, name, slot, calories, protein, carbs, fat,
    planned, batch_id, portion_pct
  ) values (
    auth.uid(), p_date, v_batch.name, p_slot,
    round(v_cal)::integer, v_protein, v_carbs, v_fat,
    true, v_batch.id, p_portion_pct
  )
  returning * into v_log;

  update public.meal_prep_batches
     set consumed_pct = v_new_pct,
         archived     = (v_new_pct >= 99.5),
         updated_at   = now()
   where id = v_batch.id;

  return v_log;
end
$$;

grant execute on function public.log_meal_from_batch(uuid, date, text, numeric) to authenticated;
