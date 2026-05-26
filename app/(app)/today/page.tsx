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
import { WorkoutChecklist } from "@/components/workout/WorkoutChecklist";
import { primaryBtnStyle, ghostBtnStyle, inputStyle } from "@/components/ui/styles";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { CYCLE_DAYS } from "@/lib/config";
import { localDateStr } from "@/lib/date";
import type { Plan, Profile, MealLog, WorkoutLog, WeightLog, MealRecipe, MealPrepBatch, MealSlot } from "@/lib/types";

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
  const [w, setW] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: prof }, { data: planData }, { data: meals }, { data: wts }, { data: recs }, { data: batchData }] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", user.id).single(),
      supabase.from("plans").select("*").eq("user_id", user.id).eq("status", "current").single(),
      supabase.from("meal_logs").select("*").eq("user_id", user.id).eq("date", todayStr()),
      supabase.from("weight_logs").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(30),
      supabase.from("meal_recipes").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("meal_prep_batches").select("*").eq("user_id", user.id).eq("archived", false).order("created_at", { ascending: false }),
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

    // Update header subtitle and ring
    if (prof && planData) {
      const sub = document.getElementById("header-subtitle");
      const ring = document.getElementById("progress-pct");
      const cyclesCompleted = 0; // simplified; full count in plan tab
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

  async function logWorkout(entry: Omit<WorkoutLog, "id" | "user_id" | "created_at">) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("workout_logs").insert({ user_id: user.id, ...entry });
  }

  async function generateFirstPlan() {
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
    setGenerating(true);
    setGenError("");
    try {
      // Archive current plan
      if (plan) {
        await supabase.from("plans").update({ status: "archived" }).eq("id", plan.id);
      }
      // Check if queued plan exists
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: queued } = await supabase.from("plans").select("*").eq("user_id", user.id).eq("status", "queued").single();
      if (queued) {
        await supabase.from("plans").update({ status: "current", generated_at: new Date().toISOString() }).eq("id", queued.id);
      } else {
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
            {generating ? "Building…" : "Build first plan"}
          </button>
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
            {generating ? "Building…" : `Build & start next cycle`}
          </button>
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
                <WorkoutChecklist exercises={todayDay.workout.exercises} onLog={logWorkout} date={today} />
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
