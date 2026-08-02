"use client";

// Energy balance (TDEE) card — shared by Today and Log.
//
// Shows estimated burn for the date broken into BMR / NEAT / TEF / exercise,
// a stacked bar with an intake marker, and the deficit/surplus vs. logged
// meals. BMR needs sex/birth-year/height (one-time inline setup saved to the
// profile); the non-exercise day selector defaults to Sedentary (conservative)
// and persists per-day on the vitals row.

import { useEffect, useMemo, useState } from "react";
import { Flame, ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { primaryBtnStyle, inputStyle } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";
import {
  ACTIVITY_LEVELS, bmrMifflinStJeor, buildEnergyBreakdown, exerciseKcal, hasBmrInputs,
  type AppleWorkoutLite, type CardioSessionLite, type ExerciseItem, type StrengthLogLite,
} from "@/lib/tdee";
import type { ActivityLevel, MealLog, Profile } from "@/lib/types";

const SEGMENTS: Array<{ key: "bmr" | "neat" | "tef" | "exercise"; label: string; color: string; sub: string }> = [
  { key: "bmr", label: "BMR", color: "hsl(210, 55%, 55%)", sub: "Resting metabolism" },
  { key: "neat", label: "NEAT", color: "hsl(170, 45%, 45%)", sub: "Non-exercise movement" },
  { key: "tef", label: "TEF", color: "hsl(45, 65%, 55%)", sub: "Digesting food" },
  { key: "exercise", label: "Exercise", color: "var(--accent)", sub: "Logged workouts" },
];

interface Props {
  date: string;
  profile: Profile | null;
  meals: MealLog[];
  // Bump to refetch workout/vitals rows after logging elsewhere on the page.
  refreshKey?: number;
  // Called after the setup form saves new profile fields.
  onProfileSaved?: () => void;
}

export function EnergyBalance({ date, profile, meals, refreshKey, onProfileSaved }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [strengthLogs, setStrengthLogs] = useState<StrengthLogLite[]>([]);
  const [cardioSessions, setCardioSessions] = useState<CardioSessionLite[]>([]);
  const [appleWorkouts, setAppleWorkouts] = useState<AppleWorkoutLite[]>([]);
  const [dayLevel, setDayLevel] = useState<ActivityLevel | null>(null); // vitals override
  const [loaded, setLoaded] = useState(false);
  const [showDetail, setShowDetail] = useState(false);

  // Setup form drafts
  const [sexDraft, setSexDraft] = useState<"male" | "female" | "">("");
  const [birthYearDraft, setBirthYearDraft] = useState("");
  const [heightFtDraft, setHeightFtDraft] = useState("");
  const [heightInDraft, setHeightInDraft] = useState("");
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      const [{ data: logs }, { data: sessions }, { data: apple }, { data: vitals }] = await Promise.all([
        // workout_sets drives the per-movement calorie estimate (load, reps,
        // RPE) — without it every lift collapses to the same set-count guess.
        supabase.from("workout_logs").select("id, exercise_name, sets, notes, apple_workout_id, workout_sets(reps, weight, weight_basis, rpe)").eq("user_id", user.id).eq("date", date),
        supabase.from("workout_sessions").select("id, name, planned_exercise_name, type, duration_min, avg_speed_mph, calories, notes, apple_workout_id").eq("user_id", user.id).eq("date", date),
        supabase.from("apple_workouts").select("id, name, type, duration_min, calories").eq("user_id", user.id).eq("date", date),
        supabase.from("vitals").select("activity_level").eq("user_id", user.id).eq("date", date).maybeSingle(),
      ]);
      if (cancelled) return;
      type LogRow = Omit<StrengthLogLite, "sets_detail"> & {
        workout_sets?: StrengthLogLite["sets_detail"];
      };
      setStrengthLogs(((logs ?? []) as LogRow[]).map((l) => ({
        ...l,
        sets_detail: l.workout_sets ?? [],
      })));
      setCardioSessions((sessions ?? []) as CardioSessionLite[]);
      setAppleWorkouts((apple ?? []) as AppleWorkoutLite[]);
      setDayLevel((vitals?.activity_level as ActivityLevel | null) ?? null);
      setLoaded(true);
    }
    load();
    return () => { cancelled = true; };
  }, [supabase, date, refreshKey]);

  const activityLevel: ActivityLevel = dayLevel ?? profile?.activity_level ?? "sedentary";

  async function selectLevel(level: ActivityLevel) {
    setDayLevel(level); // optimistic
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // No `source` in the payload: inserts fall back to the column default
    // ('manual') and upserts onto an existing healthkit row don't clobber it.
    const { error } = await supabase.from("vitals").upsert(
      { user_id: user.id, date, activity_level: level },
      { onConflict: "user_id,date" },
    );
    if (error) alert(`Couldn't save activity level: ${error.message}`);
    // First time picking a level also becomes the profile default so future
    // days start from the user's normal, not from scratch.
    if (!profile?.activity_level) {
      await supabase.from("profiles").update({ activity_level: level }).eq("user_id", user.id);
      onProfileSaved?.();
    }
  }

  async function saveSetup() {
    const by = parseInt(birthYearDraft, 10);
    const ft = parseInt(heightFtDraft, 10);
    const inches = heightInDraft === "" ? 0 : parseFloat(heightInDraft);
    if (!sexDraft) { setSaveError("Pick a sex — it sets the BMR constant."); return; }
    if (!by || by < 1900 || by > 2100) { setSaveError("Enter a 4-digit birth year."); return; }
    if (!ft || ft < 3 || ft > 8 || isNaN(inches) || inches < 0 || inches >= 12) { setSaveError("Enter height as feet + inches."); return; }
    setSaving(true);
    setSaveError("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const { error } = await supabase
      .from("profiles")
      .update({ sex: sexDraft, birth_year: by, height_in: ft * 12 + inches })
      .eq("user_id", user.id);
    setSaving(false);
    if (error) { setSaveError(error.message); return; }
    onProfileSaved?.();
  }

  const intake = {
    calories: meals.reduce((s, m) => s + (m.calories || 0), 0),
    protein: meals.reduce((s, m) => s + (m.protein || 0), 0),
    carbs: meals.reduce((s, m) => s + (m.carbs || 0), 0),
    fat: meals.reduce((s, m) => s + (m.fat || 0), 0),
  };

  const weightLb = profile?.current_weight ?? null;
  const bmr = bmrMifflinStJeor(
    { sex: profile?.sex, birthYear: profile?.birth_year, heightIn: profile?.height_in, weightLb },
    date,
  );
  const exercise = exerciseKcal(strengthLogs, cardioSessions, appleWorkouts, weightLb);

  // ── Setup form when BMR inputs are missing ──────────────────────────────────
  if (profile && !hasBmrInputs(profile)) {
    return (
      <Card>
        <Label icon={Flame}>Energy balance</Label>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", marginTop: 8 }}>
          To estimate your daily burn (TDEE), Cadence needs three one-time inputs. Weight comes from your weigh-ins.
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          {(["male", "female"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSexDraft(s)}
              style={{
                ...inputStyle,
                flex: 1,
                cursor: "pointer",
                textAlign: "center",
                borderColor: sexDraft === s ? "var(--accent)" : "#232327",
                color: sexDraft === s ? "var(--ink)" : "var(--muted)",
              }}
            >
              {s === "male" ? "Male" : "Female"}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input value={birthYearDraft} onChange={(e) => setBirthYearDraft(e.target.value)} placeholder="Birth year" inputMode="numeric" style={{ ...inputStyle, flex: 1.2 }} />
          <input value={heightFtDraft} onChange={(e) => setHeightFtDraft(e.target.value)} placeholder="ft" inputMode="numeric" style={{ ...inputStyle, flex: 1 }} />
          <input value={heightInDraft} onChange={(e) => setHeightInDraft(e.target.value)} placeholder="in" inputMode="decimal" style={{ ...inputStyle, flex: 1 }} />
        </div>
        {saveError && <div style={{ color: "#ff8a6a", fontSize: 12, marginTop: 8 }}>{saveError}</div>}
        <button onClick={saveSetup} disabled={saving} style={{ ...primaryBtnStyle, marginTop: 10 }}>
          {saving ? "Saving…" : "Start estimating"}
        </button>
      </Card>
    );
  }

  if (!profile || bmr == null || !loaded) return null;

  const breakdown = buildEnergyBreakdown({ bmr, activityLevel, intake, exercise: exercise.totalKcal });
  const axisMax = Math.max(breakdown.tdee, breakdown.intake, 1);
  const deficit = breakdown.net < 0;
  const netLabel = `${Math.abs(breakdown.net).toLocaleString()} kcal ${deficit ? "deficit" : "surplus"}`;
  // Weight loss goal → deficit is good. (goal below current = cutting.)
  const cutting = profile.goal_weight < profile.current_weight;
  const netGood = cutting ? deficit : !deficit;
  const netColor = breakdown.intake === 0 ? "var(--muted)" : netGood ? "hsl(130, 55%, 55%)" : "hsl(20, 75%, 58%)";

  return (
    <Card>
      <Label icon={Flame}>Energy balance</Label>

      {/* Headline: burned vs eaten vs net */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 10 }}>
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 22 }}>
            {breakdown.tdee.toLocaleString()}
            <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 600 }}> kcal burned</span>
          </div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)" }}>
            {breakdown.intake.toLocaleString()} kcal eaten
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16, color: netColor }}>
            {breakdown.intake === 0 ? "no meals logged" : netLabel}
          </div>
        </div>
      </div>

      {/* Stacked bar + intake marker */}
      <div style={{ position: "relative", marginTop: 14, paddingTop: 14 }}>
        <div style={{ display: "flex", width: `${(breakdown.tdee / axisMax) * 100}%`, height: 14, borderRadius: 7, overflow: "hidden" }}>
          {SEGMENTS.map((seg) => (
            <div
              key={seg.key}
              style={{
                width: `${(breakdown[seg.key] / Math.max(breakdown.tdee, 1)) * 100}%`,
                background: seg.color,
                transition: "width 0.25s ease",
              }}
            />
          ))}
        </div>
        {breakdown.intake > 0 && (
          <div style={{ position: "absolute", top: 0, bottom: -4, left: `${(breakdown.intake / axisMax) * 100}%`, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", pointerEvents: "none" }}>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 700, color: "var(--ink)", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>EATEN</span>
            <div style={{ flex: 1, width: 2, background: "var(--ink)", borderRadius: 1 }} />
          </div>
        )}
      </div>

      {/* Category totals */}
      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 7 }}>
        {SEGMENTS.map((seg) => (
          <div key={seg.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: seg.color, flexShrink: 0 }} />
            <span style={{ fontFamily: "var(--font-body)", fontSize: 12.5, fontWeight: 700, width: 62 }}>{seg.label}</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", flex: 1 }}>{seg.sub}</span>
            <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 13 }}>
              {breakdown[seg.key].toLocaleString()}
              <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}> kcal</span>
            </span>
          </div>
        ))}
      </div>

      {/* Non-exercise day selector */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em", marginBottom: 6 }}>
          NON-EXERCISE DAY
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ACTIVITY_LEVELS.map((lvl) => {
            const active = activityLevel === lvl.value;
            return (
              <button
                key={lvl.value}
                onClick={() => selectLevel(lvl.value)}
                title={lvl.hint}
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 12,
                  fontWeight: 600,
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: `1px solid ${active ? "var(--accent)" : "#2a2a2e"}`,
                  background: active ? "rgba(255, 92, 56, 0.12)" : "transparent",
                  color: active ? "var(--ink)" : "var(--muted)",
                  cursor: "pointer",
                }}
              >
                {lvl.label}
              </button>
            );
          })}
        </div>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
          {ACTIVITY_LEVELS.find((l) => l.value === activityLevel)?.hint}. Workouts are counted separately below.
        </div>
      </div>

      {/* Exercise detail */}
      {exercise.items.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => setShowDetail((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 4, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--muted)", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 700, letterSpacing: "0.04em" }}
          >
            {showDetail ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            EXERCISE DETAIL ({exercise.items.length})
          </button>
          {showDetail && (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              {exercise.items.map((it: ExerciseItem, i: number) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 12.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.name}</span>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>
                    {it.detail} · <strong style={{ color: "var(--ink)" }}>{it.kcal.toLocaleString()}</strong> kcal
                  </span>
                </div>
              ))}
              <div style={{ fontFamily: "var(--font-body)", fontSize: 10.5, color: "var(--muted)", marginTop: 2 }}>
                Watch calories are discounted 30% (wearables overestimate); estimates use conservative METs.
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
