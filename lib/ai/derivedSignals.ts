// Server-side pre-computed signals injected into the cycle-planning brain.
// These are deterministic numbers the LLM should not have to re-derive from
// raw streams — weight rate, meal-log adherence, prior-plan adherence,
// dropped/untagged muscle work, and a haircut-adjusted active-burn estimate.

import {
  CYCLE_DAYS,
  RECENT_ACTIVITY_DAYS,
  APPLE_WATCH_ACTIVE_KCAL_FACTOR,
} from "@/lib/config";
import {
  detectStaleMuscles,
  untaggedExerciseNames,
  type HardSet,
  type StaleMuscle,
} from "@/lib/analytics/workoutStress";

export interface MealLogAdherence {
  loggedDays: number;
  totalDays: number;
  pct: number;                  // 0..1, loggedDays / totalDays
  avgCaloriesLogged: number;    // mean of logged days only (0 if none)
}

export interface PriorPlanAdherence {
  priorCalorieTarget: number;
  avgCaloriesLogged: number;    // mean of logged days within the prior-plan window
  deltaPct: number;             // (actual - target) / target, signed
  daysLogged: number;           // count of logged days within the window
  cycleDays: number;            // window length used (typically CYCLE_DAYS)
}

export interface ActiveBurnEstimate {
  avgDailyActiveKcalAdjusted: number | null; // null when no day has data
  daysWithData: number;
  windowDays: number;
  haircutFactor: number;        // APPLE_WATCH_ACTIVE_KCAL_FACTOR (e.g. 0.7)
}

export interface DerivedSignals {
  recentWeightRatePerWeek: number | null;
  mealLogAdherence: MealLogAdherence;
  priorPlanAdherence: PriorPlanAdherence | null;
  staleMuscles: StaleMuscle[];
  untaggedExerciseNames: string[];
  activeBurn: ActiveBurnEstimate;
}

// Days difference (a − b), ignoring time-of-day. Inputs are YYYY-MM-DD.
function daysBetween(a: string, b: string): number {
  const ta = new Date(a + "T00:00:00").getTime();
  const tb = new Date(b + "T00:00:00").getTime();
  return Math.round((ta - tb) / 86_400_000);
}

function addDays(date: string, n: number): string {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Linear-regression slope of weight (lb/day) over the last `windowDays`,
// returned scaled to lb/week. Null when there are < 2 points or the span
// is < 3 days. weightTrend is ascending by date.
function recentWeightRatePerWeek(
  weightTrend: Array<{ date: string; value: number }>,
  today: string,
  windowDays: number = 14,
): number | null {
  if (weightTrend.length < 2) return null;
  const cutoff = addDays(today, -(windowDays - 1));
  const pts = weightTrend.filter((w) => w.date >= cutoff);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => daysBetween(p.date, pts[0].date));
  const ys = pts.map((p) => p.value);
  const span = xs[xs.length - 1] - xs[0];
  if (span < 3) return null;
  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
  const sumXX = xs.reduce((acc, x) => acc + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  const slopePerDay = (n * sumXY - sumX * sumY) / denom;
  return Math.round(slopePerDay * 7 * 100) / 100;
}

function mealLogAdherence(
  mealLogTrend: Array<{ date: string; calories: number; meal_count: number }>,
  today: string,
  cycleDays: number = CYCLE_DAYS,
): MealLogAdherence {
  const cutoff = addDays(today, -(cycleDays - 1));
  const inWindow = mealLogTrend.filter((m) => m.date >= cutoff && m.date <= today);
  const logged = inWindow.filter((m) => m.meal_count > 0);
  const loggedDays = logged.length;
  const totalDays = cycleDays;
  const avg = loggedDays > 0
    ? Math.round(logged.reduce((a, b) => a + b.calories, 0) / loggedDays)
    : 0;
  return {
    loggedDays,
    totalDays,
    pct: Math.round((loggedDays / totalDays) * 100) / 100,
    avgCaloriesLogged: avg,
  };
}

function priorPlanAdherence(
  priorPlans: Array<{ generated_at: string; calorie_target: number }>,
  mealLogTrend: Array<{ date: string; calories: number; meal_count: number }>,
  cycleDays: number = CYCLE_DAYS,
): PriorPlanAdherence | null {
  if (priorPlans.length === 0) return null;
  const prior = priorPlans[0];
  const start = prior.generated_at.slice(0, 10);
  const end = addDays(start, cycleDays - 1);
  const inWindow = mealLogTrend.filter(
    (m) => m.date >= start && m.date <= end && m.meal_count > 0,
  );
  if (inWindow.length === 0) {
    return {
      priorCalorieTarget: prior.calorie_target,
      avgCaloriesLogged: 0,
      deltaPct: 0,
      daysLogged: 0,
      cycleDays,
    };
  }
  const avg = inWindow.reduce((a, b) => a + b.calories, 0) / inWindow.length;
  const delta = prior.calorie_target > 0
    ? (avg - prior.calorie_target) / prior.calorie_target
    : 0;
  return {
    priorCalorieTarget: prior.calorie_target,
    avgCaloriesLogged: Math.round(avg),
    deltaPct: Math.round(delta * 100) / 100,
    daysLogged: inWindow.length,
    cycleDays,
  };
}

function activeBurn(
  recentVitals: Array<{ date: string; active_energy_kcal: number | null }>,
  windowDays: number = RECENT_ACTIVITY_DAYS,
): ActiveBurnEstimate {
  const withData = recentVitals.filter(
    (v) => v.active_energy_kcal != null && (v.active_energy_kcal as number) > 0,
  );
  const daysWithData = withData.length;
  if (daysWithData === 0) {
    return {
      avgDailyActiveKcalAdjusted: null,
      daysWithData: 0,
      windowDays,
      haircutFactor: APPLE_WATCH_ACTIVE_KCAL_FACTOR,
    };
  }
  const sum = withData.reduce((a, b) => a + (b.active_energy_kcal as number), 0);
  const rawAvg = sum / daysWithData;
  return {
    avgDailyActiveKcalAdjusted: Math.round(rawAvg * APPLE_WATCH_ACTIVE_KCAL_FACTOR),
    daysWithData,
    windowDays,
    haircutFactor: APPLE_WATCH_ACTIVE_KCAL_FACTOR,
  };
}

export function buildDerivedSignals(args: {
  today: string;
  weightTrend: Array<{ date: string; value: number }>;
  mealLogTrend: Array<{ date: string; calories: number; meal_count: number }>;
  priorPlans: Array<{ generated_at: string; calorie_target: number }>;
  recentVitals: Array<{ date: string; active_energy_kcal: number | null }>;
  allHardSets: HardSet[];
}): DerivedSignals {
  return {
    recentWeightRatePerWeek: recentWeightRatePerWeek(args.weightTrend, args.today),
    mealLogAdherence: mealLogAdherence(args.mealLogTrend, args.today),
    priorPlanAdherence: priorPlanAdherence(args.priorPlans, args.mealLogTrend),
    staleMuscles: detectStaleMuscles(args.allHardSets, args.today),
    untaggedExerciseNames: untaggedExerciseNames(args.allHardSets),
    activeBurn: activeBurn(args.recentVitals),
  };
}
