// Single source of truth for "which plan governs date X" and "which day of the
// cycle is date X". Previously Today, Log, and Trends each rolled their own
// version off `generated_at`, which drifts (UTC) and resets on rebuild/promote
// — causing past days' goals to change retroactively. Everything keys off the
// immutable `cycle_start_date` instead (falling back to generated_at's local
// date for legacy rows).

import { CYCLE_DAYS } from "@/lib/config";
import { localDateStr } from "@/lib/date";
import type { Plan } from "@/lib/types";

// The local YYYY-MM-DD a plan's Day 1 maps to.
export function planStartDate(plan: Plan): string {
  if (plan.cycle_start_date) return plan.cycle_start_date;
  // Legacy rows: derive the local date from generated_at (never slice the UTC
  // ISO string — that rolls past midnight in negative-offset zones).
  return localDateStr(new Date(plan.generated_at));
}

// Whole-day difference (a − b) for YYYY-MM-DD strings, midnight-anchored local.
function daysBetween(a: string, b: string): number {
  const ta = new Date(a + "T00:00:00").getTime();
  const tb = new Date(b + "T00:00:00").getTime();
  return Math.round((ta - tb) / 86_400_000);
}

function addDaysStr(date: string, n: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + n);
  return localDateStr(d);
}

// When two plans share the same cycle_start_date (the user regenerated the
// cycle one or more times), pick the most recently generated one so Today
// and Log line up with what 'current' actually points at. Without this
// tiebreaker, Supabase row order silently determines the winner and the
// archived rebuild can shadow the current plan.
function laterStart(a: Plan, b: Plan): Plan {
  const sa = planStartDate(a);
  const sb = planStartDate(b);
  if (sb > sa) return b;
  if (sa > sb) return a;
  return new Date(b.generated_at).getTime() > new Date(a.generated_at).getTime() ? b : a;
}

// Resolve the plan whose goals/workouts apply to `date`, using strict cycle
// windows with a prior-cycle fallback:
//   1. Among plans whose [start, start+cycleDays) window contains `date`,
//      return the one with the latest start (the most recent covering cycle).
//   2. Else among plans that started on or before `date`, return the latest —
//      the prior cycle (covers gaps between cycles).
//   3. Else `date` precedes every plan → return the earliest plan.
// A plan's window can never reach before its own start, so generating a new
// cycle never reassigns a date an earlier cycle already owned.
export function planForDate(
  plans: Plan[],
  date: string,
  cycleDays: number = CYCLE_DAYS,
): Plan | null {
  if (plans.length === 0) return null;

  const covering = plans.filter((p) => {
    const start = planStartDate(p);
    const end = addDaysStr(start, cycleDays); // exclusive
    return date >= start && date < end;
  });
  if (covering.length > 0) {
    return covering.reduce(laterStart);
  }

  const priorOrSame = plans.filter((p) => planStartDate(p) <= date);
  if (priorOrSame.length > 0) {
    return priorOrSame.reduce(laterStart);
  }

  // date is before every plan → earliest plan.
  return plans.reduce((a, b) =>
    planStartDate(b) < planStartDate(a) ? b : a,
  );
}

// Zero-based index of `date` within `plan`'s cycle. Negative when the date is
// before the plan starts; callers should only render a workout when the index
// is in [0, plan.days.length).
export function planDayIndexForDate(plan: Plan, date: string): number {
  return daysBetween(date, planStartDate(plan));
}
