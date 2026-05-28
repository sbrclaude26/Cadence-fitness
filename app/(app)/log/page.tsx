"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CalendarClock, Scale, Dumbbell, Heart, UtensilsCrossed, Activity, X,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { MacroBar } from "@/components/ui/MacroBar";
import { Flame } from "lucide-react";
import { MiniInput } from "@/components/ui/MiniInput";
import { FlexMealLogger } from "@/components/meals/FlexMealLogger";
import { WorkoutChecklist, type WorkoutLogPayload, type LoggedRecord, type SetEntry } from "@/components/workout/WorkoutChecklist";
import { WatchSessionLinker } from "@/components/workout/WatchSessionLinker";
import { primaryBtnStyle, inputStyle, delBtnStyle } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";
import { localDateStr } from "@/lib/date";
import type { MealLog, WorkoutLog, Plan, MealRecipe, MealPrepBatch, MealSlot, Exercise } from "@/lib/types";

const todayStr = () => localDateStr();

interface RecentEntry {
  id: string;
  date: string;
  kind: "meal" | "workout" | "weight" | "vitals";
  label: string;
  sublabel?: string;
}

export default function LogPage() {
  const supabase = createClient();
  const searchParams = useSearchParams();
  const initialDate = searchParams.get("date") || todayStr();
  const [date, setDate] = useState(initialDate);
  const [userId, setUserId] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [batches, setBatches] = useState<MealPrepBatch[]>([]);
  const [savedRecipes, setSavedRecipes] = useState<MealRecipe[]>([]);
  const [mealsOnDate, setMealsOnDate] = useState<MealLog[]>([]);

  const [w, setW] = useState("");
  const [weightOnDate, setWeightOnDate] = useState<number | null>(null);
  const [plannedExercises, setPlannedExercises] = useState<Exercise[]>([]);
  const [planDayLabel, setPlanDayLabel] = useState<string | null>(null);
  const [loggedWorkouts, setLoggedWorkouts] = useState<Record<string, LoggedRecord>>({});
  const [restHr, setRestHr] = useState("");
  const [avgHr, setAvgHr] = useState("");
  const [activeEnergy, setActiveEnergy] = useState("");
  const [steps, setSteps] = useState("");
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [linkerRefreshKey, setLinkerRefreshKey] = useState(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) {
        setUserId(data.user.id);
        loadStatic(data.user.id);
        loadRecent(data.user.id);
      }
    });
  }, []);

  useEffect(() => {
    if (userId) {
      loadMealsForDate(userId, date);
      loadWorkoutsForDate(userId, date);
      loadWeightForDate(userId, date);
    }
  }, [userId, date]);

  async function loadStatic(uid: string) {
    const [{ data: planData }, { data: batchData }, { data: recs }] = await Promise.all([
      supabase.from("plans").select("*").eq("user_id", uid).eq("status", "current").single(),
      supabase.from("meal_prep_batches").select("*").eq("user_id", uid).eq("archived", false).order("created_at", { ascending: false }),
      supabase.from("meal_recipes").select("*").eq("user_id", uid).order("created_at", { ascending: false }),
    ]);
    if (planData) setPlan(planData as unknown as Plan);
    if (batchData) setBatches(batchData as MealPrepBatch[]);
    if (recs) setSavedRecipes(recs as MealRecipe[]);
  }

  async function loadMealsForDate(uid: string, d: string) {
    const { data } = await supabase.from("meal_logs").select("*").eq("user_id", uid).eq("date", d);
    if (data) setMealsOnDate(data as MealLog[]);
  }

  async function loadWeightForDate(uid: string, d: string) {
    const { data } = await supabase
      .from("weight_logs")
      .select("value")
      .eq("user_id", uid)
      .eq("date", d)
      .order("created_at", { ascending: false })
      .limit(1);
    setWeightOnDate(data && data.length > 0 ? (data[0].value as number) : null);
  }

  async function loadWorkoutsForDate(uid: string, d: string) {
    // Find the plan day that covers this date. Prefer current > queued >
    // archived so dates inside the live cycle never resolve to a stale plan.
    const { data: allPlans } = await supabase
      .from("plans")
      .select("*")
      .eq("user_id", uid)
      .in("status", ["current", "queued", "archived"]);
    const rank: Record<string, number> = { current: 0, queued: 1, archived: 2 };
    const sorted = [...(allPlans ?? [])].sort(
      (a, b) => (rank[a.status as string] ?? 9) - (rank[b.status as string] ?? 9),
    );
    let planned: Exercise[] = [];
    let label: string | null = null;
    const dTs = new Date(d).getTime();
    for (const p of sorted as Plan[]) {
      const startTs = new Date(p.generated_at.slice(0, 10)).getTime();
      const idx = Math.floor((dTs - startTs) / 86400000);
      if (idx >= 0 && idx < (p.days?.length ?? 0)) {
        const day = p.days[idx];
        planned = day?.workout?.exercises ?? [];
        const dayName = day?.workout?.name ?? day?.label ?? `Day ${idx + 1}`;
        label = `Day ${idx + 1} of ${p.days.length} · ${dayName}`;
        break;
      }
    }
    setPlannedExercises(planned);
    setPlanDayLabel(label);

    const [{ data: workoutLogRows }, { data: workoutSessionRows }] = await Promise.all([
      supabase.from("workout_logs").select("id, exercise_name, notes, workout_sets(*)").eq("user_id", uid).eq("date", d),
      supabase.from("workout_sessions").select("id, planned_exercise_name, name, duration_min, avg_hr, avg_speed_mph, avg_incline_pct, notes").eq("user_id", uid).eq("date", d),
    ]);

    const logged: Record<string, LoggedRecord> = {};
    type WorkoutLogRow = { id: string; exercise_name: string; notes: string | null; workout_sets: Array<{ set_index: number; reps: number; weight: number; weight_basis: "total" | "per_side"; rpe: number | null }> };
    type WorkoutSessionRow = { id: string; planned_exercise_name: string | null; name: string | null; duration_min: number | null; avg_hr: number | null; avg_speed_mph: number | null; avg_incline_pct: number | null; notes: string | null };
    for (const row of (workoutLogRows ?? []) as WorkoutLogRow[]) {
      const sets: SetEntry[] = (row.workout_sets ?? [])
        .sort((a, b) => a.set_index - b.set_index)
        .map((s) => ({ set_index: s.set_index, reps: s.reps, weight: s.weight, weight_basis: s.weight_basis, rpe: s.rpe }));
      const topRpe = sets.reduce<number | null>((m, s) => (s.rpe == null ? m : Math.max(m ?? 0, s.rpe)), null);
      const skipped = row.notes === "skipped" && sets.length === 0;
      logged[row.exercise_name] = {
        kind: "strength",
        id: row.id,
        sets,
        notes: row.notes,
        summary: skipped ? "Skipped" : `${sets.length} sets · top RPE ${topRpe ?? "—"}`,
        skipped,
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
      const skipped = row.notes === "skipped";
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
        summary: skipped ? "Skipped" : (bits.length > 0 ? bits.join(" · ") : "logged"),
        skipped,
      };
    }
    setLoggedWorkouts(logged);
  }

  async function loadRecent(uid: string) {
    const [{ data: meals }, { data: workouts }, { data: wts }] = await Promise.all([
      supabase.from("meal_logs").select("*").eq("user_id", uid).order("date", { ascending: false }).limit(5),
      supabase.from("workout_logs").select("*").eq("user_id", uid).order("date", { ascending: false }).limit(5),
      supabase.from("weight_logs").select("*").eq("user_id", uid).order("date", { ascending: false }).limit(3),
    ]);
    const entries: RecentEntry[] = [];
    (meals ?? []).forEach((m: MealLog) => entries.push({ id: m.id, date: m.date, kind: "meal", label: m.name, sublabel: `${m.calories} kcal` }));
    (workouts ?? []).forEach((x: WorkoutLog) => entries.push({ id: x.id, date: x.date, kind: "workout", label: x.exercise_name, sublabel: `${x.sets}×${x.reps}${x.weight ? ` @ ${x.weight}lb` : ""}` }));
    (wts ?? []).forEach((wt: { id: string; date: string; value: number }) => entries.push({ id: wt.id, date: wt.date, kind: "weight", label: `${wt.value} lb`, sublabel: "weight" }));
    entries.sort((a, b) => b.date.localeCompare(a.date));
    setRecent(entries.slice(0, 10));
  }

  function refreshAll() {
    if (!userId) return;
    loadStatic(userId);
    loadMealsForDate(userId, date);
    loadWorkoutsForDate(userId, date);
    loadRecent(userId);
  }

  async function saveWeight() {
    const val = parseFloat(w); if (!val || !userId) return;
    await supabase.from("weight_logs").insert({ user_id: userId, date, value: val });
    if (date === todayStr()) await supabase.from("profiles").update({ current_weight: val }).eq("user_id", userId);
    setW(""); loadRecent(userId); loadWeightForDate(userId, date);
  }

  async function logWorkout(entry: WorkoutLogPayload): Promise<{ id: string } | void> {
    if (!userId) return;

    if (entry.kind === "cardio") {
      if (entry.existingId) {
        await supabase.from("workout_sessions").delete().eq("id", entry.existingId).eq("user_id", userId);
      }
      const { data: session, error: sessionErr } = await supabase
        .from("workout_sessions")
        .insert({
          user_id: userId,
          date: entry.date,
          type: "cardio",
          name: entry.exercise_name,
          duration_min: entry.cardio?.duration_min ?? null,
          avg_hr: entry.cardio?.avg_hr ?? null,
          avg_speed_mph: entry.cardio?.avg_speed_mph ?? null,
          avg_incline_pct: entry.cardio?.avg_incline_pct ?? null,
          planned_exercise_name: entry.custom ? null : entry.exercise_name,
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
      loadRecent(userId);
      loadWorkoutsForDate(userId, date);
      return session ? { id: session.id as string } : undefined;
    }

    if (entry.existingId) {
      await supabase.from("workout_logs").delete().eq("id", entry.existingId).eq("user_id", userId);
    }

    const sets = entry.sets ?? [];
    const maxWeight = sets.reduce((m, s) => Math.max(m, s.weight), 0);
    const repsCounts = sets.reduce<Record<number, number>>((acc, s) => {
      acc[s.reps] = (acc[s.reps] ?? 0) + 1;
      return acc;
    }, {});
    const modalReps = Object.entries(repsCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "0";

    const { data: parent, error: parentErr } = await supabase
      .from("workout_logs")
      .insert({
        user_id: userId,
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
          user_id: userId,
          workout_log_id: parent.id,
          set_index: s.set_index,
          reps: s.reps,
          weight: s.weight,
          weight_basis: s.weight_basis,
          rpe: s.rpe,
        })),
      );
    }
    loadRecent(userId);
    setLinkerRefreshKey((k) => k + 1);
    return { id: parent.id as string };
  }

  async function deleteWorkout(rec: { kind: "strength" | "cardio"; id: string; name: string }) {
    if (!userId) return;
    const table = rec.kind === "strength" ? "workout_logs" : "workout_sessions";
    await supabase.from(table).delete().eq("id", rec.id).eq("user_id", userId);
    loadRecent(userId);
    setLinkerRefreshKey((k) => k + 1);
  }

  async function saveVitals() {
    if (!userId) return;
    await supabase.from("vitals").upsert({
      user_id: userId, date,
      resting_hr: parseInt(restHr) || null,
      avg_hr: parseInt(avgHr) || null,
      active_energy_kcal: parseFloat(activeEnergy) || null,
      steps: parseInt(steps) || null,
      source: "manual",
    }, { onConflict: "user_id,date" });
    setRestHr(""); setAvgHr(""); setActiveEnergy(""); setSteps("");
  }

  async function deleteEntry(kind: string, id: string) {
    const tableMap: Record<string, string> = { meal: "meal_logs", workout: "workout_logs", weight: "weight_logs" };
    const table = tableMap[kind];
    if (!table || !userId) return;
    await supabase.from(table as "meal_logs").delete().eq("id", id);
    refreshAll();
  }

  async function logMeal(entry: Omit<MealLog, "id" | "user_id" | "created_at">) {
    if (!userId) return;
    await supabase.from("meal_logs").insert({ user_id: userId, ...entry });
    refreshAll();
  }

  async function logBatch(batchId: string, portionPct: number, slot: MealSlot) {
    await supabase.rpc("log_meal_from_batch", {
      p_batch_id: batchId,
      p_date: date,
      p_slot: slot,
      p_portion_pct: portionPct,
    });
    refreshAll();
  }

  async function archiveBatch(batchId: string) {
    if (!userId) return;
    await supabase
      .from("meal_prep_batches")
      .update({ archived: true, updated_at: new Date().toISOString() })
      .eq("id", batchId)
      .eq("user_id", userId);
    refreshAll();
  }

  async function deleteMeal(id: string) {
    if (!userId) return;
    const { data: log } = await supabase
      .from("meal_logs")
      .select("batch_id, portion_pct")
      .eq("id", id)
      .eq("user_id", userId)
      .single();
    await supabase.from("meal_logs").delete().eq("id", id).eq("user_id", userId);
    if (log?.batch_id && log.portion_pct) {
      const { data: b } = await supabase
        .from("meal_prep_batches")
        .select("consumed_pct, archived")
        .eq("id", log.batch_id)
        .eq("user_id", userId)
        .single();
      if (b) {
        const newPct = Math.max(0, (b.consumed_pct ?? 0) - log.portion_pct);
        await supabase
          .from("meal_prep_batches")
          .update({ consumed_pct: newPct, archived: newPct >= 99.5 ? b.archived : false, updated_at: new Date().toISOString() })
          .eq("id", log.batch_id);
      }
    }
    refreshAll();
  }

  async function updateMeal(id: string, patch: { date: string; slot?: string; name: string; calories: number; protein: number; carbs: number; fat: number }) {
    if (!userId) return;
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
      .eq("user_id", userId);
    refreshAll();
  }

  const calIn = mealsOnDate.reduce((s, m) => s + (m.calories || 0), 0);
  const protIn = mealsOnDate.reduce((s, m) => s + (m.protein || 0), 0);
  const carbIn = mealsOnDate.reduce((s, m) => s + (m.carbs || 0), 0);
  const fatIn = mealsOnDate.reduce((s, m) => s + (m.fat || 0), 0);

  return (
    <div style={{ paddingTop: 16 }}>
      <Card accent>
        <Label icon={CalendarClock}>Logging for</Label>
        <input
          value={date}
          onChange={(e) => setDate(e.target.value)}
          type="date"
          style={{ ...inputStyle, marginTop: 8, WebkitAppearance: "none", appearance: "none", display: "block", maxWidth: "100%" }}
        />
        <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
          Pick any date — past, today, or upcoming — to log, edit, or pre-skip an exercise.
        </div>
      </Card>

      {plan && (
        <Card>
          <Label icon={Flame}>Intake for {date.slice(5)}</Label>
          <div style={{ marginTop: 12 }}>
            <MacroBar label="Calories" value={calIn} target={plan.calorie_target} />
            <MacroBar label="Protein" value={protIn} target={plan.macros.protein} unit="g" reverse />
            <MacroBar label="Carbs" value={carbIn} target={plan.macros.carbs} unit="g" />
            <MacroBar label="Fat" value={fatIn} target={plan.macros.fat} unit="g" />
          </div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", marginTop: 4, display: "flex", justifyContent: "space-between" }}>
            <span>Weight on this day</span>
            <span style={{ color: weightOnDate != null ? "var(--ink)" : "var(--muted)", fontWeight: 600 }}>
              {weightOnDate != null ? `${weightOnDate} lb` : "—"}
            </span>
          </div>
        </Card>
      )}

      <Card>
        <Label icon={UtensilsCrossed}>Food</Label>
        <FlexMealLogger
          batches={batches}
          savedRecipes={savedRecipes}
          loggedMeals={mealsOnDate}
          calorieTarget={plan?.calorie_target ?? 0}
          onLogBatch={logBatch}
          onLogMeal={logMeal}
          onDeleteMeal={deleteMeal}
          onUpdateMeal={updateMeal}
          onArchiveBatch={archiveBatch}
          date={date}
        />
      </Card>

      <Card>
        <Label icon={Scale}>Weight</Label>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input value={w} onChange={(e) => setW(e.target.value)} placeholder="lb" inputMode="decimal" style={inputStyle} />
          <button onClick={saveWeight} style={primaryBtnStyle}>Save</button>
        </div>
      </Card>

      <Card>
        <Label icon={Dumbbell}>Workout</Label>
        {planDayLabel && (
          <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", marginTop: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {planDayLabel}
          </div>
        )}
        {!planDayLabel && plannedExercises.length === 0 && Object.keys(loggedWorkouts).length === 0 && (
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
            No plan scheduled for this date. You can still log a workout below.
          </div>
        )}
        <WorkoutChecklist
          exercises={plannedExercises}
          initialLogged={loggedWorkouts}
          onLog={logWorkout}
          onDelete={deleteWorkout}
          date={date}
        />
      </Card>

      {userId && (
        <WatchSessionLinker
          userId={userId}
          date={date}
          refreshKey={linkerRefreshKey}
        />
      )}

      <Card>
        <Label icon={Heart}>Vitals</Label>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <MiniInput label="resting HR" def="" val={restHr} onChange={setRestHr} />
          <MiniInput label="avg HR" def="" val={avgHr} onChange={setAvgHr} />
          <MiniInput label="kcal burned" def="" val={activeEnergy} onChange={setActiveEnergy} />
          <MiniInput label="steps" def="" val={steps} onChange={setSteps} />
        </div>
        <button onClick={saveVitals} style={{ ...primaryBtnStyle, marginTop: 10 }}>Save vitals</button>
      </Card>

      <Card>
        <Label icon={Activity}>Recent entries</Label>
        <div style={{ marginTop: 8 }}>
          {recent.map((e) => (
            <div
              key={e.id + e.kind}
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #232327" }}
            >
              <span style={{ fontFamily: "var(--font-body)", fontSize: 13 }}>
                {e.date.slice(5)} · {e.label}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)" }}>{e.sublabel}</span>
                <button onClick={() => deleteEntry(e.kind, e.id)} style={delBtnStyle}><X size={13} /></button>
              </span>
            </div>
          ))}
          {recent.length === 0 && (
            <div style={{ fontFamily: "var(--font-body)", color: "var(--muted)", fontSize: 13 }}>Nothing logged yet.</div>
          )}
        </div>
      </Card>
    </div>
  );
}
