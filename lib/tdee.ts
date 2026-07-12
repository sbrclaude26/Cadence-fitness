// Daily energy expenditure (TDEE) estimation for the Energy card.
//
// TDEE = BMR + NEAT + TEF + exercise, with each component estimated
// independently so nothing is double-counted:
//
//   BMR      — Mifflin-St Jeor from sex/age/height/weight. The best-validated
//              equation for the general population (ADA comparison studies).
//   NEAT     — non-exercise activity (job, chores, errands) as a fraction of
//              BMR chosen by the user's activity level. These factors are
//              deliberately smaller than the classic 1.2–1.9 TDEE multipliers
//              because logged exercise is counted separately below.
//   TEF      — thermic effect of food from logged macros (protein ~25%,
//              carbs ~8%, fat ~2% of each macro's calories); falls back to a
//              flat 10% of calories when only calories are known.
//   Exercise — logged sessions only. Watch-measured calories get the standard
//              APPLE_WATCH_ACTIVE_KCAL_FACTOR haircut; everything else is a
//              conservative MET estimate net of resting burn (MET − 1) so the
//              hour spent training isn't also billed at BMR rates.
//
// Every function here is pure — the Energy card does the fetching.

import { APPLE_WATCH_ACTIVE_KCAL_FACTOR } from "@/lib/config";
import type { ActivityLevel, Profile } from "@/lib/types";

const KG_PER_LB = 0.45359237;
const CM_PER_IN = 2.54;

// ─── BMR ──────────────────────────────────────────────────────────────────────

export interface BmrInputs {
  sex: "male" | "female";
  birthYear: number;
  heightIn: number;
  weightLb: number;
}

// Returns null when any input is missing/invalid — the card shows the setup
// form instead of a made-up number.
export function bmrMifflinStJeor(p: {
  sex?: "male" | "female" | null;
  birthYear?: number | null;
  heightIn?: number | null;
  weightLb?: number | null;
}, onDate: string): number | null {
  if (!p.sex || !p.birthYear || !p.heightIn || !p.weightLb || p.weightLb <= 0) return null;
  const age = parseInt(onDate.slice(0, 4), 10) - p.birthYear;
  if (age < 10 || age > 110) return null;
  const kg = p.weightLb * KG_PER_LB;
  const cm = p.heightIn * CM_PER_IN;
  const base = 10 * kg + 6.25 * cm - 5 * age;
  return Math.round(p.sex === "male" ? base + 5 : base - 161);
}

export function hasBmrInputs(profile: Profile | null): boolean {
  return !!(profile?.sex && profile?.birth_year && profile?.height_in && profile?.current_weight);
}

// ─── NEAT ─────────────────────────────────────────────────────────────────────

// Fraction of BMR spent on non-exercise movement. sedentary 0.2 ≈ the classic
// 1.2× "desk job, trains separately" floor.
export const NEAT_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 0.2,
  light: 0.35,
  moderate: 0.5,
  very: 0.7,
};

export const ACTIVITY_LEVELS: Array<{ value: ActivityLevel; label: string; hint: string }> = [
  { value: "sedentary", label: "Sedentary", hint: "Desk day, little walking" },
  { value: "light", label: "Lightly active", hint: "Some walking or errands" },
  { value: "moderate", label: "Active", hint: "On your feet much of the day" },
  { value: "very", label: "Very active", hint: "Physical work all day" },
];

export function neatKcal(bmr: number, level: ActivityLevel): number {
  return Math.round(bmr * NEAT_FACTORS[level]);
}

// ─── TEF ──────────────────────────────────────────────────────────────────────

export function tefKcal(intake: { calories: number; protein: number; carbs: number; fat: number }): number {
  const macroCals = intake.protein * 4 + intake.carbs * 4 + intake.fat * 9;
  // Macro-specific thermic costs when macros were actually logged; flat 10%
  // when the user only tracked calories.
  if (macroCals > 0) {
    return Math.round(intake.protein * 4 * 0.25 + intake.carbs * 4 * 0.08 + intake.fat * 9 * 0.02);
  }
  return Math.round((intake.calories || 0) * 0.10);
}

// ─── Exercise ─────────────────────────────────────────────────────────────────

// Minimal row shapes so the module doesn't depend on query select lists.
export interface StrengthLogLite {
  id: string;
  exercise_name: string;
  sets: number;
  notes: string | null;
  apple_workout_id: string | null;
}

export interface CardioSessionLite {
  id: string;
  name: string | null;
  planned_exercise_name: string | null;
  type: string;
  duration_min: number | null;
  avg_speed_mph: number | null;
  calories: number | null;
  notes: string | null;
  apple_workout_id: string | null;
}

export interface AppleWorkoutLite {
  id: string;
  name: string | null;
  type: string;
  duration_min: number | null;
  calories: number | null;
}

export type ExerciseSource = "watch" | "logged" | "estimated";

export interface ExerciseItem {
  name: string;
  kcal: number;
  source: ExerciseSource;
  detail: string; // e.g. "32 min · watch" / "4 sets · est."
}

// Net-of-rest MET formula: gross MET − 1 so the session's resting component
// stays in BMR. kcal/min = MET × 3.5 × kg / 200 (ACSM).
function metKcal(met: number, weightLb: number, minutes: number): number {
  const kg = weightLb * KG_PER_LB;
  return Math.max(0, ((met - 1) * 3.5 * kg) / 200) * minutes;
}

// Conservative MET picks (Compendium of Physical Activities).
function cardioMet(s: CardioSessionLite): number {
  const blob = `${s.name ?? ""} ${s.planned_exercise_name ?? ""}`.toLowerCase();
  const mph = s.avg_speed_mph ?? null;
  if (s.type === "run" || /\brun|jog|sprint\b/.test(blob)) {
    // Running MET ≈ 1.65 × mph is a tight fit to the compendium table.
    return mph != null && mph > 4 ? Math.min(14, 1.65 * mph) : 8;
  }
  if (s.type === "walk" || /\bwalk|treadmill|hike|ruck\b/.test(blob)) {
    if (mph == null) return 3.3;
    if (mph < 2.5) return 2.8;
    if (mph < 3.2) return 3.3;
    if (mph < 3.7) return 3.8;
    return 5.0;
  }
  if (/\bbike|cycl|spin\b/.test(blob)) return 6.0;
  if (/\brow\b/.test(blob)) return 6.0;
  if (/\bswim\b/.test(blob)) return 6.0;
  if (/\bplank|hold|stretch|mobility|yoga\b/.test(blob)) return 2.5;
  return 5.0; // generic cardio
}

// Strength: no duration is logged, so estimate ~3 min per set (set + rest) at
// MET 3.5 ("resistance training, multiple exercises") — the conservative pick
// vs. the compendium's 5.0 "vigorous".
const STRENGTH_MET = 3.5;
const MIN_PER_SET = 3;

export interface ExerciseBreakdown {
  totalKcal: number;
  items: ExerciseItem[];
}

// Dedupe contract: a manual row linked to an Apple Watch session
// (apple_workout_id set) is skipped when that watch row is present — the
// watch measurement wins. Unlinked watch rows count on their own.
export function exerciseKcal(
  strengthLogs: StrengthLogLite[],
  cardioSessions: CardioSessionLite[],
  appleWorkouts: AppleWorkoutLite[],
  weightLb: number | null,
): ExerciseBreakdown {
  const items: ExerciseItem[] = [];
  const appleIds = new Set(appleWorkouts.map((a) => a.id));

  for (const a of appleWorkouts) {
    if (a.calories == null || a.calories <= 0) continue;
    const kcal = a.calories * APPLE_WATCH_ACTIVE_KCAL_FACTOR;
    items.push({
      name: a.name ?? a.type,
      kcal,
      source: "watch",
      detail: `${a.duration_min != null ? `${Math.round(a.duration_min)} min · ` : ""}watch`,
    });
  }

  for (const s of cardioSessions) {
    if ((s.notes ?? "").toLowerCase().trim() === "skipped") continue;
    if (s.apple_workout_id && appleIds.has(s.apple_workout_id)) continue;
    const name = s.name ?? s.planned_exercise_name ?? "Cardio";
    if (s.calories != null && s.calories > 0) {
      items.push({ name, kcal: s.calories, source: "logged", detail: `${s.duration_min != null ? `${Math.round(s.duration_min)} min · ` : ""}logged` });
      continue;
    }
    if (s.duration_min == null || s.duration_min <= 0 || !weightLb) continue;
    const kcal = metKcal(cardioMet(s), weightLb, s.duration_min);
    items.push({ name, kcal, source: "estimated", detail: `${Math.round(s.duration_min)} min · est.` });
  }

  for (const l of strengthLogs) {
    if ((l.notes ?? "").toLowerCase().trim() === "skipped") continue;
    if (l.apple_workout_id && appleIds.has(l.apple_workout_id)) continue;
    if (!l.sets || l.sets <= 0 || !weightLb) continue;
    const minutes = l.sets * MIN_PER_SET;
    const kcal = metKcal(STRENGTH_MET, weightLb, minutes);
    items.push({ name: l.exercise_name, kcal, source: "estimated", detail: `${l.sets} sets · est.` });
  }

  const totalKcal = Math.round(items.reduce((s, i) => s + i.kcal, 0));
  return { totalKcal, items: items.map((i) => ({ ...i, kcal: Math.round(i.kcal) })) };
}

// ─── Assembled breakdown ──────────────────────────────────────────────────────

export interface EnergyBreakdown {
  bmr: number;
  neat: number;
  tef: number;
  exercise: number;
  tdee: number;
  intake: number;
  net: number; // intake − tdee: negative = deficit
}

export function buildEnergyBreakdown(args: {
  bmr: number;
  activityLevel: ActivityLevel;
  intake: { calories: number; protein: number; carbs: number; fat: number };
  exercise: number;
}): EnergyBreakdown {
  const neat = neatKcal(args.bmr, args.activityLevel);
  const tef = tefKcal(args.intake);
  const tdee = args.bmr + neat + tef + args.exercise;
  const intake = Math.round(args.intake.calories || 0);
  return { bmr: args.bmr, neat, tef, exercise: args.exercise, tdee, intake, net: intake - tdee };
}
