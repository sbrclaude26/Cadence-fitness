import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSystemPrompt, buildUserContext, buildLibraryBlock } from "@/lib/ai/coachPrompt";
import {
  AI_MODEL,
  AI_FAST_MODEL,
  AI_TEMPERATURE,
  MAX_TOKENS_BASE,
  MAX_TOKENS_PER_DAY,
  CYCLE_DAYS,
  RECENT_ACTIVITY_DAYS,
} from "@/lib/config";
import { toLibraryBrief, buildLibraryNameIndexes, libraryPromptText, type WorkoutLibraryEntry } from "@/lib/workoutLibrary";
import { macrosFor, resolveIngredientCached } from "@/lib/foodLibrary";
import { parsePlanSummary } from "@/lib/planSummary";
import {
  expandWorkoutsToHardSets,
  synthesizeHardSetsFromLogs,
  buildVolumeBreakdownForBrain,
  summarizeCardioForBrain,
  type CardioSessionLite,
} from "@/lib/analytics/workoutStress";
import { buildDerivedSignals } from "@/lib/ai/derivedSignals";
import { localDateStr } from "@/lib/date";
import type {
  Ingredient,
  IngredientMacros,
  Profile,
  WorkoutLog,
  WorkoutSet,
} from "@/lib/types";

// ─── Zod schema ───────────────────────────────────────────────────────────────

// Ingredients are { item, qty, unit } only — Claude names common grocery foods
// and the server resolves them to canonical library entries via
// resolveIngredientToLibrary. Per-ingredient macros are recomputed server-side.
const IngredientSchema = z.object({
  item: z.string(),
  qty: z.union([z.number(), z.string()]),
  unit: z.string().optional(),
});

const SuggestionSchema = z.object({
  name: z.string(),
  recipe: z.string(),
  ingredients: z.array(IngredientSchema),
  // Whole-batch totals
  calories: z.number(),
  protein: z.number(),
  carbs: z.number(),
  fat: z.number(),
  suggested_servings: z.number().positive(),
  suggested_slot: z.enum(["Breakfast", "Lunch", "Dinner", "Snack"]).optional(),
});

const CardioIntervalsSchema = z.object({
  sets: z.number().int().positive(),
  work_seconds: z.number().positive(),
  rest_seconds: z.number().nonnegative(),
});

const CardioTargetSchema = z.object({
  hr_min: z.number().optional(),
  hr_max: z.number().optional(),
  speed_min: z.number().optional(),
  speed_max: z.number().optional(),
  incline_min: z.number().optional(),
  incline_max: z.number().optional(),
  duration_min: z.number().optional(),
  intervals: CardioIntervalsSchema.optional(),
});

const WeightBasisSchema = z.enum(["total", "per_side"]);

const ExerciseSchema = z.object({
  name: z.string(),
  type: z.enum(["weight", "bodyweight", "time"]),
  library_slug: z.string().nullable(),
  is_custom: z.boolean(),
  sets: z.number().optional(),
  reps: z.number().optional(),
  suggestedWeight: z.number().optional(),
  suggestedWeightBasis: WeightBasisSchema.optional(),
  weight_basis_default: WeightBasisSchema.optional(),
  detail: z.string().optional(),
  cardio_target: CardioTargetSchema.optional(),
});

const DaySchema = z.object({
  label: z.string(),
  workout: z.object({
    name: z.string(),
    exercises: z.array(ExerciseSchema),
  }),
});

const GrocerySchema = z.object({
  item: z.string(),
  qty: z.string(),
  category: z.enum(["Produce", "Protein", "Dairy", "Pantry", "Other"]),
  have: z.boolean(),
});

const PlanOutputSchema = z.object({
  calorieTarget: z.number(),
  macros: z.object({ protein: z.number(), carbs: z.number(), fat: z.number() }),
  cycleRecap: z.string(),
  interpretation: z.string(),
  strategy: z.string(),
  implementation: z.object({
    meals: z.string(),
    workouts: z.string(),
  }),
  days: z.array(DaySchema).length(CYCLE_DAYS),
  groceries: z.array(GrocerySchema),
  suggestions: z.array(SuggestionSchema).min(6),
});

// ─── Supabase row shapes for prior-plan + meal-log context ─────────────────

type MealLogRow = {
  date: string;
  name: string | null;
  slot: string | null;
  calories: number | null;
  protein: number | string | null;
  carbs: number | string | null;
  fat: number | string | null;
  batch_id: string | null;
  portion_pct: number | string | null;
  planned: boolean | null;
};

type SavedRecipeRow = {
  name: string;
  calories: number | string | null;
  protein: number | string | null;
  carbs: number | string | null;
  fat: number | string | null;
  created_at: string;
};

// Minimal slice of the stored plans.days jsonb used for prescribed-vs-actual.
type PlanDayRow = {
  label: string;
  workout: {
    name: string;
    exercises: Array<{
      name: string;
      type: string;
      sets?: number | null;
      reps?: number | null;
      suggestedWeight?: number | null;
      cardio_target?: unknown;
    }>;
  };
};

type PriorPlanRow = {
  cycle_number: number;
  generated_at: string;
  cycle_start_date: string | null;
  calorie_target: number;
  macros: { protein: number; carbs: number; fat: number };
  what_changed: string | null;
  user_notes: string | null;
  no_adjustments: boolean | null;
};

// Aggregate meal_logs into one row per date with summed macros.
function aggregateMealLogsByDay(rows: MealLogRow[]): Array<{
  date: string; calories: number; protein: number; carbs: number; fat: number; meal_count: number;
}> {
  const byDate = new Map<string, { calories: number; protein: number; carbs: number; fat: number; meal_count: number }>();
  for (const r of rows) {
    const cur = byDate.get(r.date) ?? { calories: 0, protein: 0, carbs: 0, fat: 0, meal_count: 0 };
    cur.calories += Number(r.calories ?? 0);
    cur.protein += Number(r.protein ?? 0);
    cur.carbs += Number(r.carbs ?? 0);
    cur.fat += Number(r.fat ?? 0);
    cur.meal_count += 1;
    byDate.set(r.date, cur);
  }
  return Array.from(byDate.entries())
    .map(([date, v]) => ({
      date,
      calories: Math.round(v.calories),
      protein: Math.round(v.protein * 10) / 10,
      carbs: Math.round(v.carbs * 10) / 10,
      fat: Math.round(v.fat * 10) / 10,
      meal_count: v.meal_count,
    }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export type GeneratePlanParams = {
  supabase: SupabaseClient;
  userId: string;
  mode: "current" | "queued";
  userNotes: string | null;
  noAdjustments: boolean;
  /** Day-1 date (YYYY-MM-DD, local) for the new cycle. */
  startDate: string;
  /**
   * Wall-clock budget for the whole build. A schema-validation retry is only
   * attempted if there is plausibly enough time left for a second full AI
   * call; serverless callers set this below their platform's hard limit so a
   * doomed retry doesn't burn tokens and then get killed anyway.
   */
  deadlineMs?: number;
};

export type GeneratePlanResult =
  | { ok: true; plan: unknown; deduped: boolean }
  | { ok: false; status: number; error: string };

export async function generateAndSavePlan(params: GeneratePlanParams): Promise<GeneratePlanResult> {
  const { supabase, userId, mode, userNotes, noAdjustments, startDate } = params;
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  // ── Idempotency guard ───────────────────────────────────────────────────
  // Two windows: any plan within 30s is a double-tap; within 10 minutes, a
  // plan with the same notes + start date is the user retrying after their
  // phone dropped the connection mid-build (builds run multiple minutes, so
  // the first tap's plan often lands after the client already gave up).
  // Return that plan instead of billing a second generation.
  const retryWindowMs = 10 * 60_000;
  const sinceIso = new Date(Date.now() - retryWindowMs).toISOString();
  const { data: recentPlan } = await supabase
    .from("plans")
    .select("*")
    .eq("user_id", userId)
    .eq("status", mode)
    .gte("generated_at", sinceIso)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recentPlan) {
    const ageMs = Date.now() - new Date(recentPlan.generated_at).getTime();
    const sameRequest =
      (recentPlan.user_notes ?? null) === (userNotes ?? null) &&
      (recentPlan.cycle_start_date ?? null) === startDate;
    if (ageMs < 30_000 || sameRequest) {
      return { ok: true, plan: recentPlan, deduped: true };
    }
  }

  // Uniform recent-activity window across every stream. The brain sees the
  // last RECENT_ACTIVITY_DAYS worth of logs without arbitrary per-table caps.
  const recentSinceIso = new Date(Date.now() - RECENT_ACTIVITY_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const [
    { data: profile },
    { data: weights },
    { data: exercises },
    { data: vitals },
    { data: archivedPlans },
    { data: priorPlansFull },
    { data: newestPriorPlanDays },
    { data: workoutSessions },
    { data: appleWorkouts },
    { data: library },
    { data: mealLogs },
    { data: batches },
    { data: savedRecipesRows },
  ] = await Promise.all([
    supabase.from("profiles").select("*").eq("user_id", userId).single(),
    // Weights remain capped at 20 — they're sparse by nature.
    supabase.from("weight_logs").select("*").eq("user_id", userId).order("date", { ascending: false }).limit(60),
    supabase
      .from("workout_logs")
      .select("*, workout_sets(*)")
      .eq("user_id", userId)
      .gte("date", recentSinceIso)
      .order("date", { ascending: false })
      .limit(200),
    supabase
      .from("vitals")
      .select("*")
      .eq("user_id", userId)
      .gte("date", recentSinceIso)
      .order("date", { ascending: false }),
    supabase.from("plans").select("id").eq("user_id", userId).eq("status", "archived"),
    supabase
      .from("plans")
      .select("cycle_number,generated_at,cycle_start_date,calorie_target,macros,what_changed,user_notes,no_adjustments")
      .eq("user_id", userId)
      .in("status", ["archived", "current"])
      .order("generated_at", { ascending: false })
      .limit(6),
    // The just-ended cycle's actual prescriptions, so prescribed-vs-actual
    // comparisons are grounded in real cardio_targets/sets instead of the
    // recap prose. Only the newest plan — days for all 6 would be heavy.
    supabase
      .from("plans")
      .select("days")
      .eq("user_id", userId)
      .in("status", ["archived", "current"])
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("workout_sessions")
      .select("*")
      .eq("user_id", userId)
      .gte("date", recentSinceIso)
      .order("date", { ascending: false }),
    supabase
      .from("apple_workouts")
      .select("*")
      .eq("user_id", userId)
      .gte("date", recentSinceIso)
      .order("date", { ascending: false }),
    supabase.from("workout_library").select("slug,name,category,level,force,mechanic,equipment,primary_muscles,secondary_muscles,description,summary"),
    supabase
      .from("meal_logs")
      .select("date,name,slot,calories,protein,carbs,fat,batch_id,portion_pct,planned")
      .eq("user_id", userId)
      .gte("date", recentSinceIso)
      .order("date", { ascending: false }),
    supabase
      .from("meal_prep_batches")
      .select("name,total_calories,total_protein,total_carbs,total_fat,suggested_servings,consumed_pct,archived,source,created_at,updated_at")
      .eq("user_id", userId)
      .gte("created_at", recentSinceIso)
      .order("created_at", { ascending: false }),
    supabase
      .from("meal_recipes")
      .select("name,calories,protein,carbs,fat,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const libraryEntries = (library ?? []) as WorkoutLibraryEntry[];
  const libraryBySlug = new Map(libraryEntries.map((e) => [e.slug, e]));
  // byName (exact lowercase) + byNameNorm (equipment-prefix/paren/hyphen
  // stripped) so logged names like "Barbell Bench Press" or "Leg Press
  // (Machine)" resolve to canonical library entries — matching the Trends
  // tab. Without byNameNorm the brain saw most logs as untagged.
  const { byName: libraryByName, byNameNorm: libraryByNameNorm } =
    buildLibraryNameIndexes(libraryEntries);

  if (!profile) return { ok: false, status: 400, error: "Profile not found. Complete your goals first." };

  const cyclesCompleted = archivedPlans?.length ?? 0;
  const daysSinceStart = profile.start_date
    ? Math.max(0, Math.floor((Date.now() - new Date(profile.start_date).getTime()) / 86400000))
    : 0;

  // Compute lastWeight + lastWeightBasis per exercise.
  type SetRow = { id: string; workout_log_id: string; set_index: number; reps: number; weight: number; weight_basis: "total" | "per_side"; rpe: number | null };
  type ExerciseRow = {
    id: string;
    exercise_name: string;
    date: string;
    sets: number;
    reps: number;
    weight: number;
    custom: boolean;
    position_in_session: number | null;
    library_slug: string | null;
    apple_workout_id: string | null;
    notes: string | null;
    workout_sets?: SetRow[] | null;
  };
  const exerciseRows = (exercises ?? []) as unknown as ExerciseRow[];

  function descriptionFor(slug: string | null, name: string): string | null {
    if (slug && libraryBySlug.has(slug)) return libraryPromptText(libraryBySlug.get(slug)!);
    const byName = libraryByName.get(name.toLowerCase());
    return byName ? libraryPromptText(byName) : null;
  }

  const lastWeightByExercise: Record<string, number> = {};
  const lastBasisByExercise: Record<string, "total" | "per_side"> = {};
  for (const x of exerciseRows) {
    if (x.exercise_name in lastWeightByExercise) continue;
    const setRows = (x.workout_sets ?? []).filter((s) => s.weight > 0);
    if (setRows.length > 0) {
      const top = setRows.reduce((a, b) => (b.weight > a.weight ? b : a));
      lastWeightByExercise[x.exercise_name] = top.weight;
      lastBasisByExercise[x.exercise_name] = top.weight_basis;
    } else if (x.weight > 0) {
      lastWeightByExercise[x.exercise_name] = x.weight;
      lastBasisByExercise[x.exercise_name] = "total";
    }
  }

  // ── Build volume breakdown (reuses the Trends-tab engine) ─────────────────
  // Flatten the workout_logs + workout_sets into the HardSet shape the
  // analytics module exposes, then run the brain-facing serializer.
  const flatLogs: WorkoutLog[] = exerciseRows.map((x) => ({
    id: x.id,
    date: x.date,
    exercise_name: x.exercise_name,
    sets: x.sets,
    reps: x.reps,
    weight: x.weight,
    custom: x.custom ?? false,
    library_slug: x.library_slug,
    position_in_session: x.position_in_session,
    notes: x.notes,
    apple_workout_id: x.apple_workout_id,
  }));
  const flatSets: WorkoutSet[] = exerciseRows.flatMap((x) =>
    (x.workout_sets ?? []).map((s) => ({
      id: s.id,
      workout_log_id: s.workout_log_id,
      set_index: s.set_index,
      reps: s.reps,
      weight: s.weight,
      weight_basis: s.weight_basis,
      rpe: s.rpe,
    })),
  );
  const loggedLogIds = new Set(flatSets.map((s) => s.workout_log_id));
  const profileForAnalytics = profile as unknown as Profile;
  const expandedSets = expandWorkoutsToHardSets(
    flatLogs,
    flatSets,
    libraryBySlug,
    profileForAnalytics,
    libraryByName,
    libraryByNameNorm,
  );
  const synthesizedSets = synthesizeHardSetsFromLogs(
    flatLogs,
    libraryBySlug,
    profileForAnalytics,
    libraryByName,
    loggedLogIds,
    libraryByNameNorm,
  );
  const allHardSets = [...expandedSets, ...synthesizedSets];

  type ManualSession = {
    duration_min: number | null;
    avg_hr: number | null;
    name: string | null;
    notes: string | null;
  };
  type AppleSession = {
    duration_min: number | null;
    avg_hr: number | null;
    name: string | null;
    notes: string | null;
    type: string | null;
  };
  // Apple Watch rows already represented by a linked manual cardio log
  // (workout_sessions.apple_workout_id) are the same real-world session as
  // that manual entry — counting both doubles the minutes. Strength-type
  // Watch sessions aren't cardio at all; they're linked to workout_logs
  // instead and shouldn't add to cardio minutes either.
  const linkedAppleWorkoutIds = new Set(
    ((workoutSessions ?? []) as Array<{ apple_workout_id: string | null }>)
      .map((s) => s.apple_workout_id)
      .filter((id): id is string => id != null),
  );
  const cardioSources: CardioSessionLite[] = [
    ...((workoutSessions ?? []) as ManualSession[]).map((s) => ({
      duration_min: s.duration_min,
      avg_hr: s.avg_hr,
      name: s.name,
      notes: s.notes,
    })),
    ...((appleWorkouts ?? []) as (AppleSession & { id: string })[])
      .filter((s) => s.type !== "strength" && !linkedAppleWorkoutIds.has(s.id))
      .map((s) => ({
        duration_min: s.duration_min,
        avg_hr: s.avg_hr,
        name: s.name,
        notes: s.notes,
        workout_type: s.type,
      })),
  ];
  const cardioSummary = summarizeCardioForBrain(cardioSources);
  const recentVolumeBreakdown = buildVolumeBreakdownForBrain(
    allHardSets,
    RECENT_ACTIVITY_DAYS,
    cardioSummary,
  );

  const today = localDateStr();
  const mealLogRows = (mealLogs ?? []) as MealLogRow[];
  const mealLogTrend = aggregateMealLogsByDay(mealLogRows);
  const recentMealLogs = mealLogRows.map((m) => ({
    date: m.date,
    slot: m.slot,
    name: m.name,
    calories: Math.round(Number(m.calories ?? 0)),
    protein: Math.round(Number(m.protein ?? 0) * 10) / 10,
    carbs: Math.round(Number(m.carbs ?? 0) * 10) / 10,
    fat: Math.round(Number(m.fat ?? 0) * 10) / 10,
    batch_id: m.batch_id,
    portion_pct: m.portion_pct != null ? Math.round(Number(m.portion_pct)) : null,
    planned: m.planned ?? false,
  }));
  const savedRecipes = ((savedRecipesRows ?? []) as SavedRecipeRow[]).map((r) => ({
    name: r.name,
    calories: Math.round(Number(r.calories ?? 0)),
    protein: Math.round(Number(r.protein ?? 0)),
    carbs: Math.round(Number(r.carbs ?? 0)),
    fat: Math.round(Number(r.fat ?? 0)),
    created_at: r.created_at,
  }));
  const priorPlanRows = (priorPlansFull ?? []) as PriorPlanRow[];

  type BatchRow = {
    name: string;
    total_calories: number | string | null;
    total_protein: number | string | null;
    total_carbs: number | string | null;
    total_fat: number | string | null;
    suggested_servings: number | string | null;
    consumed_pct: number | string | null;
    archived: boolean | null;
    source: string | null;
    created_at: string;
    updated_at: string;
  };
  const recentBatches = ((batches ?? []) as BatchRow[]).map((b) => ({
    name: b.name,
    total_calories: Math.round(Number(b.total_calories ?? 0)),
    total_protein: Math.round(Number(b.total_protein ?? 0)),
    total_carbs: Math.round(Number(b.total_carbs ?? 0)),
    total_fat: Math.round(Number(b.total_fat ?? 0)),
    suggested_servings: b.suggested_servings != null ? Number(b.suggested_servings) : null,
    consumed_pct: Math.round(Number(b.consumed_pct ?? 0)),
    archived: b.archived ?? false,
    source: b.source ?? "manual",
    created_at: b.created_at,
    updated_at: b.updated_at,
  }));

  // Collapse multiple same-day weigh-ins to the latest one (max created_at)
  // so a re-logged day doesn't count double in the trend and skew the
  // regression slope. Same rule the Trends chart applies.
  const weightByDate = new Map<string, { date: string; value: number; created_at?: string }>();
  for (const w of (weights ?? []) as Array<{ date: string; value: number; created_at?: string }>) {
    const prev = weightByDate.get(w.date);
    if (!prev || (w.created_at ?? "") >= (prev.created_at ?? "")) weightByDate.set(w.date, w);
  }
  const weightTrend = Array.from(weightByDate.values())
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => ({ date: w.date, value: w.value }));

  const derived = buildDerivedSignals({
    today,
    weightTrend,
    mealLogTrend,
    priorPlans: priorPlanRows.map((p) => ({
      generated_at: p.generated_at,
      cycle_start_date: p.cycle_start_date,
      calorie_target: p.calorie_target,
    })),
    recentVitals: (vitals ?? []).map((v) => ({
      date: v.date,
      active_energy_kcal: v.active_energy_kcal,
    })),
    allHardSets,
  });

  const ctx = buildUserContext({
    profile: {
      start_weight: profile.start_weight,
      current_weight: profile.current_weight,
      goal_weight: profile.goal_weight,
      target_rate: profile.target_rate,
      primary_goal: profile.primary_goal ?? "",
      goal_event_date: profile.goal_event_date ?? null,
      experience: profile.experience,
      training_history: profile.training_history ?? "",
      exclusions: profile.exclusions ?? "",
      equipment: profile.equipment ?? "",
      workout_days: profile.workout_days ?? "",
      diet_prefs: profile.diet_prefs ?? "",
      pantry: profile.pantry ?? "",
      disruptions: profile.disruptions ?? "",
    },
    weightTrend,
    exerciseHistory: exerciseRows.map((x) => {
      const setRows = (x.workout_sets ?? []).slice().sort((a, b) => a.set_index - b.set_index);
      const sets = setRows.length > 0
        ? setRows.map((s) => ({
            set_index: s.set_index,
            reps: s.reps,
            weight: s.weight,
            weight_basis: s.weight_basis,
            rpe: s.rpe,
          }))
        : [{ set_index: 1, reps: x.reps, weight: x.weight, weight_basis: "total" as const, rpe: null }];
      return {
        exercise_name: x.exercise_name,
        library_slug: x.library_slug ?? null,
        date: x.date,
        position_in_session: x.position_in_session ?? null,
        apple_workout_id: x.apple_workout_id ?? null,
        sets,
      };
    }),
    // One glossary entry per unique logged exercise — the description used
    // to be repeated on every history row (same lift logged 12× in the
    // window = 12 copies of the same description).
    exerciseGlossary: Array.from(
      new Map(
        exerciseRows.map((x) => [
          x.exercise_name,
          {
            exercise_name: x.exercise_name,
            library_slug: x.library_slug ?? null,
            description: descriptionFor(x.library_slug ?? null, x.exercise_name),
          },
        ]),
      ).values(),
    ),
    recentVitals: (vitals ?? []).map((v) => ({
      date: v.date,
      avg_hr: v.avg_hr,
      resting_hr: v.resting_hr ?? null,
      active_energy_kcal: v.active_energy_kcal,
      steps: v.steps,
      sleep_hours: v.sleep_hours ?? null,
      sleep_efficiency_pct: v.sleep_efficiency_pct ?? null,
      hrv_sdnn_ms: v.hrv_sdnn_ms ?? null,
    })),
    recentManualCardio: (workoutSessions ?? []).map((s) => ({
      id: s.id,
      date: s.date,
      type: s.type,
      name: s.name,
      library_slug: s.library_slug ?? null,
      description: descriptionFor(s.library_slug ?? null, s.name ?? ""),
      duration_min: s.duration_min,
      distance_km: s.distance_km,
      calories: s.calories,
      avg_hr: s.avg_hr,
      max_hr: s.max_hr,
      avg_speed_mph: s.avg_speed_mph ?? null,
      avg_incline_pct: s.avg_incline_pct ?? null,
      planned_exercise_name: s.planned_exercise_name ?? null,
      position_in_session: s.position_in_session ?? null,
      notes: s.notes ?? null,
      apple_workout_id: s.apple_workout_id ?? null,
    })),
    recentAppleWorkouts: (appleWorkouts ?? []).map((s) => ({
      id: s.id,
      date: s.date,
      type: s.type,
      name: s.name,
      duration_min: s.duration_min,
      distance_km: s.distance_km,
      calories: s.calories,
      avg_hr: s.avg_hr,
      max_hr: s.max_hr,
      notes: s.notes ?? null,
      associated_exercises: exerciseRows
        .filter((x) => x.apple_workout_id === s.id)
        .map((x) => ({
          exercise_name: x.exercise_name,
          date: x.date,
          position_in_session: x.position_in_session ?? null,
        })),
    })),
    recentVolumeBreakdown,
    cyclesCompleted,
    daysSinceStart,
    mealLogTrend,
    recentMealLogs,
    recentBatches,
    savedRecipes,
    derived,
    priorPlans: priorPlanRows.map((p, i) => {
      const summary = parsePlanSummary(p.what_changed);
      return {
        cycle_number: p.cycle_number,
        generated_at: p.generated_at,
        cycle_start_date: p.cycle_start_date ?? null,
        calorie_target: p.calorie_target,
        macros: p.macros,
        cycle_recap: summary.cycleRecap || null,
        interpretation: summary.interpretation || null,
        strategy: summary.strategy || null,
        implementation_meals: summary.implementationMeals || null,
        implementation_workouts: summary.implementationWorkouts || null,
        user_notes: p.user_notes ?? null,
        no_adjustments: p.no_adjustments ?? false,
        // Newest plan only: the actual prescriptions, compacted to what
        // prescribed-vs-actual needs (names, set/rep targets, cardio targets).
        ...(i === 0 && newestPriorPlanDays?.days
          ? {
              prescribed_days: (newestPriorPlanDays.days as PlanDayRow[]).map((d) => ({
                label: d.label,
                workout: {
                  name: d.workout.name,
                  exercises: d.workout.exercises.map((ex) => ({
                    name: ex.name,
                    type: ex.type,
                    ...(ex.sets != null ? { sets: ex.sets } : {}),
                    ...(ex.reps != null ? { reps: ex.reps } : {}),
                    ...(ex.suggestedWeight != null ? { suggestedWeight: ex.suggestedWeight } : {}),
                    ...(ex.cardio_target != null ? { cardio_target: ex.cardio_target } : {}),
                  })),
                },
              })),
            }
          : {}),
      };
    }),
    userNotes,
    noAdjustments,
    cycleStartDate: startDate,
  });

  console.log("plan: context built", { ms: elapsed(), ctx_chars: ctx.length });

  // ── AI call with retry ────────────────────────────────────────────────────
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const rawSchema = z.toJSONSchema(PlanOutputSchema) as { properties?: unknown; required?: string[] };

  // System is two blocks: the coaching instructions, then the workout
  // library with a cache breakpoint. The library is identical across
  // attempts and rebuilds, so the retry attempt (and any rebuild within the
  // cache TTL) reads it from cache instead of re-ingesting ~100K tokens.
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: buildSystemPrompt() },
    {
      type: "text",
      text: buildLibraryBlock(libraryEntries.map(toLibraryBrief)),
      cache_control: { type: "ephemeral" },
    },
  ];

  let parsed: z.infer<typeof PlanOutputSchema> | null = null;
  let lastError = "";
  let maxTokens = MAX_TOKENS_BASE + MAX_TOKENS_PER_DAY * CYCLE_DAYS;
  // On a validation failure the retry feeds the schema errors back as a
  // tool_result instead of blindly re-rolling the identical request.
  let messages: Anthropic.MessageParam[] = [{ role: "user", content: ctx }];

  for (let attempt = 0; attempt < 2; attempt++) {
    // A retry is a second full multi-minute generation. If the wall-clock
    // budget can't plausibly fit one (attempt 1's duration is the best
    // estimate of attempt 2's), fail fast with the real error instead of
    // burning tokens on a call the platform will kill at its hard limit —
    // that's how builds end as a 504 with two Anthropic bills and no plan.
    if (attempt > 0 && params.deadlineMs != null) {
      const remaining = params.deadlineMs - elapsed();
      if (remaining < elapsed() * 0.9) {
        console.error("plan: skipping retry, not enough time left", { elapsed_ms: elapsed(), deadline_ms: params.deadlineMs });
        break;
      }
    }

    const attemptStart = Date.now();
    let response;
    try {
      // Streamed rather than one-shot: plan generations run multiple minutes,
      // and streaming avoids the SDK's long-request timeout behavior and idle
      // connection drops. finalMessage() resolves to the same Message shape.
      response = await anthropic.messages
        .stream({
          model: AI_MODEL,
          max_tokens: maxTokens,
          temperature: AI_TEMPERATURE,
          system: systemBlocks,
          tools: [{ name: "plan", description: "Output the complete adaptive plan.", input_schema: { type: "object" as const, properties: rawSchema.properties as Record<string, unknown>, required: rawSchema.required ?? [] } }],
          tool_choice: { type: "any" },
          messages,
        })
        .finalMessage();
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.error(`plan: anthropic call failed (attempt ${attempt + 1})`, lastError);
      continue;
    }

    console.log("plan: anthropic usage", {
      attempt: attempt + 1,
      attempt_ms: Date.now() - attemptStart,
      total_ms: elapsed(),
      input_tokens: response.usage?.input_tokens,
      output_tokens: response.usage?.output_tokens,
      cache_read_input_tokens: response.usage?.cache_read_input_tokens,
      cache_creation_input_tokens: response.usage?.cache_creation_input_tokens,
      stop_reason: response.stop_reason,
    });

    // Truncated output can never validate — the tool-call JSON is cut off
    // mid-structure. Retry with a bigger budget instead of the same one.
    if (response.stop_reason === "max_tokens") {
      lastError = `Output hit the ${maxTokens}-token cap and was truncated`;
      maxTokens = Math.ceil(maxTokens * 1.5);
      messages = [{ role: "user", content: ctx }];
      continue;
    }

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") { lastError = "No tool_use block in response"; continue; }

    const result = PlanOutputSchema.safeParse(toolUse.input);
    if (result.success) { parsed = result.data; break; }
    lastError = result.error.message;
    messages = [
      { role: "user", content: ctx },
      { role: "assistant", content: response.content },
      {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: toolUse.id,
          is_error: true,
          content: `Your plan failed schema validation. Errors:\n${lastError.slice(0, 4000)}\n\nCall the plan tool again with a complete, corrected output. Fix exactly what the errors identify and keep everything else the same.`,
        }],
      },
    ];
  }

  if (!parsed) return { ok: false, status: 422, error: `AI validation failed: ${lastError}` };

  // ── Recompute suggestion macros from the food library ─────────────────────
  // Each ingredient arrives as { item, qty, unit }. We resolve the name to a
  // library row via the shared scorer; if confidence is too low, we fall back
  // to a Haiku macro estimate and tag the row as ai_guess.
  const anthropicReconciler = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // Per-request memo on top of the persistent cache: deduplicates within one
  // plan so the same name doesn't re-hit Postgres for each suggestion.
  const resolverCache = new Map<string, Awaited<ReturnType<typeof resolveIngredientCached>>>();
  async function cachedResolve(name: string) {
    const key = name.trim().toLowerCase();
    if (resolverCache.has(key)) return resolverCache.get(key)!;
    const entry = await resolveIngredientCached(supabase, name);
    resolverCache.set(key, entry);
    return entry;
  }

  async function aiGuessCustomMacros(item: string, qtyText: string): Promise<IngredientMacros> {
    try {
      const list = `- ${qtyText} ${item}`;
      const msg = await anthropicReconciler.messages.create({
        model: AI_FAST_MODEL,
        max_tokens: 256,
        temperature: 0,
        messages: [{
          role: "user",
          content: `Estimate macros for this single ingredient. Return ONLY a JSON object with these exact keys:\n{"calories": <number>, "protein": <number>, "carbs": <number>, "fat": <number>}\n\nIngredient:\n${list}`,
        }],
      });
      const text = msg.content[0]?.type === "text" ? msg.content[0].text.trim() : "";
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("no JSON");
      const obj = JSON.parse(match[0]) as Partial<IngredientMacros>;
      return {
        calories: Number(obj.calories) || 0,
        protein: Number(obj.protein) || 0,
        carbs: Number(obj.carbs) || 0,
        fat: Number(obj.fat) || 0,
      };
    } catch {
      return { calories: 0, protein: 0, carbs: 0, fat: 0 };
    }
  }

  async function recomputeSuggestion(s: z.infer<typeof SuggestionSchema>) {
    const enrichedIngredients: Ingredient[] = [];
    let totals: IngredientMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
    for (const ing of s.ingredients) {
      const qtyNum = typeof ing.qty === "number" ? ing.qty : parseFloat(String(ing.qty));
      const unit = ing.unit ?? "g";
      const entry = await cachedResolve(ing.item);
      if (entry) {
        const m = isFinite(qtyNum) && qtyNum > 0 ? macrosFor(entry, unit, qtyNum) : null;
        if (m) {
          totals = sumPairwise(totals, m);
          enrichedIngredients.push({
            item: entry.name,
            qty: String(qtyNum),
            unit,
            food_slug: entry.slug,
            macros: m,
          });
          continue;
        }
      }
      // Resolver missed or qty was invalid: AI estimate.
      const qtyText = isFinite(qtyNum) && qtyNum > 0 ? `${qtyNum} ${unit}`.trim() : "";
      const m = await aiGuessCustomMacros(ing.item, qtyText);
      totals = sumPairwise(totals, m);
      enrichedIngredients.push({
        item: ing.item,
        qty: String(qtyNum || ing.qty),
        unit,
        food_slug: null,
        macros: m,
        ai_guess: true,
      });
    }
    return {
      ...s,
      ingredients: enrichedIngredients,
      calories: round1(totals.calories),
      protein: round1(totals.protein),
      carbs: round1(totals.carbs),
      fat: round1(totals.fat),
    };
  }

  function sumPairwise(a: IngredientMacros, b: IngredientMacros): IngredientMacros {
    return {
      calories: a.calories + b.calories,
      protein: a.protein + b.protein,
      carbs: a.carbs + b.carbs,
      fat: a.fat + b.fat,
    };
  }
  function round1(n: number): number { return Math.round(n * 10) / 10; }

  const reconcileStart = Date.now();
  const reconciledSuggestions = await Promise.all(parsed.suggestions.map(recomputeSuggestion));
  console.log("plan: suggestions reconciled", { ms: Date.now() - reconcileStart, total_ms: elapsed() });

  // ── Reconciliation: scale to daily target × cycle if drift > 8% ──────────
  const dailyCal = parsed.calorieTarget;
  const dailyMacros = parsed.macros;
  const cycleCal = dailyCal * CYCLE_DAYS;
  const cycleProtein = dailyMacros.protein * CYCLE_DAYS;
  const cycleCarbs = dailyMacros.carbs * CYCLE_DAYS;
  const cycleFat = dailyMacros.fat * CYCLE_DAYS;

  function planTotals(suggs: typeof reconciledSuggestions) {
    return suggs.reduce((acc, s) => ({
      calories: acc.calories + s.calories,
      protein: acc.protein + s.protein,
      carbs: acc.carbs + s.carbs,
      fat: acc.fat + s.fat,
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
  }
  const tolerance = 0.08;
  const totalsNow = planTotals(reconciledSuggestions);
  const calRatio = cycleCal > 0 ? totalsNow.calories / cycleCal : 1;
  const drift = Math.abs(calRatio - 1);
  let finalSuggestions = reconciledSuggestions;
  if (drift > tolerance && calRatio > 0) {
    const scale = 1 / calRatio;
    finalSuggestions = reconciledSuggestions.map((s) => {
      const newIngredients: Ingredient[] = s.ingredients.map((ing) => {
        const num = parseFloat(String(ing.qty));
        const scaledQty = isFinite(num) ? num * scale : ing.qty;
        const scaledMacros = ing.macros ? {
          calories: round1(ing.macros.calories * scale),
          protein: round1(ing.macros.protein * scale),
          carbs: round1(ing.macros.carbs * scale),
          fat: round1(ing.macros.fat * scale),
        } : ing.macros;
        return { ...ing, qty: String(round1(Number(scaledQty))), macros: scaledMacros };
      });
      return {
        ...s,
        ingredients: newIngredients,
        suggested_servings: Math.max(1, Math.round(s.suggested_servings)),
        calories: round1(s.calories * scale),
        protein: round1(s.protein * scale),
        carbs: round1(s.carbs * scale),
        fat: round1(s.fat * scale),
      };
    });
  }

  const totalsAfter = planTotals(finalSuggestions);
  console.log("plan: macro reconciliation", {
    target: { cal: cycleCal, p: cycleProtein, c: cycleCarbs, f: cycleFat },
    before: totalsNow,
    after: totalsAfter,
    scaled: drift > tolerance,
  });

  // ── Enrich exercises with lastWeight + basis + library description ────────
  const enrichedDays = parsed.days.map((day) => ({
    ...day,
    workout: {
      ...day.workout,
      exercises: day.workout.exercises.map((ex) => ({
        ...ex,
        lastWeight: lastWeightByExercise[ex.name] ?? null,
        lastWeightBasis: lastBasisByExercise[ex.name] ?? null,
        description: descriptionFor(ex.library_slug, ex.name),
      })),
    },
  }));

  // ── Determine cycle_number ────────────────────────────────────────────────
  const { data: currentPlan } = await supabase.from("plans").select("cycle_number").eq("user_id", userId).eq("status", "current").single();
  const currentCycleNum = currentPlan?.cycle_number ?? 0;
  const newCycleNum = mode === "queued" ? currentCycleNum + 1 : cyclesCompleted + 1;

  // ── If mode=current, archive existing current ─────────────────────────────
  if (mode === "current") {
    await supabase.from("plans").update({ status: "archived" }).eq("user_id", userId).eq("status", "current");
    await supabase.from("plans").delete().eq("user_id", userId).eq("status", "queued");
  } else {
    await supabase.from("plans").delete().eq("user_id", userId).eq("status", "queued");
  }

  // ── Insert new plan ───────────────────────────────────────────────────────
  const { data: newPlan, error: insertError } = await supabase.from("plans").insert({
    user_id: userId,
    cycle_number: newCycleNum,
    status: mode,
    generated_at: new Date().toISOString(),
    cycle_start_date: startDate,
    calorie_target: parsed.calorieTarget,
    macros: parsed.macros,
    what_changed: {
      cycleRecap: parsed.cycleRecap,
      interpretation: parsed.interpretation,
      strategy: parsed.strategy,
      implementationMeals: parsed.implementation.meals,
      implementationWorkouts: parsed.implementation.workouts,
    },
    days: enrichedDays as unknown as import("@/lib/types").PlanDay[],
    groceries: parsed.groceries as unknown as import("@/lib/types").Grocery[],
    suggestions: finalSuggestions as unknown as import("@/lib/types").RecipeSuggestion[],
    user_notes: userNotes,
    no_adjustments: noAdjustments,
  }).select().single();

  if (insertError) return { ok: false, status: 500, error: insertError.message };

  console.log("plan: saved", { total_ms: elapsed(), cycle_number: newCycleNum });
  return { ok: true, plan: newPlan, deduped: false };
}
