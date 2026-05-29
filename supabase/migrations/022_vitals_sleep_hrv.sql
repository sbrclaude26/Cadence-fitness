-- Sleep + HRV columns on vitals. Both are optional — the Apple Health
-- shortcut ingests them when available, the brain reasons gracefully on null.
--
-- sleep_hours: total time actually asleep (not in-bed). Apple Health's
--   "Time Asleep" series, summed across the night ending on `date`.
-- sleep_efficiency_pct: 100 × time-asleep / time-in-bed. Optional; some
--   watches/shortcuts only report time-asleep.
-- hrv_sdnn_ms: HRV measured by SDNN method (milliseconds). Apple Health's
--   `HKQuantityTypeIdentifierHeartRateVariabilitySDNN`. Higher = better
--   autonomic recovery. Personal baselines vary widely — the brain reads
--   trend vs. baseline, not absolute value.

alter table public.vitals
  add column if not exists sleep_hours numeric,
  add column if not exists sleep_efficiency_pct numeric,
  add column if not exists hrv_sdnn_ms numeric;

comment on column public.vitals.sleep_hours is 'Total time asleep (hours) for the night ending on `date`. Apple Health Time Asleep series.';
comment on column public.vitals.sleep_efficiency_pct is 'Sleep efficiency: 100 × asleep / in-bed. Nullable when in-bed window unknown.';
comment on column public.vitals.hrv_sdnn_ms is 'Heart rate variability SDNN in milliseconds. Apple Health HKQuantityTypeIdentifierHeartRateVariabilitySDNN.';
