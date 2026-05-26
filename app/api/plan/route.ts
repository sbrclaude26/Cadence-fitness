import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { buildSystemPrompt, buildUserContext } from "@/lib/ai/coachPrompt";
import { AI_MODEL, AI_TEMPERATURE, MAX_TOKENS_BASE, MAX_TOKENS_PER_DAY, CYCLE_DAYS } from "@/lib/config";

// ─── Zod schema ───────────────────────────────────────────────────────────────

const IngredientSchema = z.object({
  item: z.string(),
  qty: z.string(),
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

const ExerciseSchema = z.object({
  name: z.string(),
  type: z.enum(["weight", "bodyweight", "time"]),
  sets: z.number().optional(),
  reps: z.number().optional(),
  suggestedWeight: z.number().optional(),
  detail: z.string().optional(),
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
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", user.id).single(),
      supabase.from("weight_logs").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(20),
      supabase.from("workout_logs").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(100),
      supabase.from("vitals").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(14),
      supabase.from("plans").select("id").eq("user_id", user.id).eq("status", "archived"),
      supabase.from("workout_sessions").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(30),
    ]);

    if (!profile) return NextResponse.json({ error: "Profile not found. Complete your goals first." }, { status: 400 });

    const cyclesCompleted = archivedPlans?.length ?? 0;
    const daysSinceStart = profile.start_date
      ? Math.max(0, Math.floor((Date.now() - new Date(profile.start_date).getTime()) / 86400000))
      : 0;

    // Compute lastWeight per exercise (most recent)
    const lastWeightByExercise: Record<string, number> = {};
    (exercises ?? []).forEach((x) => {
      if (x.weight > 0 && !(x.exercise_name in lastWeightByExercise)) {
        lastWeightByExercise[x.exercise_name] = x.weight;
      }
    });

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
      exerciseHistory: (exercises ?? []).slice(0, 50).map((x) => ({
        exercise_name: x.exercise_name,
        date: x.date,
        sets: x.sets,
        reps: x.reps,
        weight: x.weight,
      })),
      recentVitals: (vitals ?? []).slice(0, 7).map((v) => ({
        date: v.date,
        avg_hr: v.avg_hr,
        active_energy_kcal: v.active_energy_kcal,
        steps: v.steps,
      })),
      recentWorkoutSessions: (workoutSessions ?? []).slice(0, 20).map((s) => ({
        date: s.date,
        type: s.type,
        name: s.name,
        duration_min: s.duration_min,
        distance_km: s.distance_km,
        calories: s.calories,
        avg_hr: s.avg_hr,
        max_hr: s.max_hr,
      })),
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

    // ── Enrich exercises with lastWeight from logs ────────────────────────────
    const enrichedDays = parsed.days.map((day) => ({
      ...day,
      workout: {
        ...day.workout,
        exercises: day.workout.exercises.map((ex) => ({
          ...ex,
          lastWeight: lastWeightByExercise[ex.name] ?? null,
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
      suggestions: parsed.suggestions as unknown as import("@/lib/types").RecipeSuggestion[],
    }).select().single();

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

    return NextResponse.json({ plan: newPlan });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
