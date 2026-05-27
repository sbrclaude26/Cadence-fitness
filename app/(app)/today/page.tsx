"use client";

import { useEffect, useState } from "react";
import {
  Scale, Target, CalendarClock, Flame, UtensilsCrossed, Dumbbell, Sparkles, CalendarPlus,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { Stat } from "@/components/ui/Stat";
import { MacroBar } from "@/components/ui/MacroBar";
import { FlexMealLogger } from "@/components/meals/FlexMealLogger";
import { WorkoutChecklist, type WorkoutLogPayload, type LoggedRecord, type SetEntry } from "@/components/workout/WorkoutChecklist";
import { primaryBtnStyle, ghostBtnStyle, inputStyle } from "@/components/ui/styles";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CYCLE_DAYS } from "@/lib/config";
import { localDateStr } from "@/lib/date";
import type { Plan, Profile, MealLog, WeightLog, MealRecipe, MealPrepBatch, MealSlot } from "@/lib/types";

const todayStr = () => localDateStr();
const daysBetween = (a: string, b: string) =>
  Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000);

export default function TodayPage() {
  const supabase = createClient();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [todayMeals, setTodayMeals] = useState<MealLog[]>([]);
  const [weights, setWeights] = useState<WeightLog[]>([]);
  const [savedRecipes, setSavedRecipes] = useState<MealRecipe[]>([]);
  const [batches, setBatches] = useState<MealPrepBatch[]>([]);
  const [loggedWorkouts, setLoggedWorkouts] = useState<Record<string, LoggedRecord>>({});
  const [w, setW] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: prof }, { data: planData }, { data: meals }, { data: wts }, { data: recs }, { data: batchData }, { data: workoutLogRows }, { data: workoutSessionRows }] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", user.id).single(),
      supabase.from("plans").select("*").eq("user_id", user.id).eq("status", "current").single(),
      supabase.from("meal_logs").select("*").eq("user_id", user.id).eq("date", todayStr()),
      supabase.from("weight_logs").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(30),
      supabase.from("meal_recipes").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("meal_prep_batches").select("*").eq("user_id", user.id).eq("archived", false).order("created_at", { ascending: false }),
      supabase.from("workout_logs").select("id, exercise_name, notes, workout_sets(*)").eq("user_id", user.id).eq("date", todayStr()),
      supabase.from("workout_sessions").select("id, planned_exercise_name, name, duration_min, avg_hr, avg_speed_mph, avg_incline_pct, notes").eq("user_id", user.id).eq("date", todayStr()).eq("source", "manual"),
    ]);

    if (prof) {
      setProfile(prof as Profile);
    } else {
      // New user — no profile yet, send to Goals to set up
      router.replace("/goals?onboarding=1");
      return;
    }
    if (planData) setPlan(planData as unknown as Plan);
    if (meals) setTodayMeals(meals as MealLog[]);
    if (wts) setWeights(wts as WeightLog[]);
    if (recs) setSavedRecipes(recs as MealRecipe[]);
    if (batchData) setBatches(batchData as MealPrepBatch[]);

    // Build the map of today's already-logged exercises so WorkoutChecklist
    // can show the summary + allow edits instead of pretending nothing was logged.
    const logged: Record<string, LoggedRecord> = {};
    type WorkoutLogRow = { id: string; exercise_name: string; notes: string | null; workout_sets: Array<{ set_index: number; reps: number; weight: number; weight_basis: "total" | "per_side"; rpe: number | null }> };
    type WorkoutSessionRow = { id: string; planned_exercise_name: string | null; name: string | null; duration_min: number | null; avg_hr: number | null; avg_speed_mph: number | null; avg_incline_pct: number | null; notes: string | null };
    for (const row of (workoutLogRows ?? []) as WorkoutLogRow[]) {
      const sets: SetEntry[] = (row.workout_sets ?? [])
        .sort((a, b) => a.set_index - b.set_index)
        .map((s) => ({
          set_index: s.set_index,
          reps: s.reps,
          weight: s.weight,
          weight_basis: s.weight_basis,
          rpe: s.rpe,
        }));
      const topRpe = sets.reduce<number | null>((m, s) => (s.rpe == null ? m : Math.max(m ?? 0, s.rpe)), null);
      logged[row.exercise_name] = {
        kind: "strength",
        id: row.id,
        sets,
        notes: row.notes,
        summary: `${sets.length} sets · top RPE ${topRpe ?? "—"}`,
      };
    }
    for (const row of (workoutSessionRows ?? []) as WorkoutSessionRow[]) {
      const key = row.planned_exercise_name ?? row.name;
      if (!key) continue;
      const bits = [
        row.duration_min != null ? `${row.duration_min} min` : null,
        row.avg_hr != null ? `HR ${row.avg_hr}` : null,
        row.avg_speed_mph != null ? `${row.avg_speed_mph} mph` : null,
        row.avg_incline_pct != null ? `${row.avg_incline_pct}% incl` : null,
      ].filter(Boolean);
      logged[key] = {
        kind: "cardio",
        id: row.id,
        cardio: {
          duration_min: row.duration_min,
          avg_hr: row.avg_hr,
          avg_speed_mph: row.avg_speed_mph,
          avg_incline_pct: row.avg_incline_pct,
        },
        notes: row.notes,
        summary: bits.length > 0 ? bits.join(" · ") : "logged",
      };
    }
    setLoggedWorkouts(logged);

    // Update header subtitle and ring
    if (prof && planData) {
      const sub = document.getElementById("header-subtitle");
      const ring = document.getElementById("progress-pct");
      const daysSince = Math.max(0, daysBetween(prof.start_date, todayStr()));
      if (sub) sub.textContent = `ADAPTS EVERY ${CYCLE_DAYS} DAYS · ${daysSince}d in`;
      if (ring && prof.start_weight && prof.goal_weight && prof.current_weight) {
        const pct = Math.min(100, Math.max(0,
          ((prof.start_weight - prof.current_weight) / (prof.start_weight - prof.goal_weight)) * 100
        )) || 0;
        ring.textContent = `${Math.round(pct)}%`;
      }
    }
  }

  async function logWeight() {
    const val = parseFloat(w);
    if (!val) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("weight_logs").insert({ user_id: user.id, date: todayStr(), value: val });
    await supabase.from("profiles").update({ current_weight: val }).eq("user_id", user.id);
    setW("");
    loadData();
  }

  async function logMeal(entry: Omit<MealLog, "id" | "user_id" | "created_at">) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("meal_logs").insert({ user_id: user.id, ...entry });
    loadData();
  }

  async function logBatch(batchId: string, portionPct: number, slot: MealSlot) {
    const { error } = await supabase.rpc("log_meal_from_batch", {
      p_batch_id: batchId,
      p_date: todayStr(),
      p_slot: slot,
      p_portion_pct: portionPct,
    });
    if (error) { setGenError(error.message); return; }
    loadData();
  }

  async function archiveBatch(batchId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("meal_prep_batches")
      .update({ archived: true, updated_at: new Date().toISOString() })
      .eq("id", batchId)
      .eq("user_id", user.id);
    loadData();
  }

  async function updateMeal(id: string, patch: { date: string; slot?: string; name: string; calories: number; protein: number; carbs: number; fat: number }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("meal_logs")
      .update({
        date: patch.date,
        slot: patch.slot || null,
        name: patch.name,
        calories: patch.calories,
        protein: patch.protein,
        carbs: patch.carbs,
        fat: patch.fat,
      })
      .eq("id", id)
      .eq("user_id", user.id);
    loadData();
  }

  async function deleteMeal(id: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // Find the log row first to know if we need to adjust a batch's consumed_pct.
    const { data: log } = await supabase
      .from("meal_logs")
      .select("batch_id, portion_pct")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();
    await supabase.from("meal_logs").delete().eq("id", id).eq("user_id", user.id);
    if (log?.batch_id && log.portion_pct) {
      const { data: b } = await supabase
        .from("meal_prep_batches")
        .select("consumed_pct, archived")
        .eq("id", log.batch_id)
        .eq("user_id", user.id)
        .single();
      if (b) {
        const newPct = Math.max(0, (b.consumed_pct ?? 0) - log.portion_pct);
        await supabase
          .from("meal_prep_batches")
          .update({ consumed_pct: newPct, archived: newPct >= 99.5 ? b.archived : false, updated_at: new Date().toISOString() })
          .eq("id", log.batch_id);
      }
    }
    loadData();
  }

  async function logWorkout(entry: WorkoutLogPayload): Promise<{ id: string } | void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    if (entry.kind === "cardio") {
      // Edits replace the existing session (delete then re-insert) so the
      // brain sees the latest single source of truth.
      if (entry.existingId) {
        await supabase
          .from("workout_sessions")
          .delete()
          .eq("id", entry.existingId)
          .eq("user_id", user.id);
      }
      // Cardio actuals go to workout_sessions so the brain's existing
      // recentWorkoutSessions pipeline picks them up.
      const { data: session, error: sessionErr } = await supabase
        .from("workout_sessions")
        .insert({
          user_id: user.id,
          date: entry.date,
          type: "cardio",
          name: entry.exercise_name,
          duration_min: entry.cardio?.duration_min ?? null,
          avg_hr: entry.cardio?.avg_hr ?? null,
          avg_speed_mph: entry.cardio?.avg_speed_mph ?? null,
          avg_incline_pct: entry.cardio?.avg_incline_pct ?? null,
          planned_exercise_name: entry.custom ? null : entry.exercise_name,
          source: "manual",
          notes: entry.notes ?? null,
          position_in_session: entry.position_in_session,
          library_slug: entry.library_slug,
        })
        .select("id")
        .single();
      if (sessionErr) {
        console.error("workout_sessions insert failed", sessionErr);
        alert(`Couldn't save: ${sessionErr.message}`);
        return;
      }
      return session ? { id: session.id as string } : undefined;
    }

    if (entry.existingId) {
      // Cascade deletes the child workout_sets rows.
      await supabase
        .from("workout_logs")
        .delete()
        .eq("id", entry.existingId)
        .eq("user_id", user.id);
    }

    const sets = entry.sets ?? [];
    // Summary row: max weight, total set count, modal reps. Kept for legacy
    // read paths; truth lives in workout_sets.
    const maxWeight = sets.reduce((m, s) => Math.max(m, s.weight), 0);
    const repsCounts = sets.reduce<Record<number, number>>((acc, s) => {
      acc[s.reps] = (acc[s.reps] ?? 0) + 1;
      return acc;
    }, {});
    const modalReps = Object.entries(repsCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "0";

    const { data: parent, error: parentErr } = await supabase
      .from("workout_logs")
      .insert({
        user_id: user.id,
        date: entry.date,
        exercise_name: entry.exercise_name,
        sets: sets.length,
        reps: parseInt(modalReps, 10) || 0,
        weight: maxWeight,
        custom: entry.custom,
        position_in_session: entry.position_in_session,
        notes: entry.notes ?? null,
        library_slug: entry.library_slug,
      })
      .select("id")
      .single();

    if (parentErr || !parent) {
      console.error("workout_logs insert failed", parentErr);
      return;
    }

    if (sets.length > 0) {
      await supabase.from("workout_sets").insert(
        sets.map((s) => ({
          user_id: user.id,
          workout_log_id: parent.id,
          set_index: s.set_index,
          reps: s.reps,
          weight: s.weight,
          weight_basis: s.weight_basis,
          rpe: s.rpe,
        })),
      );
    }
    return { id: parent.id as string };
  }

  async function deleteWorkout(rec: { kind: "strength" | "cardio"; id: string; name: string }) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const table = rec.kind === "strength" ? "workout_logs" : "workout_sessions";
    await supabase.from(table).delete().eq("id", rec.id).eq("user_id", user.id);
  }

  async function reorderToday(orderedNames: string[]) {
    if (!plan) return;
    const di = daysBetween(plan.generated_at.slice(0, 10), todayStr());
    if (di < 0 || di >= plan.days.length) return;
    const res = await fetch("/api/plan/reorder", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dayIndex: di, exerciseOrder: orderedNames }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      console.error("reorder failed", j);
    } else {
      // Refresh plan so future reloads see the new order
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: planData } = await supabase
          .from("plans")
          .select("*")
          .eq("user_id", user.id)
          .eq("status", "current")
          .single();
        if (planData) setPlan(planData as unknown as Plan);
      }
    }
  }

  async function generateFirstPlan() {
    if (generating) return; // F2 guard: ignore double-taps
    setGenerating(true);
    setGenError("");
    try {
      const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "current" }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to generate plan");
      loadData();
    } catch (e: unknown) {
      setGenError(e instanceof Error ? e.message : "Error generating plan");
    } finally {
      setGenerating(false);
    }
  }

  async function startNextCycle() {
    if (generating) return; // F2 guard: don't fire twice from double-tap
    setGenerating(true);
    setGenError("");
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Promote queued → current if one exists. Archive current ONLY after
      // the replacement is in place, so a failure mid-flight doesn't leave
      // the user with no current plan (F4).
      const { data: queued } = await supabase.from("plans").select("*").eq("user_id", user.id).eq("status", "queued").maybeSingle();
      if (queued) {
        if (plan) {
          await supabase.from("plans").update({ status: "archived" }).eq("id", plan.id);
        }
        await supabase.from("plans").update({ status: "current", generated_at: new Date().toISOString() }).eq("id", queued.id);
      } else {
        // Generate fresh. /api/plan archives the previous current itself
        // (server-side, after the Anthropic call succeeds). Don't archive here.
        const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "current" }) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed");
      }
      loadData();
    } catch (e: unknown) {
      setGenError(e instanceof Error ? e.message : "Error");
    } finally {
      setGenerating(false);
    }
  }

  const today = todayStr();
  let dayIndex: number | null = null;
  let daysLeft: number | null = null;
  let cycleStale = false;
  if (plan) {
    dayIndex = daysBetween(plan.generated_at.slice(0, 10), today);
    daysLeft = CYCLE_DAYS - dayIndex;
    cycleStale = dayIndex >= CYCLE_DAYS;
  }

  const todayDay = plan && !cycleStale && dayIndex !== null && dayIndex >= 0 && dayIndex < plan.days.length
    ? plan.days[dayIndex]
    : null;

  const calIn = todayMeals.reduce((s, m) => s + (m.calories || 0), 0);
  const protIn = todayMeals.reduce((s, m) => s + (m.protein || 0), 0);
  const carbIn = todayMeals.reduce((s, m) => s + (m.carbs || 0), 0);
  const fatIn = todayMeals.reduce((s, m) => s + (m.fat || 0), 0);

  const toGo = profile ? (profile.current_weight - profile.goal_weight).toFixed(1) : "—";

  return (
    <div style={{ paddingTop: 16 }}>
      <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
        <Stat icon={Scale} label="Current" value={profile?.current_weight ?? "—"} unit="lb" />
        <Stat icon={Target} label="To go" value={parseFloat(toGo) > 0 ? toGo : "0"} unit="lb" accent />
        <Stat
          icon={CalendarClock}
          label="Next adjust"
          value={plan ? (daysLeft! > 0 ? daysLeft! : "now") : "—"}
          unit={plan && daysLeft! > 0 ? "days" : ""}
        />
      </div>

      <Card>
        <Label icon={Scale}>Quick weigh-in</Label>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input
            value={w}
            onChange={(e) => setW(e.target.value)}
            placeholder={`${profile?.current_weight ?? "lb"}`}
            inputMode="decimal"
            style={inputStyle}
          />
          <button onClick={logWeight} style={primaryBtnStyle}>Log</button>
        </div>
      </Card>

      {plan && (
        <Card>
          <Label icon={Flame}>Today&apos;s intake</Label>
          <div style={{ marginTop: 12 }}>
            <MacroBar label="Calories" value={calIn} target={plan.calorie_target} />
            <MacroBar label="Protein" value={protIn} target={plan.macros.protein} unit="g" reverse />
            <MacroBar label="Carbs" value={carbIn} target={plan.macros.carbs} unit="g" />
            <MacroBar label="Fat" value={fatIn} target={plan.macros.fat} unit="g" />
          </div>
        </Card>
      )}

      {genError && <div style={{ color: "#ff8a6a", fontSize: 13, padding: "0 2px 12px" }}>{genError}</div>}

      {!plan && (
        <Card>
          <div style={{ fontFamily: "var(--font-body)", color: "var(--muted)", fontSize: 14, marginBottom: 12 }}>
            No plan yet. Set your goals, then build your first {CYCLE_DAYS}-day cycle.
          </div>
          <button onClick={generateFirstPlan} disabled={generating} style={primaryBtnStyle}>
            <Sparkles size={16} />
            {generating ? "Building your plan…" : "Build first plan"}
          </button>
          {generating && (
            <div style={{ fontFamily: "var(--font-body)", color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
              Cadence is thinking through your goals — this usually takes about a minute. Keep this tab open.
            </div>
          )}
        </Card>
      )}

      {cycleStale && (
        <Card accent>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, marginBottom: 6 }}>
            Cycle complete
          </div>
          <div style={{ fontFamily: "var(--font-body)", color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>
            {CYCLE_DAYS} days are up — start your next cycle.
          </div>
          <button onClick={startNextCycle} disabled={generating} style={primaryBtnStyle}>
            <CalendarPlus size={16} />
            {generating ? "Building your next cycle…" : `Build & start next cycle`}
          </button>
          {generating && (
            <div style={{ fontFamily: "var(--font-body)", color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
              Cadence is rebuilding your plan — this usually takes about a minute. Keep this tab open.
            </div>
          )}
        </Card>
      )}

      {plan && (
        <>
          <Card>
            <Label icon={UtensilsCrossed}>Meals</Label>
            <FlexMealLogger
              batches={batches}
              savedRecipes={savedRecipes}
              loggedMeals={todayMeals}
              calorieTarget={plan.calorie_target}
              onLogBatch={logBatch}
              onLogMeal={logMeal}
              onDeleteMeal={deleteMeal}
              onUpdateMeal={updateMeal}
              onArchiveBatch={archiveBatch}
              date={today}
            />
          </Card>
          {todayDay && (
            <Card>
              <Label icon={Dumbbell}>{todayDay.workout?.name}</Label>
              {todayDay.workout?.exercises?.length ? (
                <WorkoutChecklist exercises={todayDay.workout.exercises} initialLogged={loggedWorkouts} onLog={logWorkout} onDelete={deleteWorkout} onReorder={reorderToday} date={today} />
              ) : (
                <div style={{ fontFamily: "var(--font-body)", color: "var(--muted)", fontSize: 13, marginTop: 8 }}>Rest day.</div>
              )}
            </Card>
          )}
          <a href="/log" style={{ ...ghostBtnStyle, width: "100%", justifyContent: "center", marginTop: 4, display: "flex", textDecoration: "none" }}>
            Log something for another day →
          </a>
        </>
      )}
    </div>
  );
}
