import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { trimLoadLedgers } from "@/lib/ai/trimLedgers";
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
  // The prose fields carry their constraints in the schema itself, not only in
  // the system prompt: a distant "don't enumerate lifts" rule was reliably
  // ignored, while the same rule attached to the field being written holds.
  headline: z
    .string()
    .describe(
      "THE VERDICT, <=70 words, spoken plainly as to the athlete's face. Answer: ahead/on/behind pace; is the scale movement fat, water, or lean tissue, and how sure are you; the one thing to change. Flowing sentences only — no metric lists, no lift names, no macro tables, no mention of your own constraints or output rules.",
    ),
  cycleRecap: z
    .string()
    .describe(
      "How last cycle went, <=180 words of prose. Summarize weight direction/rate vs target, how close intake ran to target and whether protein landed, sessions done vs prescribed, and the overall effort trend. NEVER list lifts with loads — 'Bench to 185, Row to 140, Cable Row to 215' is forbidden. Name a lift only if it stalled, was skipped repeatedly, or changes a decision.",
    ),
  interpretation: z
    .string()
    .describe(
      "The 'so what', <=220 words. Fat vs water vs lean-tissue read with its evidence; whether they're eating too much/little and which macro is the lever; whether training was under/well/over-stressed; adherence problem vs prescription problem; your confidence level. Name at most two muscles; never recite the per-muscle volume table.",
    ),
  strategy: z
    .string()
    .describe(
      "This cycle's focus and trade-offs, <=180 words of prose. State the final calorie target and macro split as plain numbers with a one-line rationale. FORBIDDEN in this field: any 'Load changes:'/'Load progressions:' rundown, any list of three or more lifts with loads or hold/progress verdicts, any arithmetic trail such as '200x4 + 155x4 + 70x9 = 2,050'. Exact loads live in days[]; describe the pattern instead ('most lifts hold; one accessory progresses').",
    ),
  implementation: z.object({
    meals: z
      .string()
      .describe(
        "What changed in the food and why, <=160 words. Anchor proteins/carbs, what you swapped vs last cycle and the reason, user-note accommodations, disruption days. The recipes render on the Meals tab — do not restate them.",
      ),
    workouts: z
      .string()
      .describe(
        "What changed in the training and why, <=160 words. The split, where volume rose/fell and why, muscles emphasized vs maintained vs deloaded, any swap or custom exercise with its reason. State load changes as a pattern with at most one or two illustrative examples — never a per-lift ledger; the numbers already render on the Plan and Today tabs.",
      ),
  }),
  days: z.array(DaySchema).length(CYCLE_DAYS),
  groceries: z.array(GrocerySchema),
  suggestions: z.array(SuggestionSchema).min(6),
});

// The plan is generated as three tool calls rather than one, because output
// generation — not input or thinking — is what makes a build take minutes.
// Splitting the largest two sections across concurrent calls cuts the critical
// path to roughly the analysis plus whichever of the two is slower.
//
// Stage 1 (analysis) must land first: it decides the calorie target, the macro
// split and the strategy, and stages 2 and 3 implement that decision. Feeding
// them the strategy text is also what keeps the prose and the structured plan
// describing the same cycle.
const AnalysisOutputSchema = PlanOutputSchema.pick({
  calorieTarget: true,
  macros: true,
  headline: true,
  cycleRecap: true,
  interpretation: true,
  strategy: true,
  implementation: true,
});

const WorkoutsOutputSchema = PlanOutputSchema.pick({ days: true });

// Meals are generated as two concurrent halves. Recipes are the single largest
// block of output, and output generation is the whole cost, so halving it
// halves that leg of the critical path. Groceries are NOT asked for — they are
// a consolidation of the recipes' own ingredients, so the server derives them
// deterministically instead of paying to generate them.
const MealsOutputSchema = z.object({
  suggestions: z.array(SuggestionSchema).min(2),
});

/**
 * The per-stage user directives, exported so the prompt can be documented or
 * reviewed from a single source of truth rather than transcribed by hand.
 * `{decision}` is replaced with stage 1's targets and strategy; `{cycleDays}`
 * with the configured cycle length.
 */
export const PLAN_STAGE_DIRECTIVES = {
  analysis:
    "For THIS call, produce ONLY these fields, and ALL of them: calorieTarget, macros, headline, cycleRecap, interpretation, strategy, implementation.meals, implementation.workouts. " +
    "implementation.meals and implementation.workouts are REQUIRED here even though separate calls build the actual recipes and days — write them as the INTENT those calls must implement (which protein and carb sources and what changed; the split, where volume moves and why). " +
    "Do NOT produce days, suggestions or groceries. Your calorie target, macros and strategy are the specification the other calls implement, so make them explicit and self-contained.",
  workouts:
    "{decision}\n\nFor THIS call, produce only 'days' — the {cycleDays} prescribed days implementing the training intent above. Every exercise must follow the library and cardio-target rules. Do NOT produce prose, suggestions or groceries.",
  mealsA:
    "{decision}\n\nFor THIS call, produce only 'suggestions': exactly 3 batch recipes delivering the meal intent above at the stated calorie and macro targets. Yours are the MAIN MEALS: protein-anchored lunches and dinners. Another call is producing the rest of the week's recipes, so stay in your lane and do not duplicate them. Do NOT produce prose, days or groceries.",
  mealsB:
    "{decision}\n\nFor THIS call, produce only 'suggestions': exactly 3 batch recipes delivering the meal intent above at the stated calorie and macro targets. Yours are BREAKFAST AND SNACKS: at least one breakfast-friendly batch and one snack-style option. Another call is producing the rest of the week's recipes, so stay in your lane and do not duplicate them. Do NOT produce prose, days or groceries.",
} as const;

/** The tool schemas each stage must answer with. Exported for the same reason. */
export const PLAN_STAGE_SCHEMAS = {
  analysis: AnalysisOutputSchema,
  workouts: WorkoutsOutputSchema,
  meals: MealsOutputSchema,
} as const;

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
  /**
   * Generate and validate, but skip the insert and the dedupe short-circuit.
   * Used to evaluate prompt changes against real data without overwriting the
   * athlete's live plan. Returns the parsed output under `plan`.
   */
  dryRun?: boolean;
  /**
   * Generate batch recipes + a shopping list. False skips both meal calls
   * entirely — recipes are the second-largest block of generated output, so an
   * athlete who cooks from their own repertoire shouldn't pay for them.
   */
  includeRecipes?: boolean;
  /**
   * Assemble the athlete context and return it without calling the model.
   * Used to inspect exactly what a build sends — prompt review, payload-size
   * debugging — at zero token cost.
   */
  contextOnly?: boolean;
};

export type GeneratePlanResult =
  | { ok: true; plan: unknown; deduped: boolean }
  | { ok: true; contextOnly: true; context: string }
  | { ok: false; status: number; error: string };

export async function generateAndSavePlan(params: GeneratePlanParams): Promise<GeneratePlanResult> {
  const { supabase, userId, mode, userNotes, noAdjustments, startDate, dryRun } = params;
  const includeRecipes = params.includeRecipes !== false;
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
  if (recentPlan && !dryRun) {
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
        headline: summary.headline || null,
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

  if (params.contextOnly) return { ok: true, contextOnly: true, context: ctx };

  // ── AI calls: analysis, then workouts + meals in parallel ────────────────
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // System is two blocks: the coaching instructions, then the workout
  // library with a cache breakpoint. Both are byte-identical across all three
  // calls and across rebuilds, so only the first call ingests them — the rest
  // read ~100K tokens from cache.
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: buildSystemPrompt() },
    {
      type: "text",
      text: buildLibraryBlock(libraryEntries.map(toLibraryBrief)),
      cache_control: { type: "ephemeral" },
    },
  ];

  // The athlete's context is large and identical for every call, so it gets its
  // own cache breakpoint. Stage 1 writes the cache; the parallel stage reads it
  // instead of re-ingesting the whole history twice.
  const contextBlock: Anthropic.TextBlockParam = {
    type: "text",
    text: ctx,
    cache_control: { type: "ephemeral" },
  };

  /**
   * One tool call with the existing retry behaviour: a truncated response
   * retries with a bigger budget, a schema failure retries with the errors fed
   * back as a tool_result. Returns null when both attempts fail.
   */
  async function callStage<T extends z.ZodTypeAny>(
    label: string,
    schema: T,
    directive: string,
    startingMaxTokens: number,
  ): Promise<{ data: z.infer<T> } | { error: string }> {
    const raw = z.toJSONSchema(schema) as { properties?: unknown; required?: string[] };
    let maxTokens = startingMaxTokens;
    let lastError = "";
    let messages: Anthropic.MessageParam[] = [
      { role: "user", content: [contextBlock, { type: "text", text: directive }] },
    ];

    for (let attempt = 0; attempt < 2; attempt++) {
      // A retry is another full generation. If the wall-clock budget can't
      // plausibly fit one, fail with the real error instead of burning tokens
      // on a call the platform will kill anyway.
      if (attempt > 0 && params.deadlineMs != null) {
        const remaining = params.deadlineMs - elapsed();
        if (remaining < 45_000) {
          console.error(`plan: ${label} skipping retry, not enough time left`, { elapsed_ms: elapsed() });
          break;
        }
      }

      const attemptStart = Date.now();
      let response;
      try {
        response = await anthropic.messages
          .stream({
            model: AI_MODEL,
            max_tokens: maxTokens,
            temperature: AI_TEMPERATURE,
            system: systemBlocks,
            tools: [{ name: label, description: `Output the ${label} section of the plan.`, input_schema: { type: "object" as const, properties: raw.properties as Record<string, unknown>, required: raw.required ?? [] } }],
            tool_choice: { type: "any" },
            messages,
          })
          .finalMessage();
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(`plan: ${label} call failed (attempt ${attempt + 1})`, lastError);
        continue;
      }

      console.log("plan: anthropic usage", {
        stage: label,
        attempt: attempt + 1,
        attempt_ms: Date.now() - attemptStart,
        total_ms: elapsed(),
        input_tokens: response.usage?.input_tokens,
        output_tokens: response.usage?.output_tokens,
        cache_read_input_tokens: response.usage?.cache_read_input_tokens,
        cache_creation_input_tokens: response.usage?.cache_creation_input_tokens,
        stop_reason: response.stop_reason,
      });

      if (response.stop_reason === "max_tokens") {
        lastError = `${label}: output hit the ${maxTokens}-token cap and was truncated`;
        maxTokens = Math.ceil(maxTokens * 1.5);
        messages = [{ role: "user", content: [contextBlock, { type: "text", text: directive }] }];
        continue;
      }

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") { lastError = `${label}: no tool_use block in response`; continue; }

      const result = schema.safeParse(toolUse.input);
      if (result.success) return { data: result.data };
      lastError = result.error.message;
      // A schema failure costs a whole extra generation, so make the reason
      // visible rather than inferring it from a retry count.
      console.error("plan: schema validation failed", {
        stage: label,
        attempt: attempt + 1,
        keys: Object.keys((toolUse.input ?? {}) as Record<string, unknown>),
        error: lastError.slice(0, 600),
      });
      messages = [
        { role: "user", content: [contextBlock, { type: "text", text: directive }] },
        { role: "assistant", content: response.content },
        {
          role: "user",
          content: [{
            type: "tool_result",
            tool_use_id: toolUse.id,
            is_error: true,
            content: `Your output failed schema validation. Errors:\n${lastError.slice(0, 4000)}\n\nCall the ${label} tool again with a complete, corrected output. Fix exactly what the errors identify and keep everything else the same.`,
          }],
        },
      ];
    }
    return { error: lastError };
  }

  // Stage 1 — the decisions. Small output, so this is the short leg.
  const analysis = await callStage(
    "analysis",
    AnalysisOutputSchema,
    PLAN_STAGE_DIRECTIVES.analysis,
    MAX_TOKENS_BASE,
  );
  if ("error" in analysis) return { ok: false, status: 422, error: `AI validation failed: ${analysis.error}` };

  // Stage 2 — implement that decision. These two don't depend on each other,
  // and they are the two biggest chunks of output, so they run concurrently.
  const decision = `THE DECISIONS FOR THIS CYCLE (already made — implement them, do not revisit):
calorieTarget: ${analysis.data.calorieTarget}
macros: protein ${analysis.data.macros.protein}g, carbs ${analysis.data.macros.carbs}g, fat ${analysis.data.macros.fat}g
strategy: ${analysis.data.strategy}
meal plan intent: ${analysis.data.implementation.meals}
training intent: ${analysis.data.implementation.workouts}`;

  const mealHalf = (which: string, lanes: string) =>
    callStage(
      `meals_${which}`,
      MealsOutputSchema,
      lanes.replace("{decision}", decision),
      Math.ceil(MAX_TOKENS_BASE / 2),
    );

  const [workouts, mealsA, mealsB] = await Promise.all([
    callStage(
      "workouts",
      WorkoutsOutputSchema,
      PLAN_STAGE_DIRECTIVES.workouts.replace("{decision}", decision).replace("{cycleDays}", String(CYCLE_DAYS)),
      MAX_TOKENS_PER_DAY * CYCLE_DAYS,
    ),
    includeRecipes ? mealHalf("a", PLAN_STAGE_DIRECTIVES.mealsA) : null,
    includeRecipes ? mealHalf("b", PLAN_STAGE_DIRECTIVES.mealsB) : null,
  ]);
  if ("error" in workouts) return { ok: false, status: 422, error: `AI validation failed: ${workouts.error}` };
  if (mealsA && "error" in mealsA) return { ok: false, status: 422, error: `AI validation failed: ${mealsA.error}` };
  if (mealsB && "error" in mealsB) return { ok: false, status: 422, error: `AI validation failed: ${mealsB.error}` };
  const allSuggestions = [
    ...(mealsA && "data" in mealsA ? mealsA.data.suggestions : []),
    ...(mealsB && "data" in mealsB ? mealsB.data.suggestions : []),
  ];

  // Merged back into the single shape the rest of this function expects, so
  // reconciliation, enrichment and persistence are untouched by the split.
  const parsed: z.infer<typeof PlanOutputSchema> = {
    ...analysis.data,
    days: workouts.data.days,
    suggestions: allSuggestions,
    // Filled in after the library reconciliation below, from the ingredients
    // the recipes actually resolved to.
    groceries: [],
  };

  // ── Strip per-lift load ledgers from the prose ────────────────────────────
  // The prompt and the tool-schema field descriptions both forbid them, which
  // cut them down but never out — across test builds the model kept writing a
  // "Load progressions:" rundown somewhere. Enforce it deterministically; the
  // per-exercise numbers already render from days[] on the Plan/Today tabs.
  parsed.headline = trimLoadLedgers(parsed.headline);
  parsed.cycleRecap = trimLoadLedgers(parsed.cycleRecap);
  parsed.interpretation = trimLoadLedgers(parsed.interpretation);
  parsed.strategy = trimLoadLedgers(parsed.strategy);
  parsed.implementation.meals = trimLoadLedgers(parsed.implementation.meals);
  parsed.implementation.workouts = trimLoadLedgers(parsed.implementation.workouts);

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

  // ── Groceries: consolidate the reconciled ingredients ────────────────────
  // Generated output is the entire cost of a build, and a shopping list is a
  // pure function of the recipes' ingredients — so it's built here instead of
  // being paid for twice (once as recipe ingredients, once as a list).
  function categoryFor(item: string): "Produce" | "Protein" | "Dairy" | "Pantry" | "Other" {
    const n = item.toLowerCase();
    if (/chicken|beef|pork|turkey|salmon|tuna|fish|shrimp|egg|tofu|tempeh|steak|lamb|bacon|sausage/.test(n)) return "Protein";
    if (/milk|yogurt|yoghurt|cheese|butter|cream|kefir|cottage/.test(n)) return "Dairy";
    if (/lettuce|spinach|kale|broccoli|pepper|onion|garlic|tomato|potato|carrot|celery|cucumber|zucchini|mushroom|avocado|banana|apple|berry|berries|orange|lemon|lime|grape|melon|peach|pear|greens|squash|asparagus|cabbage/.test(n)) return "Produce";
    if (/rice|oat|pasta|bread|flour|bean|lentil|quinoa|sugar|oil|vinegar|sauce|spice|salt|pepper|powder|honey|syrup|nut|seed|almond|peanut|broth|stock|tortilla|cereal/.test(n)) return "Pantry";
    return "Other";
  }

  const groceryMap = new Map<string, { item: string; qty: string; category: ReturnType<typeof categoryFor> }>();
  for (const sug of finalSuggestions) {
    for (const ing of (sug.ingredients ?? []) as Ingredient[]) {
      const name = (ing.item ?? "").trim();
      if (!name) continue;
      const key = name.toLowerCase();
      const existing = groceryMap.get(key);
      const qty = `${ing.qty ?? ""}${ing.unit ? ` ${ing.unit}` : ""}`.trim();
      if (!existing) {
        groceryMap.set(key, { item: name, qty, category: categoryFor(name) });
        continue;
      }
      // Same ingredient across recipes: sum when the units agree, otherwise
      // list both rather than inventing a conversion.
      const prevNum = parseFloat(existing.qty);
      const nextNum = parseFloat(qty);
      const prevUnit = existing.qty.replace(/^[\d.]+\s*/, "");
      const nextUnit = qty.replace(/^[\d.]+\s*/, "");
      existing.qty = isFinite(prevNum) && isFinite(nextNum) && prevUnit === nextUnit
        ? `${Math.round((prevNum + nextNum) * 10) / 10}${prevUnit ? ` ${prevUnit}` : ""}`
        : `${existing.qty} + ${qty}`;
    }
  }
  parsed.groceries = [...groceryMap.values()].map((g) => ({ ...g, have: false }));

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

  if (dryRun) {
    console.log("plan: dry run — skipping insert", { total_ms: elapsed() });
    return { ok: true, plan: parsed, deduped: false };
  }

  // ── Insert new plan ───────────────────────────────────────────────────────
  const { data: newPlan, error: insertError } = await supabase.from("plans").insert({
    user_id: userId,
    cycle_number: newCycleNum,
    status: mode,
    generated_at: new Date().toISOString(),
    cycle_start_date: startDate,
    recipes_included: includeRecipes,
    calorie_target: parsed.calorieTarget,
    macros: parsed.macros,
    what_changed: {
      headline: parsed.headline,
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
