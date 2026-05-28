// Workout volume & balance analytics.
//
// Cross-muscle comparison uses "hard sets" (the de-facto hypertrophy-research
// metric — Schoenfeld et al.) so a hard set on chest and a hard set on quads
// are roughly equivalent stimuli regardless of absolute load. Volume load
// (reps × weight × RPE/8) is kept around for within-muscle progression
// tracking, where the load *should* be increasing over time.

import type { Plan, Profile, WorkoutLog, WorkoutSet } from "@/lib/types";
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

// Lookup-time normalization mirrors the index-build in lib/useLibrary.ts.
// Kept in this file (rather than imported) so the analytics module stays
// usable from server contexts without dragging the "use client" hook.
function normalizeNameForLookup(raw: string): string {
  let s = raw.toLowerCase().trim();
  s = s.replace(/\s*\([^)]*\)\s*$/, "");
  const dash = s.indexOf(" - ");
  if (dash > 0) s = s.slice(0, dash);
  s = s.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(
    /^(barbell|dumbbell|cable|machine|smith machine|kettlebell|bodyweight|ez bar|trap bar|weighted)\s+/,
    "",
  );
  s = s.replace(/\btricep\b/g, "triceps").replace(/\bbicep\b/g, "biceps");
  return s;
}

// Resolve a log to its library entry — slug first (canonical), then an exact
// lowercased name match, then a normalized-name fallback (strips equipment
// prefix and variant suffix so a user-typed "Barbell Bench Press" resolves to
// canonical "Bench Press"). The name fallbacks rescue older logs from before
// the library link existed in migration 013 and any custom-but-actually-known
// exercises the user typed by hand.
function resolveLibrary(
  log: WorkoutLog,
  bySlug: Map<string, WorkoutLibraryEntry>,
  byName: Map<string, WorkoutLibraryEntry> | null,
  byNameNorm: Map<string, WorkoutLibraryEntry> | null = null,
): WorkoutLibraryEntry | null {
  if (log.library_slug) {
    const hit = bySlug.get(log.library_slug);
    if (hit) return hit;
  }
  if (log.exercise_name) {
    const lc = log.exercise_name.toLowerCase().trim();
    if (byName) {
      const hit = byName.get(lc);
      if (hit) return hit;
    }
    if (byNameNorm) {
      const norm = normalizeNameForLookup(log.exercise_name);
      const hit = byNameNorm.get(norm);
      if (hit) return hit;
    }
  }
  return null;
}

// Expand workout_logs + workout_sets + library into one HardSet per set,
// with all the derived data pre-computed for downstream aggregations.
export function expandWorkoutsToHardSets(
  logs: WorkoutLog[],
  sets: WorkoutSet[],
  library: Map<string, WorkoutLibraryEntry>,
  profile: Profile | null,
  byName: Map<string, WorkoutLibraryEntry> | null = null,
  byNameNorm: Map<string, WorkoutLibraryEntry> | null = null,
): HardSet[] {
  const logById = new Map<string, WorkoutLog>();
  for (const l of logs) logById.set(l.id, l);
  const bodyweight = profile?.current_weight ?? null;
  const out: HardSet[] = [];
  for (const s of sets) {
    const log = logById.get(s.workout_log_id);
    if (!log) continue;
    const lib = resolveLibrary(log, library, byName, byNameNorm);
    const ew = effectiveWeight(s, lib, bodyweight);
    const hsv = hardSetValue(s.rpe);
    const rpeMult = s.rpe == null ? 1 : s.rpe / 8;
    out.push({
      date: log.date,
      exerciseSlug: lib?.slug ?? log.library_slug ?? null,
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

// Synthesize HardSets from workout_logs alone (no per-set rows). Used for
// older logs where workout_sets is empty — uses the summary `sets` count as
// the hard-set count and the summary `reps`/`weight` as the load. Each log
// contributes `sets` rows so muscle/force aggregations still see the work.
// We can't grade by RPE here (no per-set RPE on the summary row), so each
// synthesized set is treated as hardSetValue=1.0 (the "no RPE = committed"
// convention).
export function synthesizeHardSetsFromLogs(
  logs: WorkoutLog[],
  library: Map<string, WorkoutLibraryEntry>,
  profile: Profile | null,
  byName: Map<string, WorkoutLibraryEntry> | null = null,
  loggedLogIds: Set<string> = new Set(),
  byNameNorm: Map<string, WorkoutLibraryEntry> | null = null,
): HardSet[] {
  const bodyweight = profile?.current_weight ?? null;
  const out: HardSet[] = [];
  for (const log of logs) {
    if (loggedLogIds.has(log.id)) continue; // already covered by workout_sets
    const setCount = log.sets || 0;
    if (setCount <= 0) continue;
    const lib = resolveLibrary(log, library, byName, byNameNorm);
    const fakeSet: WorkoutSet = {
      id: log.id,
      workout_log_id: log.id,
      set_index: 0,
      reps: log.reps || 0,
      weight: log.weight || 0,
      weight_basis: "total",
      rpe: null,
    };
    const ew = effectiveWeight(fakeSet, lib, bodyweight);
    for (let i = 0; i < setCount; i++) {
      out.push({
        date: log.date,
        exerciseSlug: lib?.slug ?? log.library_slug ?? null,
        exerciseName: log.exercise_name,
        primaryMuscles: lib?.primary_muscles ?? [],
        secondaryMuscles: lib?.secondary_muscles ?? [],
        force: lib?.force ?? null,
        hardSetValue: 1.0,
        volumeLoad: (log.reps || 0) * ew,
      });
    }
  }
  return out;
}

// Expand the current plan into planned HardSets — one per planned set on
// each day from `today` through the end of the cycle. Days before today are
// skipped (per the analytics rule: don't count missed work). Days where the
// user actually logged the exercise are also skipped via `loggedKeysByDate`
// so we don't double-count "done + planned" on the same day.
export function expandPlanToHardSets(
  plan: Plan,
  cycleDays: number,
  today: string,
  library: Map<string, WorkoutLibraryEntry>,
  byName: Map<string, WorkoutLibraryEntry> | null,
  profile: Profile | null,
  loggedKeysByDate: Map<string, Set<string>>,
  byNameNorm: Map<string, WorkoutLibraryEntry> | null = null,
): HardSet[] {
  const start = plan.generated_at.slice(0, 10);
  const startDate = new Date(start + "T00:00:00");
  const bodyweight = profile?.current_weight ?? null;
  const out: HardSet[] = [];

  for (let i = 0; i < (plan.days?.length ?? 0); i++) {
    if (i >= cycleDays) break;
    const day = plan.days[i];
    if (!day?.workout?.exercises?.length) continue;
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dateStr = date.toISOString().slice(0, 10);
    // Only count today and future — skip missed/past days.
    if (dateStr < today) continue;

    const loggedKeys = loggedKeysByDate.get(dateStr) ?? new Set<string>();
    for (const ex of day.workout.exercises) {
      const key = exerciseKey(ex.library_slug, ex.name);
      if (loggedKeys.has(key)) continue; // already done today
      const setCount = ex.sets ?? 0;
      if (setCount <= 0) continue;
      const lcName = ex.name ? ex.name.toLowerCase().trim() : null;
      const normName = ex.name ? normalizeNameForLookup(ex.name) : null;
      const lib =
        (ex.library_slug ? library.get(ex.library_slug) : undefined) ??
        (byName && lcName ? byName.get(lcName) ?? null : null) ??
        (byNameNorm && normName ? byNameNorm.get(normName) ?? null : null);
      const fakeSet: WorkoutSet = {
        id: `plan-${plan.id}-${i}-${ex.name}`,
        workout_log_id: "",
        set_index: 0,
        reps: ex.reps ?? 0,
        weight: ex.suggestedWeight ?? 0,
        weight_basis: ex.suggestedWeightBasis ?? ex.weight_basis_default ?? "total",
        rpe: null,
      };
      const ew = effectiveWeight(fakeSet, lib ?? null, bodyweight);
      for (let s = 0; s < setCount; s++) {
        out.push({
          date: dateStr,
          exerciseSlug: lib?.slug ?? ex.library_slug ?? null,
          exerciseName: ex.name,
          primaryMuscles: lib?.primary_muscles ?? [],
          secondaryMuscles: lib?.secondary_muscles ?? [],
          force: lib?.force ?? null,
          hardSetValue: 1.0,
          volumeLoad: (ex.reps ?? 0) * ew,
        });
      }
    }
  }
  return out;
}

// Key used to dedupe planned vs done on the same day. Prefers slug, falls
// back to lowercased name.
export function exerciseKey(slug: string | null | undefined, name: string | null | undefined): string {
  if (slug) return `s:${slug}`;
  if (name) return `n:${name.toLowerCase().trim()}`;
  return "";
}

// Build a map of date → set of exerciseKey for everything actually logged.
// Used by expandPlanToHardSets to avoid double-counting same-day done+planned.
export function buildLoggedKeysByDate(logs: WorkoutLog[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const l of logs) {
    const key = exerciseKey(l.library_slug, l.exercise_name);
    if (!key) continue;
    if (!m.has(l.date)) m.set(l.date, new Set());
    m.get(l.date)!.add(key);
  }
  return m;
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

// Body-region classification used for upper/lower/core balance. Muscles not
// listed (forearms, neck, etc.) fall through to "other" so they show up but
// don't distort the upper/lower ratio.
export type BodyRegion = "upper" | "lower" | "core" | "other";

const REGION_MAP: Record<string, BodyRegion> = {
  chest: "upper",
  shoulders: "upper",
  lats: "upper",
  "middle back": "upper",
  "lower back": "core",
  traps: "upper",
  biceps: "upper",
  triceps: "upper",
  forearms: "upper",
  neck: "upper",
  quadriceps: "lower",
  hamstrings: "lower",
  glutes: "lower",
  calves: "lower",
  adductors: "lower",
  abductors: "lower",
  abdominals: "core",
};

export function regionOf(muscle: string): BodyRegion {
  return REGION_MAP[muscle.toLowerCase()] ?? "other";
}

export interface RegionBreakdown {
  upper: number;
  lower: number;
  core: number;
  other: number;
  untagged: number;
}

// Unique exercise names from sets that didn't resolve to a library entry
// (primaryMuscles empty). Used to surface "what's still untagged?" in the UI
// so the user can either rename or pick a library match.
export function untaggedExerciseNames(expanded: HardSet[]): string[] {
  const seen = new Set<string>();
  for (const h of expanded) {
    if (h.primaryMuscles.length === 0 && h.force == null && h.exerciseName) {
      seen.add(h.exerciseName);
    }
  }
  return Array.from(seen).sort();
}

// Primary-muscle attribution only (so totals match the "Primary muscle" view).
export function hardSetsByRegion(expanded: HardSet[]): RegionBreakdown {
  const out: RegionBreakdown = { upper: 0, lower: 0, core: 0, other: 0, untagged: 0 };
  for (const h of expanded) {
    if (h.primaryMuscles.length === 0) {
      out.untagged += h.hardSetValue;
      continue;
    }
    // Spread hard-set credit evenly across primaries so a chest+triceps press
    // isn't double-counted toward "upper".
    const share = h.hardSetValue / h.primaryMuscles.length;
    for (const m of h.primaryMuscles) {
      out[regionOf(m)] += share;
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

// Monday-anchored week start in YYYY-MM-DD. Mirrors the convention in
// trends/page.tsx so the weekly trend card aligns with the macros chart.
export function weekStartFor(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

// Build [weeks × muscles] grid: muscle → array of weekly hard-set totals,
// oldest to newest, length = numWeeks. Used by the weekly trend card.
export function weeklyTrendByMuscle(
  expanded: HardSet[],
  today: string,
  numWeeks: number,
): { weeks: string[]; byMuscle: Record<string, number[]> } {
  const todayDate = new Date(today + "T00:00:00");
  const thisWeekStart = weekStartFor(today);
  const weeks: string[] = [];
  const wsDate = new Date(thisWeekStart + "T00:00:00");
  for (let i = numWeeks - 1; i >= 0; i--) {
    const d = new Date(wsDate);
    d.setDate(d.getDate() - i * 7);
    weeks.push(d.toISOString().slice(0, 10));
  }
  const weekIndex = new Map<string, number>();
  weeks.forEach((w, i) => weekIndex.set(w, i));

  const byMuscle: Record<string, number[]> = {};
  for (const h of expanded) {
    const ws = weekStartFor(h.date);
    const idx = weekIndex.get(ws);
    if (idx == null) continue;
    for (const m of h.primaryMuscles) {
      if (!byMuscle[m]) byMuscle[m] = Array(numWeeks).fill(0);
      byMuscle[m][idx] += h.hardSetValue;
    }
  }
  // Suppress unused param warning while keeping the API stable for future
  // date-aware fixes (e.g. partial current week scaling).
  void todayDate;
  return { weeks, byMuscle };
}

export interface StaleMuscle {
  muscle: string;
  daysSinceLast: number;
  priorWindowSets: number; // hard sets in the window before the staleness gap
}

// A muscle is "stale" if (a) it had meaningful work in the prior reference
// window, and (b) it has had zero work in the recent staleness window. The
// goal is to flag muscles the user *used to* train but has dropped, not to
// shame them about anatomical curiosities they've never touched.
export function detectStaleMuscles(
  expanded: HardSet[],
  today: string,
  staleDays: number = 14,
  priorRefDays: number = 28,
  minPriorSets: number = 4,
): StaleMuscle[] {
  const t = new Date(today + "T00:00:00");
  const recentCutoff = new Date(t);
  recentCutoff.setDate(recentCutoff.getDate() - (staleDays - 1));
  const recentCutoffStr = recentCutoff.toISOString().slice(0, 10);
  const priorCutoff = new Date(t);
  priorCutoff.setDate(priorCutoff.getDate() - (staleDays + priorRefDays - 1));
  const priorCutoffStr = priorCutoff.toISOString().slice(0, 10);

  // muscle → prior sets, last seen date
  const prior: Record<string, number> = {};
  const lastSeen: Record<string, string> = {};
  for (const h of expanded) {
    for (const m of h.primaryMuscles) {
      if (h.date >= priorCutoffStr && h.date < recentCutoffStr) {
        prior[m] = (prior[m] ?? 0) + h.hardSetValue;
      }
      if (!lastSeen[m] || h.date > lastSeen[m]) lastSeen[m] = h.date;
    }
  }

  // A muscle is stale if it has zero recent work.
  const recentMuscles = new Set<string>();
  for (const h of expanded) {
    if (h.date >= recentCutoffStr) {
      for (const m of h.primaryMuscles) recentMuscles.add(m);
    }
  }

  const out: StaleMuscle[] = [];
  for (const [muscle, priorSets] of Object.entries(prior)) {
    if (priorSets < minPriorSets) continue;
    if (recentMuscles.has(muscle)) continue;
    const last = lastSeen[muscle];
    if (!last) continue;
    const lastDate = new Date(last + "T00:00:00");
    const days = Math.round((t.getTime() - lastDate.getTime()) / 86400000);
    out.push({ muscle, daysSinceLast: days, priorWindowSets: priorSets });
  }
  out.sort((a, b) => b.priorWindowSets - a.priorWindowSets);
  return out;
}
