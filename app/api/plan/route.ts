import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt, buildUserContext } from "@/lib/ai/coachPrompt";
import { AI_MODEL, AI_TEMPERATURE, MAX_TOKENS_BASE, MAX_TOKENS_PER_DAY, CYCLE_DAYS } from "@/lib/config";
import { toLibraryBrief, type WorkoutLibraryEntry } from "@/lib/workoutLibrary";
import { toFoodBrief, gramsForPortion, macrosFor } from "@/lib/foodLibrary";
import type { FoodLibraryEntry, FoodPortion, Ingredient, IngredientMacros } from "@/lib/types";

// ─── Zod schema ───────────────────────────────────────────────────────────────

// Ingredients on AI plan suggestions now carry a structured shape with
// optional library linkage. Per-ingredient macros are recomputed server-side
// from the library, so they are NOT part of the schema.
const IngredientSchema = z.object({
  slug: z.string().nullable().optional(),
  item: z.string(),
  qty: z.union([z.number(), z.string()]),
  unit: z.string().optional(),
  is_custom: z.boolean().optional(),
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

const CardioTargetSchema = z.object({
  hr_min: z.number().optional(),
  hr_max: z.number().optional(),
  speed_min: z.number().optional(),
  speed_max: z.number().optional(),
  incline_min: z.number().optional(),
  incline_max: z.number().optional(),
  duration_min: z.number().optional(),
});

const WeightBasisSchema = z.enum(["total", "per_side"]);

const ExerciseSchema = z.object({
  name: z.string(),
  type: z.enum(["weight", "bodyweight", "time"]),
  // Library linkage. library_slug is the slug from workout_library (or null
  // when the Brain had to invent an exercise outside the library); is_custom
  // mirrors that signal explicitly so downstream code doesn't have to
  // infer from null.
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
  whatChangedMeals: z.string(),
  whatChangedWorkouts: z.string(),
  days: z.array(DaySchema).length(CYCLE_DAYS),
  groceries: z.array(GrocerySchema),
  suggestions: z.array(SuggestionSchema).min(4),
});

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const mode: "current" | "queued" = body.mode ?? "current";

    // ── Idempotency guard ───────────────────────────────────────────────────
    // If a plan in this mode was created in the last 30s, return it instead of
    // calling Anthropic again. Catches double-tap, accidental refresh, and
    // network retries that the client doesn't realise succeeded server-side.
    const idempotencyWindowMs = 30_000;
    const sinceIso = new Date(Date.now() - idempotencyWindowMs).toISOString();
    const { data: recentPlan } = await supabase
      .from("plans")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", mode)
      .gte("generated_at", sinceIso)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentPlan) {
      return NextResponse.json({ plan: recentPlan, deduped: true });
    }

    // ── Assemble context from Supabase ──────────────────────────────────────
    const [
      { data: profile },
      { data: weights },
      { data: exercises },
      { data: vitals },
      { data: archivedPlans },
      { data: workoutSessions },
      { data: library },
      { data: foodRows },
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", user.id).single(),
      supabase.from("weight_logs").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(20),
      supabase.from("workout_logs").select("*, workout_sets(*)").eq("user_id", user.id).order("date", { ascending: false }).limit(100),
      supabase.from("vitals").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(14),
      supabase.from("plans").select("id").eq("user_id", user.id).eq("status", "archived"),
      supabase.from("workout_sessions").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(30),
      supabase.from("workout_library").select("slug,name,category,level,force,mechanic,equipment,primary_muscles,secondary_muscles,description,summary"),
      supabase
        .from("food_library")
        .select("slug,name,brand,category,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g,source,source_ref,aliases,food_portions(unit,grams_per_unit,description,is_default)")
        .order("name", { ascending: true })
        .limit(800),
    ]);

    const libraryEntries = (library ?? []) as WorkoutLibraryEntry[];
    const libraryBySlug = new Map(libraryEntries.map((e) => [e.slug, e]));
    // Also map by exercise name (case-insensitive) so legacy logs without a
    // library_slug can still pick up a description when their name matches.
    const libraryByName = new Map(libraryEntries.map((e) => [e.name.toLowerCase(), e]));

    type FoodRow = {
      slug: string; name: string; brand: string | null; category: string;
      calories_per_100g: number; protein_per_100g: number; carbs_per_100g: number; fat_per_100g: number;
      source: string; source_ref: string | null; aliases: string[] | null;
      food_portions: Array<{ unit: string; grams_per_unit: number; description: string | null; is_default: boolean }> | null;
    };
    const foodLibraryEntries: FoodLibraryEntry[] = ((foodRows ?? []) as unknown as FoodRow[]).map((r) => {
      const portions: FoodPortion[] = (r.food_portions ?? []).map((p) => ({
        unit: p.unit,
        grams_per_unit: Number(p.grams_per_unit),
        description: p.description,
        is_default: p.is_default,
      }));
      return {
        slug: r.slug,
        name: r.name,
        brand: r.brand,
        category: r.category,
        calories_per_100g: Number(r.calories_per_100g),
        protein_per_100g: Number(r.protein_per_100g),
        carbs_per_100g: Number(r.carbs_per_100g),
        fat_per_100g: Number(r.fat_per_100g),
        source: r.source,
        source_ref: r.source_ref,
        aliases: r.aliases ?? [],
        portions,
      };
    });
    const foodBySlug = new Map(foodLibraryEntries.map((e) => [e.slug, e]));

    if (!profile) return NextResponse.json({ error: "Profile not found. Complete your goals first." }, { status: 400 });

    const cyclesCompleted = archivedPlans?.length ?? 0;
    const daysSinceStart = profile.start_date
      ? Math.max(0, Math.floor((Date.now() - new Date(profile.start_date).getTime()) / 86400000))
      : 0;

    // Compute lastWeight + lastWeightBasis per exercise (most recent non-zero set,
    // preferring per-set rows when present, else falling back to the summary row).
    type SetRow = { set_index: number; reps: number; weight: number; weight_basis: "total" | "per_side"; rpe: number | null };
    type ExerciseRow = {
      exercise_name: string;
      date: string;
      sets: number;
      reps: number;
      weight: number;
      position_in_session: number | null;
      library_slug: string | null;
      workout_session_id: string | null;
      workout_sets?: SetRow[] | null;
    };
    const exerciseRows = (exercises ?? []) as unknown as ExerciseRow[];

    function descriptionFor(slug: string | null, name: string): string | null {
      if (slug && libraryBySlug.has(slug)) return libraryBySlug.get(slug)!.description;
      const byName = libraryByName.get(name.toLowerCase());
      return byName?.description ?? null;
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

    const ctx = buildUserContext({
      profile: {
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
      weightTrend: (weights ?? []).map((w) => ({ date: w.date, value: w.value })).reverse(),
      exerciseHistory: exerciseRows.slice(0, 50).map((x) => {
        const setRows = (x.workout_sets ?? []).slice().sort((a, b) => a.set_index - b.set_index);
        const sets = setRows.length > 0
          ? setRows.map((s) => ({
              set_index: s.set_index,
              reps: s.reps,
              weight: s.weight,
              weight_basis: s.weight_basis,
              rpe: s.rpe,
            }))
          : // Legacy/summary fallback: synthesize a single aggregate "set" entry
            [{ set_index: 1, reps: x.reps, weight: x.weight, weight_basis: "total" as const, rpe: null }];
        return {
          exercise_name: x.exercise_name,
          library_slug: x.library_slug ?? null,
          description: descriptionFor(x.library_slug ?? null, x.exercise_name),
          date: x.date,
          position_in_session: x.position_in_session ?? null,
          workout_session_id: x.workout_session_id ?? null,
          sets,
        };
      }),
      recentVitals: (vitals ?? []).slice(0, 7).map((v) => ({
        date: v.date,
        avg_hr: v.avg_hr,
        active_energy_kcal: v.active_energy_kcal,
        steps: v.steps,
      })),
      recentWorkoutSessions: (workoutSessions ?? []).slice(0, 20).map((s) => ({
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
        associated_exercises: exerciseRows
          .filter((x) => x.workout_session_id === s.id)
          .map((x) => ({
            exercise_name: x.exercise_name,
            date: x.date,
            position_in_session: x.position_in_session ?? null,
          })),
      })),
      workoutLibrary: libraryEntries.map(toLibraryBrief),
      foodLibrary: foodLibraryEntries.map(toFoodBrief),
      cyclesCompleted,
      daysSinceStart,
    });

    // ── AI call with retry ────────────────────────────────────────────────────
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const rawSchema = z.toJSONSchema(PlanOutputSchema) as { properties?: unknown; required?: string[] };

    let parsed: z.infer<typeof PlanOutputSchema> | null = null;
    let lastError = "";

    for (let attempt = 0; attempt < 2; attempt++) {
      let response;
      try {
        response = await anthropic.messages.create({
          model: AI_MODEL,
          max_tokens: MAX_TOKENS_BASE + MAX_TOKENS_PER_DAY * CYCLE_DAYS,
          temperature: AI_TEMPERATURE,
          system: buildSystemPrompt(),
          tools: [{ name: "plan", description: "Output the complete adaptive plan.", input_schema: { type: "object" as const, properties: rawSchema.properties as Record<string, unknown>, required: rawSchema.required ?? [] } }],
          tool_choice: { type: "any" },
          messages: [{ role: "user", content: ctx }],
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(`plan: anthropic call failed (attempt ${attempt + 1})`, lastError);
        continue;
      }

      const toolUse = response.content.find((b) => b.type === "tool_use");
      if (!toolUse || toolUse.type !== "tool_use") { lastError = "No tool_use block in response"; continue; }

      const result = PlanOutputSchema.safeParse(toolUse.input);
      if (result.success) { parsed = result.data; break; }
      lastError = result.error.message;
    }

    if (!parsed) return NextResponse.json({ error: `AI validation failed: ${lastError}` }, { status: 422 });

    // ── Recompute suggestion macros from the food library ─────────────────────
    // The model emits structured ingredients with a slug + qty + unit. We
    // recompute per-ingredient macros deterministically here so the persisted
    // batch totals are always the library's truth (custom ingredients without
    // a slug fall back to a single /api/macros-style estimate further below).
    const anthropicReconciler = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    async function aiGuessCustomMacros(item: string, qtyText: string): Promise<IngredientMacros> {
      try {
        const list = `- ${qtyText} ${item}`;
        const msg = await anthropicReconciler.messages.create({
          model: AI_MODEL,
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
        const slug = ing.slug ?? null;
        const entry = slug ? foodBySlug.get(slug) : undefined;
        if (entry) {
          const m = isFinite(qtyNum) && qtyNum > 0 ? macrosFor(entry, unit, qtyNum) : null;
          if (m) {
            totals = sumPairwise(totals, m);
            enrichedIngredients.push({
              item: entry.name,
              qty: String(qtyNum),
              unit,
              food_slug: slug,
              macros: m,
            });
            continue;
          }
        }
        // Custom or unresolvable: AI estimate.
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

    const reconciledSuggestions = await Promise.all(parsed.suggestions.map(recomputeSuggestion));

    // ── Reconciliation: compare aggregated plan macros to daily target × cycle ──
    // If carbs/fat/protein/calories drift > 8% from target, scale each
    // suggestion's `suggested_servings` proportionally to bring totals in line.
    // We deliberately keep this deterministic (no second Claude call) to bound
    // cost and latency — the meal mix is already fixed; we only adjust portions.
    const dailyCal = parsed.calorieTarget;
    const dailyMacros = parsed.macros; // {protein, carbs, fat}
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
      // Scale every batch's suggested_servings (and recompute its macros and
      // ingredient quantities) by 1/calRatio so total cycle calories land on
      // target. We scale by the calorie ratio because protein/carbs/fat track
      // calorie volume; we'd need to re-prompt Claude to change the macro
      // ratio between batches, which we intentionally don't do here.
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

    // Sanity check: log final drift across all four targets.
    const totalsAfter = planTotals(finalSuggestions);
    console.log("plan: macro reconciliation", {
      target: { cal: cycleCal, p: cycleProtein, c: cycleCarbs, f: cycleFat },
      before: totalsNow,
      after: totalsAfter,
      scaled: drift > tolerance,
    });

    // ── Enrich exercises with lastWeight + basis + library description ────────
    // The description is the canonical text the user and the picker show; we
    // join it in once here so the Plan row in Supabase carries everything
    // needed to render today/log views without re-fetching the library.
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
    const { data: currentPlan } = await supabase.from("plans").select("cycle_number").eq("user_id", user.id).eq("status", "current").single();
    const currentCycleNum = currentPlan?.cycle_number ?? 0;
    const newCycleNum = mode === "queued" ? currentCycleNum + 1 : cyclesCompleted + 1;

    // ── If mode=current, archive existing current ─────────────────────────────
    if (mode === "current") {
      await supabase.from("plans").update({ status: "archived" }).eq("user_id", user.id).eq("status", "current");
      await supabase.from("plans").delete().eq("user_id", user.id).eq("status", "queued");
    } else {
      // queued: delete any existing queued plan
      await supabase.from("plans").delete().eq("user_id", user.id).eq("status", "queued");
    }

    // ── Insert new plan ───────────────────────────────────────────────────────
    const { data: newPlan, error: insertError } = await supabase.from("plans").insert({
      user_id: user.id,
      cycle_number: newCycleNum,
      status: mode,
      generated_at: new Date().toISOString(),
      calorie_target: parsed.calorieTarget,
      macros: parsed.macros,
      what_changed: JSON.stringify({ meals: parsed.whatChangedMeals, workouts: parsed.whatChangedWorkouts }),
      days: enrichedDays as unknown as import("@/lib/types").PlanDay[],
      groceries: parsed.groceries as unknown as import("@/lib/types").Grocery[],
      suggestions: finalSuggestions as unknown as import("@/lib/types").RecipeSuggestion[],
    }).select().single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    return NextResponse.json({ plan: newPlan });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
