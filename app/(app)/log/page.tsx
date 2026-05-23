"use client";

import { useEffect, useState } from "react";
import {
  CalendarClock, Scale, Dumbbell, Heart, UtensilsCrossed, Activity, X, Camera,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { MiniInput } from "@/components/ui/MiniInput";
import { Field } from "@/components/ui/Field";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { primaryBtnStyle, inputStyle, delBtnStyle } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";
import type { MealLog, WorkoutLog } from "@/lib/types";

const todayStr = () => new Date().toISOString().slice(0, 10);

const KNOWN_EXERCISES = [
  "Bench Press", "Overhead Press", "Incline DB Press", "Triceps Pushdown", "Lateral Raise", "Push-ups",
  "Back Squat", "Romanian Deadlift", "Leg Press", "Walking Lunges", "Leg Curl", "Calf Raise",
  "Barbell Row", "Lat Pulldown", "Seated Cable Row", "Face Pull", "Biceps Curl", "Pull-ups",
  "Treadmill Intervals", "Plank", "Hanging Knee Raise", "Cable Crunch", "Russian Twist",
];

interface RecentEntry {
  id: string;
  date: string;
  kind: "meal" | "workout" | "weight" | "vitals";
  label: string;
  sublabel?: string;
}

export default function LogPage() {
  const supabase = createClient();
  const [date, setDate] = useState(todayStr());
  const [w, setW] = useState("");
  const [fName, setFName] = useState("");
  const [fCal, setFCal] = useState("");
  const [fProtein, setFProtein] = useState("");
  const [fCarbs, setFCarbs] = useState("");
  const [fFat, setFFat] = useState("");
  const [exName, setExName] = useState(KNOWN_EXERCISES[0]);
  const [exCustom, setExCustom] = useState("");
  const [exSets, setExSets] = useState("");
  const [exReps, setExReps] = useState("");
  const [exWeight, setExWeight] = useState("");
  const [restHr, setRestHr] = useState("");
  const [avgHr, setAvgHr] = useState("");
  const [activeEnergy, setActiveEnergy] = useState("");
  const [steps, setSteps] = useState("");
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [showBarcode, setShowBarcode] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) { setUserId(data.user.id); loadRecent(data.user.id); }
    });
  }, []);

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

  async function saveWeight() {
    const val = parseFloat(w); if (!val || !userId) return;
    await supabase.from("weight_logs").insert({ user_id: userId, date, value: val });
    if (date === todayStr()) await supabase.from("profiles").update({ current_weight: val }).eq("user_id", userId);
    setW(""); loadRecent(userId);
  }

  async function saveFood() {
    if (!fName || !userId) return;
    await supabase.from("meal_logs").insert({
      user_id: userId, date, name: fName,
      calories: parseInt(fCal) || 0,
      protein: parseFloat(fProtein) || 0,
      carbs: parseFloat(fCarbs) || 0,
      fat: parseFloat(fFat) || 0,
      planned: false,
    });
    setFName(""); setFCal(""); setFProtein(""); setFCarbs(""); setFFat("");
    loadRecent(userId);
  }

  async function saveFoodFromBarcode(item: { name: string; calories: number; protein: number; carbs: number; fat: number }) {
    if (!userId) return;
    await supabase.from("meal_logs").insert({ user_id: userId, date, ...item, planned: false });
    setShowBarcode(false);
    loadRecent(userId);
  }

  async function saveWorkout() {
    if (!userId) return;
    const name = exName.startsWith("Custom") ? (exCustom || "Other") : exName;
    await supabase.from("workout_logs").insert({
      user_id: userId, date,
      exercise_name: name,
      sets: parseInt(exSets) || 0,
      reps: parseInt(exReps) || 0,
      weight: parseFloat(exWeight) || 0,
      custom: exName.startsWith("Custom"),
    });
    setExSets(""); setExReps(""); setExWeight("");
    loadRecent(userId);
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
    loadRecent(userId);
  }

  return (
    <div style={{ paddingTop: 16 }}>
      <Card accent>
        <Label icon={CalendarClock}>Logging for</Label>
        <input
          value={date}
          onChange={(e) => setDate(e.target.value)}
          type="date"
          style={{ ...inputStyle, marginTop: 8 }}
        />
        <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
          Set a past date to log or fix earlier days.
        </div>
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
        <Field label="Exercise">
          <select value={exName} onChange={(e) => setExName(e.target.value)} style={inputStyle}>
            {KNOWN_EXERCISES.map((n) => <option key={n}>{n}</option>)}
            <option>Custom / other</option>
          </select>
        </Field>
        {exName.startsWith("Custom") && (
          <input value={exCustom} onChange={(e) => setExCustom(e.target.value)} placeholder="Name it" style={{ ...inputStyle, marginTop: 8 }} />
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <MiniInput label="sets" def="" val={exSets} onChange={setExSets} />
          <MiniInput label="reps" def="" val={exReps} onChange={setExReps} />
          <MiniInput label="lb" def="" val={exWeight} onChange={setExWeight} />
          <button onClick={saveWorkout} style={primaryBtnStyle}>Log</button>
        </div>
      </Card>

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
        <Label icon={UtensilsCrossed}>Food</Label>
        <button
          onClick={() => setShowBarcode(true)}
          style={{ ...primaryBtnStyle, marginTop: 8, marginBottom: 12 }}
        >
          <Camera size={15} /> Scan barcode
        </button>

        {showBarcode && (
          <BarcodeScanner
            onResult={saveFoodFromBarcode}
            onClose={() => setShowBarcode(false)}
          />
        )}

        <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", marginBottom: 8 }}>
          Or enter manually:
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
          <input value={fName} onChange={(e) => setFName(e.target.value)} placeholder="Food name" style={inputStyle} />
          <input value={fCal} onChange={(e) => setFCal(e.target.value)} placeholder="kcal" inputMode="numeric" style={{ ...inputStyle, maxWidth: 70 }} />
        </div>
        <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <MiniInput label="protein g" def="" val={fProtein} onChange={setFProtein} />
          <MiniInput label="carbs g" def="" val={fCarbs} onChange={setFCarbs} />
          <MiniInput label="fat g" def="" val={fFat} onChange={setFFat} />
        </div>
        <button onClick={saveFood} style={primaryBtnStyle}>Log food</button>
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
