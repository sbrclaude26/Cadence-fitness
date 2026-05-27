// Workout volume & balance analytics.
//
// Cross-muscle comparison uses "hard sets" (the de-facto hypertrophy-research
// metric — Schoenfeld et al.) so a hard set on chest and a hard set on quads
// are roughly equivalent stimuli regardless of absolute load. Volume load
// (reps × weight × RPE/8) is kept around for within-muscle progression
// tracking, where the load *should* be increasing over time.

import type { Profile, WorkoutLog, WorkoutSet } from "@/lib/types";
import type { WorkoutLibraryEntry } from "@/lib/workoutLibrary";

export type StressWindow = "7d" | "28d" | "90d";

export const WINDOW_DAYS: Record<StressWindow, number> = {
  "7d": 7,
  "28d": 28,
  "90d": 90,
};

export interface HardSet {
  date: string;                 // YYYY-MM-DD (parent log date)
  exerciseSlug: string | null;
  exerciseName: string;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  force: string | null;         // "push" | "pull" | "static" | null | other
  hardSetValue: number;         // 0..1, continuous gradient on RPE
  volumeLoad: number;           // reps × effectiveWeight × (rpe/8 fallback 1)
}

// Continuous gradient. null is treated as "hard" because users generally log
// RPE on real working sets and skip it on warmups (so blank ≈ committed set).
export function hardSetValue(rpe: number | null | undefined): number {
  if (rpe == null) return 1.0;
  if (rpe >= 9) return 1.0;
  if (rpe <= 5) return 0.0;
  return (rpe - 5) / 4;
}

// Per-muscle multipliers for bodyweight movements (weight=0 case). Matched
// loosely by muscle composition rather than exercise name so it works on
// uncommon variations too.
const BW_FACTORS: Array<{ test: (lib: WorkoutLibraryEntry) => boolean; factor: number }> = [
  // Pull-ups, chin-ups: full bodyweight on lats
  { test: (l) => l.primary_muscles.includes("lats") && l.force === "pull", factor: 1.0 },
  // Dips: chest/triceps push with full bodyweight
  { test: (l) => l.primary_muscles.includes("triceps") && l.force === "push" && (l.equipment ?? "").toLowerCase().includes("dip"), factor: 1.0 },
  // Push-ups: chest push, partial bodyweight
  { test: (l) => l.primary_muscles.includes("chest") && l.force === "push", factor: 0.65 },
  // Bodyweight squats / lunges
  { test: (l) => l.primary_muscles.includes("quadriceps"), factor: 0.85 },
  // Static core holds: no rep-driven load (hard-sets still count via reps=1)
  { test: (l) => l.force === "static", factor: 0.0 },
];

function bodyweightFactor(lib: WorkoutLibraryEntry): number {
  for (const rule of BW_FACTORS) if (rule.test(lib)) return rule.factor;
  return 0.65;
}

function effectiveWeight(
  set: WorkoutSet,
  lib: WorkoutLibraryEntry | null,
  bodyweight: number | null,
): number {
  const basisMultiplier = set.weight_basis === "per_side" ? 2 : 1;
  const logged = (set.weight || 0) * basisMultiplier;
  if (set.weight > 0 || !lib || !bodyweight) return logged;
  // Bodyweight substitution only when nothing was logged.
  const bwEquip = (lib.equipment ?? "").toLowerCase();
  const looksBodyweight = bwEquip === "body only" || bwEquip === "" || bwEquip === "none" || lib.equipment == null;
  if (!looksBodyweight) return logged;
  return bodyweight * bodyweightFactor(lib);
}

// Expand workout_logs + workout_sets + library into one HardSet per set,
// with all the derived data pre-computed for downstream aggregations.
export function expandWorkoutsToHardSets(
  logs: WorkoutLog[],
  sets: WorkoutSet[],
  library: Map<string, WorkoutLibraryEntry>,
  profile: Profile | null,
): HardSet[] {
  const logById = new Map<string, WorkoutLog>();
  for (const l of logs) logById.set(l.id, l);
  const bodyweight = profile?.current_weight ?? null;
  const out: HardSet[] = [];
  for (const s of sets) {
    const log = logById.get(s.workout_log_id);
    if (!log) continue;
    const lib = log.library_slug ? library.get(log.library_slug) ?? null : null;
    const ew = effectiveWeight(s, lib, bodyweight);
    const hsv = hardSetValue(s.rpe);
    const rpeMult = s.rpe == null ? 1 : s.rpe / 8;
    out.push({
      date: log.date,
      exerciseSlug: log.library_slug ?? null,
      exerciseName: log.exercise_name,
      primaryMuscles: lib?.primary_muscles ?? [],
      secondaryMuscles: lib?.secondary_muscles ?? [],
      force: lib?.force ?? null,
      hardSetValue: hsv,
      volumeLoad: (s.reps || 0) * ew * rpeMult,
    });
  }
  return out;
}

// Filter helper — date is YYYY-MM-DD; window is days back from today (local).
export function filterToWindow(expanded: HardSet[], window: StressWindow, today: string): HardSet[] {
  const days = WINDOW_DAYS[window];
  // Compute cutoff in local time by going N days back from today's date string.
  const t = new Date(today + "T00:00:00");
  const cutoff = new Date(t);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return expanded.filter((h) => h.date >= cutoffStr && h.date <= today);
}

export type Attribution = "primary" | "secondary";

export function hardSetsByMuscle(
  expanded: HardSet[],
  attribution: Attribution,
): Record<string, number> {
  const out: Record<string, number> = {};
  const weight = attribution === "primary" ? 1.0 : 0.5;
  for (const h of expanded) {
    const muscles = attribution === "primary" ? h.primaryMuscles : h.secondaryMuscles;
    for (const m of muscles) {
      out[m] = (out[m] ?? 0) + h.hardSetValue * weight;
    }
  }
  return out;
}

export interface ForceBreakdown {
  push: number;
  pull: number;
  static: number;
  other: number;     // sets with force=null or untagged library
  untagged: number;  // sets with no library entry at all (custom exercises)
}

export function hardSetsByForce(expanded: HardSet[]): ForceBreakdown {
  const out: ForceBreakdown = { push: 0, pull: 0, static: 0, other: 0, untagged: 0 };
  for (const h of expanded) {
    if (h.primaryMuscles.length === 0 && h.force == null) {
      out.untagged += h.hardSetValue;
      continue;
    }
    if (h.force === "push") out.push += h.hardSetValue;
    else if (h.force === "pull") out.pull += h.hardSetValue;
    else if (h.force === "static") out.static += h.hardSetValue;
    else out.other += h.hardSetValue;
  }
  return out;
}

export interface Imbalance {
  kind: "push_pull" | "quad_ham" | "chest_back";
  ratio: number;        // deficit-side / dominant-side (always ≤ 1 for clarity)
  deficitSide: string;
  dominantSide: string;
  message: string;
}

const PUSH_PULL_BAND: [number, number] = [0.8, 1.25];
const QUAD_HAM_BAND: [number, number] = [0.6, 1.4];
const CHEST_BACK_BAND: [number, number] = [0.8, 1.25];
const MIN_SETS_FOR_SIGNAL = 4;

function pctDeficit(ratio: number): number {
  return Math.round((1 - ratio) * 100);
}

export function detectImbalances(
  byForce: ForceBreakdown,
  byMuscle: Record<string, number>,
  windowLabel: string,
): Imbalance[] {
  const out: Imbalance[] = [];

  // Push vs Pull
  if (byForce.push >= MIN_SETS_FOR_SIGNAL && byForce.pull >= MIN_SETS_FOR_SIGNAL) {
    const ratio = byForce.pull / byForce.push;
    if (ratio < PUSH_PULL_BAND[0]) {
      const r = ratio;
      out.push({
        kind: "push_pull",
        ratio: r,
        deficitSide: "pull",
        dominantSide: "push",
        message: `Pulling work is ${pctDeficit(r)}% below pushing over the last ${windowLabel}. Consider adding a row or pulldown.`,
      });
    } else if (ratio > PUSH_PULL_BAND[1]) {
      const r = 1 / ratio;
      out.push({
        kind: "push_pull",
        ratio: r,
        deficitSide: "push",
        dominantSide: "pull",
        message: `Pushing work is ${pctDeficit(r)}% below pulling over the last ${windowLabel}. Consider adding a press.`,
      });
    }
  } else if (byForce.push + byForce.pull >= MIN_SETS_FOR_SIGNAL) {
    // One side is near zero
    if (byForce.pull < MIN_SETS_FOR_SIGNAL && byForce.push >= MIN_SETS_FOR_SIGNAL) {
      out.push({
        kind: "push_pull",
        ratio: byForce.push > 0 ? byForce.pull / byForce.push : 0,
        deficitSide: "pull",
        dominantSide: "push",
        message: `No meaningful pulling work logged over the last ${windowLabel}. Add a row, pulldown, or pull-up.`,
      });
    }
  }

  // Quads vs Hamstrings
  const quads = byMuscle["quadriceps"] ?? 0;
  const hams = byMuscle["hamstrings"] ?? 0;
  if (quads >= MIN_SETS_FOR_SIGNAL && hams >= MIN_SETS_FOR_SIGNAL) {
    const ratio = hams / quads;
    if (ratio < QUAD_HAM_BAND[0]) {
      out.push({
        kind: "quad_ham",
        ratio,
        deficitSide: "hamstrings",
        dominantSide: "quads",
        message: `Hamstring work is ${pctDeficit(ratio)}% below quads. Consider RDLs or leg curls.`,
      });
    } else if (ratio > QUAD_HAM_BAND[1]) {
      const r = 1 / ratio;
      out.push({
        kind: "quad_ham",
        ratio: r,
        deficitSide: "quads",
        dominantSide: "hamstrings",
        message: `Quad work is ${pctDeficit(r)}% below hamstrings. Consider squats or leg presses.`,
      });
    }
  }

  // Chest vs Upper back
  const chest = byMuscle["chest"] ?? 0;
  const upperBack = (byMuscle["lats"] ?? 0) + (byMuscle["middle back"] ?? 0) + (byMuscle["traps"] ?? 0);
  if (chest >= MIN_SETS_FOR_SIGNAL && upperBack >= MIN_SETS_FOR_SIGNAL) {
    const ratio = upperBack / chest;
    if (ratio < CHEST_BACK_BAND[0]) {
      out.push({
        kind: "chest_back",
        ratio,
        deficitSide: "upper back",
        dominantSide: "chest",
        message: `Upper-back work is ${pctDeficit(ratio)}% below chest. Add face pulls, rows, or pulldowns.`,
      });
    } else if (ratio > CHEST_BACK_BAND[1]) {
      const r = 1 / ratio;
      out.push({
        kind: "chest_back",
        ratio: r,
        deficitSide: "chest",
        dominantSide: "upper back",
        message: `Chest work is ${pctDeficit(r)}% below upper back. Consider a press variation.`,
      });
    }
  }

  return out;
}

// Display helper — convert raw muscle name (lowercase, sometimes multi-word)
// into a presentable label.
export function muscleLabel(muscle: string): string {
  return muscle
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
