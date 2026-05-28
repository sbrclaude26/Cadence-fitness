"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  BarChart, Bar, CartesianGrid, Cell,
} from "recharts";
import { TrendingUp, Dumbbell, Flame, Heart, Activity, UtensilsCrossed, ChevronLeft, ChevronRight, ArrowLeft, Scale, AlertTriangle } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { EmptyMini } from "@/components/ui/Empty";
import { createClient } from "@/lib/supabase/client";
import { CYCLE_DAYS } from "@/lib/config";
import { localDateStr } from "@/lib/date";
import { useLibrary } from "@/lib/useLibrary";
import {
  expandWorkoutsToHardSets,
  synthesizeHardSetsFromLogs,
  expandPlanToHardSets,
  buildLoggedKeysByDate,
  filterToWindow,
  hardSetsByMuscle,
  hardSetsByForce,
  hardSetsByRegion,
  untaggedExerciseNames,
  weeklyTrendByMuscle,
  detectImbalances,
  detectStaleMuscles,
  muscleLabel,
  type StressWindow,
  type ForceBreakdown,
  type RegionBreakdown,
} from "@/lib/analytics/workoutStress";
import type { WeightLog, WorkoutLog, WorkoutSet, Vitals, Profile, AppleWorkout, MealLog, MealSlot, Plan } from "@/lib/types";

const tooltipStyle = { background: "#18181b", border: "1px solid #2a2a2e", borderRadius: 8, color: "#f4f1ea" };

const SLOTS_ORDER: MealSlot[] = ["Breakfast", "Lunch", "Dinner", "Snack"];

function DayDetailModal({
  date, meals, target, onClose, onEdit,
}: {
  date: string;
  meals: MealLog[];
  target: Plan | null;
  onClose: () => void;
  onEdit: () => void;
}) {
  const tot = meals.reduce(
    (s, m) => ({ cal: s.cal + (m.calories || 0), protein: s.protein + (m.protein || 0), carbs: s.carbs + (m.carbs || 0), fat: s.fat + (m.fat || 0) }),
    { cal: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const grouped: { slot: string; items: MealLog[] }[] = SLOTS_ORDER
    .map((s) => ({ slot: s, items: meals.filter((m) => m.slot === s) }))
    .filter((g) => g.items.length > 0);
  const unslotted = meals.filter((m) => !m.slot);
  if (unslotted.length) grouped.push({ slot: "Other", items: unslotted });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 100,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--card)", border: "1px solid #2a2a2e", borderTopLeftRadius: 18, borderTopRightRadius: 18,
          width: "100%", maxWidth: 460, maxHeight: "80vh", overflow: "auto",
          paddingTop: 18, paddingLeft: 18, paddingRight: 18,
          paddingBottom: "calc(18px + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18 }}>
            {new Date(date + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
          </div>
          <button onClick={onClose} aria-label="Close" style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: 4 }}>✕</button>
        </div>

        <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--muted)", marginBottom: 14 }}>
          {Math.round(tot.cal)} kcal · P{Math.round(tot.protein)} · C{Math.round(tot.carbs)} · F{Math.round(tot.fat)}
          {target && (
            <span style={{ color: "#5a5a60" }}>
              {"  ·  goal "}
              {target.calorie_target} kcal · P{target.macros.protein} C{target.macros.carbs} F{target.macros.fat}
            </span>
          )}
        </div>

        {grouped.length === 0 ? (
          <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", padding: "20px 0", textAlign: "center" }}>
            No meals logged this day.
          </div>
        ) : (
          grouped.map((g) => (
            <div key={g.slot} style={{ marginBottom: 14 }}>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.07em", textTransform: "uppercase", marginBottom: 6 }}>
                {g.slot}
              </div>
              {g.items.map((m) => (
                <div key={m.id} style={{ padding: "8px 0", borderBottom: "1px solid #232327" }}>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 13.5, fontWeight: 600 }}>{m.name}</div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                    {Math.round(m.calories)} kcal · P{Math.round(m.protein)} C{Math.round(m.carbs)} F{Math.round(m.fat)}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}

        <button
          onClick={onEdit}
          style={{
            width: "100%", marginTop: 8, padding: "12px 0", borderRadius: 12, border: "none", cursor: "pointer",
            background: "var(--accent)", color: "#140a06",
            fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 14,
          }}
        >
          Edit, add, or remove meals →
        </button>
      </div>
    </div>
  );
}

type MetricId = "cal" | "protein" | "carbs" | "fat";
const METRICS: { id: MetricId; label: string; unit: string; reverse: boolean }[] = [
  { id: "cal", label: "Calories", unit: "", reverse: false },
  { id: "protein", label: "Protein", unit: "g", reverse: true },
  { id: "carbs", label: "Carbs", unit: "g", reverse: false },
  { id: "fat", label: "Fat", unit: "g", reverse: false },
];
const DAY_COUNT = 14;
const WEEK_COUNT = 8;

function isoDate(d: Date): string { return localDateStr(d); }
function startOfDay(d: Date): Date { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function weekStartFor(d: Date): Date {
  // Sunday-start weeks.
  const r = startOfDay(d);
  r.setDate(r.getDate() - r.getDay());
  return r;
}
function colorForPct(pct: number, reverse: boolean): string {
  const SAT = 65, LIGHT = 55;
  const hsl = (h: number) => `hsl(${Math.round(h)}, ${SAT}%, ${LIGHT}%)`;
  if (reverse) {
    if (pct >= 1) return hsl(130);
    if (pct <= 0) return hsl(0);
    return hsl(pct * 130);
  }
  if (pct <= 0) return hsl(130);
  if (pct < 1) return hsl(130 - (130 - 50) * pct);
  if (pct < 1.2) return hsl(50 - 50 * ((pct - 1) / 0.2));
  return hsl(0);
}

type ForceBucketLite = { push: number; pull: number; static: number; other: number; untagged: number };

const FORCE_COLORS = {
  push: "#ff5c38",
  pull: "#7ec8e3",
  static: "#7fd494",
  other: "#85858d",
} as const;
const REGION_COLORS = {
  upper: "#ff5c38",
  lower: "#7ec8e3",
  core: "#f5a623",
  other: "#85858d",
} as const;

// Render a stacked bar where each segment has a solid "done" portion and a
// striped "planned" portion. Planned values default to zero — when no plan
// data is passed the bar looks identical to the old solid version.
function StackedDonePlannedBar({
  segments,
}: {
  segments: Array<{ key: string; label: string; done: number; planned: number; color: string }>;
}) {
  const totalDone = segments.reduce((s, x) => s + x.done, 0);
  const totalPlanned = segments.reduce((s, x) => s + x.planned, 0);
  const grand = totalDone + totalPlanned;
  if (grand === 0) return null;
  return (
    <div style={{ display: "flex", height: 24, borderRadius: 8, overflow: "hidden", border: "1px solid #2a2a2e" }}>
      {segments.map((s) => {
        const donePct = (s.done / grand) * 100;
        const planPct = (s.planned / grand) * 100;
        return (
          <div key={s.key} style={{ display: "flex", height: "100%" }}>
            {donePct > 0 && (
              <div
                title={`${s.label} done: ${s.done.toFixed(1)} hard sets`}
                style={{ width: `${donePct}%`, background: s.color }}
              />
            )}
            {planPct > 0 && (
              <div
                title={`${s.label} planned: ${s.planned.toFixed(1)} hard sets`}
                style={{
                  width: `${planPct}%`,
                  backgroundImage: `repeating-linear-gradient(45deg, ${s.color} 0 4px, ${s.color}55 4px 8px)`,
                  opacity: 0.85,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ForceView({ done, planned, untaggedNames }: { done: ForceBucketLite; planned: ForceBucketLite; untaggedNames: string[] }) {
  const total = done.push + done.pull + done.static + done.other + planned.push + planned.pull + planned.static + planned.other;
  if (total === 0) {
    return (
      <div style={{ height: 100 }}>
        <EmptyMini text="No tagged push / pull / static work in this window." />
      </div>
    );
  }
  const segs: Array<{ key: keyof ForceBucketLite; label: string; done: number; planned: number; color: string }> = [
    { key: "push", label: "Push", done: done.push, planned: planned.push, color: FORCE_COLORS.push },
    { key: "pull", label: "Pull", done: done.pull, planned: planned.pull, color: FORCE_COLORS.pull },
    { key: "static", label: "Static", done: done.static, planned: planned.static, color: FORCE_COLORS.static },
  ];
  if (done.other + planned.other > 0) {
    segs.push({ key: "other", label: "Other", done: done.other, planned: planned.other, color: FORCE_COLORS.other });
  }
  const untagged = done.untagged + planned.untagged;
  return (
    <div>
      <StackedDonePlannedBar segments={segs} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
        {segs.map((s) => {
          const sum = s.done + s.planned;
          const pct = total > 0 ? Math.round((sum / total) * 100) : 0;
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 9, height: 9, borderRadius: 2, background: s.color }} />
              <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--ink)" }}>
                {s.label}{" "}
                <span style={{ color: "var(--muted)" }}>
                  · {s.done.toFixed(1)}
                  {s.planned > 0 ? ` + ${s.planned.toFixed(1)} planned` : ""} ({pct}%)
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {untagged > 0 && (
        <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)", marginTop: 8 }}>
          {untagged.toFixed(1)} hard sets on untagged custom exercises — pick a library match when logging to include them.
          {untaggedNames.length > 0 && (
            <div style={{ marginTop: 4, color: "#85858d" }}>
              Unmatched: {untaggedNames.join(", ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RegionView({ done, planned }: { done: RegionBreakdown; planned: RegionBreakdown }) {
  const total = done.upper + done.lower + done.core + done.other + planned.upper + planned.lower + planned.core + planned.other;
  if (total === 0) {
    return (
      <div style={{ height: 100 }}>
        <EmptyMini text="No tagged upper/lower work in this window." />
      </div>
    );
  }
  const segs: Array<{ key: keyof Omit<RegionBreakdown, "untagged">; label: string; done: number; planned: number; color: string }> = [
    { key: "upper", label: "Upper", done: done.upper, planned: planned.upper, color: REGION_COLORS.upper },
    { key: "lower", label: "Lower", done: done.lower, planned: planned.lower, color: REGION_COLORS.lower },
    { key: "core", label: "Core", done: done.core, planned: planned.core, color: REGION_COLORS.core },
  ];
  if (done.other + planned.other > 0) {
    segs.push({ key: "other", label: "Other", done: done.other, planned: planned.other, color: REGION_COLORS.other });
  }
  return (
    <div>
      <StackedDonePlannedBar segments={segs} />
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 10 }}>
        {segs.map((s) => {
          const sum = s.done + s.planned;
          const pct = total > 0 ? Math.round((sum / total) * 100) : 0;
          return (
            <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 9, height: 9, borderRadius: 2, background: s.color }} />
              <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--ink)" }}>
                {s.label}{" "}
                <span style={{ color: "var(--muted)" }}>
                  · {s.done.toFixed(1)}
                  {s.planned > 0 ? ` + ${s.planned.toFixed(1)} planned` : ""} ({pct}%)
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MuscleBars({
  byMuscleDone,
  byMusclePlanned,
  attribution,
}: {
  byMuscleDone: Record<string, number>;
  byMusclePlanned: Record<string, number>;
  attribution: "primary" | "secondary";
}) {
  const muscles = new Set<string>([...Object.keys(byMuscleDone), ...Object.keys(byMusclePlanned)]);
  const entries = Array.from(muscles)
    .map((m) => ({ muscle: m, done: byMuscleDone[m] ?? 0, planned: byMusclePlanned[m] ?? 0, total: (byMuscleDone[m] ?? 0) + (byMusclePlanned[m] ?? 0) }))
    .filter((e) => e.total > 0.05)
    .sort((a, b) => b.total - a.total);
  if (entries.length === 0) {
    return (
      <div style={{ height: 100 }}>
        <EmptyMini text={attribution === "primary" ? "No tagged direct muscle work in this window." : "No indirect (secondary) muscle work in this window."} />
      </div>
    );
  }
  const max = entries[0].total;
  const doneOnly = entries.map((e) => e.done).sort((a, b) => a - b);
  const median = doneOnly[Math.floor(doneOnly.length / 2)];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {entries.map((e) => {
        const donePctOfMax = (e.done / max) * 100;
        const planPctOfMax = (e.planned / max) * 100;
        const muted = e.done < median;
        const accent = "var(--accent)";
        return (
          <div key={e.muscle} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 90, fontFamily: "var(--font-body)", fontSize: 12, color: muted ? "var(--muted)" : "var(--ink)", flexShrink: 0 }}>
              {muscleLabel(e.muscle)}
            </div>
            <div style={{ flex: 1, position: "relative", height: 18, background: "#101013", borderRadius: 5, overflow: "hidden", display: "flex" }}>
              <div style={{ width: `${donePctOfMax}%`, height: "100%", background: muted ? "#3a3a40" : accent, transition: "width 200ms" }} />
              {planPctOfMax > 0 && (
                <div
                  title={`${e.planned.toFixed(1)} planned`}
                  style={{
                    width: `${planPctOfMax}%`,
                    height: "100%",
                    backgroundImage: `repeating-linear-gradient(45deg, #e0a070 0 4px, #e0a07055 4px 8px)`,
                    opacity: 0.85,
                  }}
                />
              )}
            </div>
            <div style={{ width: 56, textAlign: "right", fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", flexShrink: 0 }}>
              {e.done.toFixed(1)}{e.planned > 0 ? `+${e.planned.toFixed(1)}` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Compact 8-bar sparkline for one muscle's weekly hard-set totals.
function MuscleSparkline({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(1, ...values);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 22, flex: 1 }}>
      {values.map((v, i) => {
        const h = max > 0 ? (v / max) * 100 : 0;
        return (
          <div
            key={i}
            title={`${v.toFixed(1)} hard sets`}
            style={{
              flex: 1,
              height: `${Math.max(h, v > 0 ? 8 : 0)}%`,
              background: v > 0 ? color : "#2a2a2e",
              borderRadius: 1.5,
              minHeight: v > 0 ? 2 : 0,
            }}
          />
        );
      })}
    </div>
  );
}

export default function TrendsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [weights, setWeights] = useState<WeightLog[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutLog[]>([]);
  const [workoutSets, setWorkoutSets] = useState<WorkoutSet[]>([]);
  const [vitals, setVitals] = useState<Vitals[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessions, setSessions] = useState<AppleWorkout[]>([]);
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);

  // Volume & balance card state
  const library = useLibrary();
  const [stressWindow, setStressWindow] = useState<StressWindow>("28d");
  const [stressView, setStressView] = useState<"force" | "region" | "primary" | "secondary">("force");
  const [includePlanned, setIncludePlanned] = useState(true);

  // Macro history chart state
  const [metric, setMetric] = useState<MetricId>("cal");
  const [grouping, setGrouping] = useState<"day" | "week">("day");
  const [pageOffset, setPageOffset] = useState(0); // pages back from now
  const [focusedWeekStart, setFocusedWeekStart] = useState<string | null>(null);
  const [drilledDay, setDrilledDay] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      const uid = data.user.id;
      const cutoff = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
      const setsCutoff = new Date(Date.now() - 90 * 86400000).toISOString();
      Promise.all([
        supabase.from("weight_logs").select("*").eq("user_id", uid).order("date").limit(90),
        supabase.from("workout_logs").select("*").eq("user_id", uid).order("date", { ascending: false }).limit(500),
        supabase.from("vitals").select("*").eq("user_id", uid).order("date", { ascending: false }).limit(30),
        supabase.from("profiles").select("*").eq("user_id", uid).single(),
        supabase.from("apple_workouts").select("*").eq("user_id", uid).order("date", { ascending: false }).limit(20),
        supabase.from("meal_logs").select("*").eq("user_id", uid).gte("date", cutoff).order("date", { ascending: false }),
        supabase.from("plans").select("*").eq("user_id", uid).in("status", ["current", "archived"]).order("generated_at", { ascending: false }),
        supabase.from("workout_sets").select("*").eq("user_id", uid).gte("created_at", setsCutoff),
      ]).then(([{ data: w }, { data: wk }, { data: v }, { data: p }, { data: s }, { data: m }, { data: pl }, { data: ws }]) => {
        if (w) setWeights(w as WeightLog[]);
        if (wk) setWorkouts(wk as WorkoutLog[]);
        if (v) setVitals(v as Vitals[]);
        if (p) setProfile(p as Profile);
        if (s) setSessions(s as AppleWorkout[]);
        if (m) setMeals(m as MealLog[]);
        if (pl) setPlans(pl as unknown as Plan[]);
        if (ws) setWorkoutSets(ws as WorkoutSet[]);
      });
    });
  }, []);

  // Index meal totals by date for fast lookup.
  const totalsByDate = useMemo(() => {
    const map = new Map<string, { cal: number; protein: number; carbs: number; fat: number }>();
    meals.forEach((m) => {
      const cur = map.get(m.date) ?? { cal: 0, protein: 0, carbs: 0, fat: 0 };
      cur.cal += m.calories || 0;
      cur.protein += m.protein || 0;
      cur.carbs += m.carbs || 0;
      cur.fat += m.fat || 0;
      map.set(m.date, cur);
    });
    return map;
  }, [meals]);

  function planForDate(date: string): Plan | null {
    for (const p of plans) {
      const start = p.generated_at.slice(0, 10);
      const end = isoDate(addDays(new Date(start + "T00:00:00"), CYCLE_DAYS));
      if (date >= start && date < end) return p;
    }
    const fallback = plans.find((p) => p.generated_at.slice(0, 10) <= date);
    return fallback ?? plans[0] ?? null;
  }

  function targetForDate(date: string, m: MetricId): number {
    const p = planForDate(date);
    if (!p) return 0;
    if (m === "cal") return p.calorie_target;
    return p.macros?.[m as "protein" | "carbs" | "fat"] ?? 0;
  }

  // Build chart data based on grouping + offset.
  const chartData = useMemo(() => {
    const today = startOfDay(new Date());
    type Slot = { key: string; label: string; value: number; target: number; dates: string[]; clickable: "day" | "week" };
    const slots: Slot[] = [];

    if (focusedWeekStart) {
      // 7-bar daily drill-in of a single week.
      const start = new Date(focusedWeekStart + "T00:00:00");
      for (let i = 0; i < 7; i++) {
        const d = addDays(start, i);
        const iso = isoDate(d);
        const tot = totalsByDate.get(iso);
        const val = tot ? tot[metric] : 0;
        slots.push({
          key: iso,
          label: d.toLocaleDateString(undefined, { weekday: "short" }) + " " + iso.slice(5),
          value: Math.round(val),
          target: Math.round(targetForDate(iso, metric)),
          dates: [iso],
          clickable: "day",
        });
      }
      return slots;
    }

    if (grouping === "day") {
      // 14-day window, oldest on left.
      const lastDate = addDays(today, -pageOffset * DAY_COUNT);
      for (let i = DAY_COUNT - 1; i >= 0; i--) {
        const d = addDays(lastDate, -i);
        const iso = isoDate(d);
        const tot = totalsByDate.get(iso);
        const val = tot ? tot[metric] : 0;
        slots.push({
          key: iso,
          label: iso.slice(5),
          value: Math.round(val),
          target: Math.round(targetForDate(iso, metric)),
          dates: [iso],
          clickable: "day",
        });
      }
    } else {
      // 8-week window, oldest on left.
      const thisWeekStart = weekStartFor(today);
      const lastWeekStart = addDays(thisWeekStart, -pageOffset * WEEK_COUNT * 7);
      for (let i = WEEK_COUNT - 1; i >= 0; i--) {
        const wkStart = addDays(lastWeekStart, -i * 7);
        const dates: string[] = [];
        let val = 0, target = 0;
        for (let j = 0; j < 7; j++) {
          const d = addDays(wkStart, j);
          const iso = isoDate(d);
          dates.push(iso);
          const tot = totalsByDate.get(iso);
          if (tot) val += tot[metric];
          target += targetForDate(iso, metric);
        }
        slots.push({
          key: isoDate(wkStart),
          label: isoDate(wkStart).slice(5),
          value: Math.round(val),
          target: Math.round(target),
          dates,
          clickable: "week",
        });
      }
    }
    return slots;
  }, [grouping, pageOffset, metric, totalsByDate, plans, focusedWeekStart]);

  // Volume & balance: expand sets → muscle / force aggregates for the chosen window.
  const stressData = useMemo(() => {
    if (library.bySlug.size === 0) return null;
    if (workouts.length === 0 && plans.length === 0) return null;
    const today = localDateStr(new Date());

    // Done: workout_sets-driven (with byName fallback) + summary-only fallback
    // for older logs that never wrote per-set rows.
    const fromSets = expandWorkoutsToHardSets(workouts, workoutSets, library.bySlug, profile, library.byName, library.byNameNorm);
    const coveredLogIds = new Set(workoutSets.map((s) => s.workout_log_id));
    const fromSummary = synthesizeHardSetsFromLogs(workouts, library.bySlug, profile, library.byName, coveredLogIds, library.byNameNorm);
    const doneExpanded = [...fromSets, ...fromSummary];

    // Planned: only from the *current* plan (status === "current"); fall back
    // to the most recent plan if none is marked current. Skip past planned
    // days entirely (per "not skipped" rule). Expansion is independent of the
    // toggle so we always know whether *anything* is planned ahead — the
    // toggle just gates whether aggregations consume it.
    const currentPlan = plans.find((p) => p.status === "current") ?? plans[0] ?? null;
    const loggedKeysByDate = buildLoggedKeysByDate(workouts);
    const plannedExpandedAll = currentPlan
      ? expandPlanToHardSets(currentPlan, CYCLE_DAYS, today, library.bySlug, library.byName, profile, loggedKeysByDate, library.byNameNorm)
      : [];
    const plannedExpanded = includePlanned ? plannedExpandedAll : [];

    const doneInWindow = filterToWindow(doneExpanded, stressWindow, today);
    // Planned can extend beyond `today` — include anything from today forward
    // within the cycle (window is past-trailing, planned is future-leading).
    const plannedInWindow = plannedExpanded;

    const byForceDone = hardSetsByForce(doneInWindow);
    const byForcePlan = hardSetsByForce(plannedInWindow);
    const byRegionDone = hardSetsByRegion(doneInWindow);
    const byRegionPlan = hardSetsByRegion(plannedInWindow);
    const byPrimaryDone = hardSetsByMuscle(doneInWindow, "primary");
    const byPrimaryPlan = hardSetsByMuscle(plannedInWindow, "primary");
    const bySecondaryDone = hardSetsByMuscle(doneInWindow, "secondary");
    const bySecondaryPlan = hardSetsByMuscle(plannedInWindow, "secondary");
    const windowLabel = stressWindow === "7d" ? "7 days" : stressWindow === "28d" ? "28 days" : "90 days";
    // Imbalances + staleness use done-only — what's planned shouldn't suppress
    // a real imbalance the user has built up.
    const imbalances = detectImbalances(byForceDone, byPrimaryDone, windowLabel);
    const stale = detectStaleMuscles(doneExpanded, today, 14, 28, 4);
    const weekly = weeklyTrendByMuscle(doneExpanded, today, 8);
    const untaggedNames = untaggedExerciseNames([...doneInWindow, ...plannedInWindow]);
    return {
      doneInWindow,
      plannedInWindow,
      byForceDone, byForcePlan,
      byRegionDone, byRegionPlan,
      byPrimaryDone, byPrimaryPlan,
      bySecondaryDone, bySecondaryPlan,
      imbalances, stale, weekly, windowLabel,
      hasPlanned: plannedExpandedAll.length > 0,
      untaggedNames,
    };
  }, [workouts, workoutSets, library.bySlug, library.byName, library.byNameNorm, profile, stressWindow, plans, includePlanned]);

  const metricInfo = METRICS.find((m) => m.id === metric)!;
  const avgTarget = useMemo(() => {
    const withTarget = chartData.filter((c) => c.target > 0);
    if (!withTarget.length) return 0;
    return withTarget.reduce((s, c) => s + c.target, 0) / withTarget.length;
  }, [chartData]);
  const hasAnyData = chartData.some((c) => c.value > 0);

  function handleBarClick(payload: { key: string; clickable: "day" | "week" } | undefined) {
    if (!payload) return;
    if (payload.clickable === "day") {
      setDrilledDay(payload.key);
    } else {
      setFocusedWeekStart(payload.key);
    }
  }

  const weightData = weights.map((w) => ({ date: w.date.slice(5), weight: w.value }));

  const sortedVitals = [...vitals].sort((a, b) => a.date.localeCompare(b.date));
  const latestVitals = [...sortedVitals].reverse().find(v =>
    v.resting_hr != null || v.avg_hr != null || v.active_energy_kcal != null || v.steps != null
  ) ?? null;
  const vitalsData = sortedVitals
    .slice(-14)
    .map((v) => ({ date: v.date.slice(5), burned: v.active_energy_kcal ?? 0, steps: v.steps ?? 0 }));

  const byEx: Record<string, WorkoutLog[]> = {};
  workouts.forEach((x) => {
    if (x.weight > 0) (byEx[x.exercise_name] = byEx[x.exercise_name] || []).push(x);
  });
  const exNames = Object.keys(byEx);

  return (
    <div style={{ paddingTop: 16 }}>
      <Card>
        <Label icon={TrendingUp}>Weight vs goal</Label>
        <div style={{ height: 200, marginTop: 10 }}>
          {weightData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weightData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2e" />
                <XAxis dataKey="date" stroke="#6b6b72" fontSize={11} />
                <YAxis stroke="#6b6b72" fontSize={11} domain={["auto", "auto"]} />
                <Tooltip contentStyle={tooltipStyle} />
                {profile?.goal_weight && (
                  <ReferenceLine
                    y={profile.goal_weight}
                    stroke="#ff5c38"
                    strokeDasharray="4 4"
                    label={{ value: "goal", fill: "#ff5c38", fontSize: 10, position: "right" }}
                  />
                )}
                <Line type="monotone" dataKey="weight" stroke="#ff5c38" strokeWidth={2.5} dot={{ r: 3, fill: "#ff5c38" }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyMini text="Log a few weigh-ins to see your trend." />
          )}
        </div>
      </Card>

      <Card>
        <Label icon={UtensilsCrossed}>Macros history</Label>

        {/* Metric tabs */}
        <div style={{ display: "flex", gap: 4, marginTop: 10, marginBottom: 10, background: "#101013", border: "1px solid #2a2a2e", borderRadius: 10, padding: 3 }}>
          {METRICS.map((m) => (
            <button
              key={m.id}
              onClick={() => setMetric(m.id)}
              style={{
                flex: 1, padding: "7px 0", borderRadius: 7, border: "none", cursor: "pointer",
                fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 11.5,
                background: metric === m.id ? "var(--accent)" : "transparent",
                color: metric === m.id ? "#140a06" : "var(--muted)",
              }}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* Grouping + pager */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          {focusedWeekStart ? (
            <button
              onClick={() => setFocusedWeekStart(null)}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "1px solid #2a2a2e", borderRadius: 8, padding: "6px 10px", cursor: "pointer", color: "var(--ink)", fontFamily: "var(--font-body)", fontSize: 12 }}
            >
              <ArrowLeft size={13} /> Back to weeks
            </button>
          ) : (
            <div style={{ display: "flex", gap: 4, background: "#101013", border: "1px solid #2a2a2e", borderRadius: 9, padding: 3 }}>
              {(["day", "week"] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => { setGrouping(g); setPageOffset(0); }}
                  style={{
                    padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                    fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 11,
                    background: grouping === g ? "#2a2a2e" : "transparent",
                    color: grouping === g ? "var(--ink)" : "var(--muted)",
                  }}
                >
                  {g === "day" ? "Daily" : "Weekly"}
                </button>
              ))}
            </div>
          )}
          {!focusedWeekStart && (
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
              <button
                onClick={() => setPageOffset((o) => o + 1)}
                aria-label="Older"
                style={{ background: "transparent", border: "1px solid #2a2a2e", borderRadius: 8, padding: "5px 7px", cursor: "pointer", color: "var(--ink)" }}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                onClick={() => setPageOffset((o) => Math.max(0, o - 1))}
                disabled={pageOffset === 0}
                aria-label="Newer"
                style={{ background: "transparent", border: "1px solid #2a2a2e", borderRadius: 8, padding: "5px 7px", cursor: pageOffset === 0 ? "default" : "pointer", color: pageOffset === 0 ? "#3a3a40" : "var(--ink)" }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>

        {/* Chart */}
        <div style={{ height: 200 }}>
          {hasAnyData ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2e" />
                <XAxis dataKey="label" stroke="#6b6b72" fontSize={10} interval={focusedWeekStart ? 0 : "preserveStartEnd"} />
                <YAxis stroke="#6b6b72" fontSize={11} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={((v: unknown) => [`${v}${metricInfo.unit}`, metricInfo.label]) as never}
                  labelFormatter={((label: unknown, items: Array<{ payload?: { target?: number } }> | undefined) => {
                    const item = items?.[0]?.payload;
                    const t = item?.target ?? 0;
                    return t > 0 ? `${String(label)} · target ${t}${metricInfo.unit}` : String(label);
                  }) as never}
                />
                {avgTarget > 0 && (
                  <ReferenceLine
                    y={avgTarget}
                    stroke="#ff5c38"
                    strokeDasharray="4 4"
                    label={{ value: "target", fill: "#ff5c38", fontSize: 9, position: "right" }}
                  />
                )}
                <Bar dataKey="value" radius={[4, 4, 0, 0]} onClick={(d) => handleBarClick(d as unknown as { key: string; clickable: "day" | "week" })} cursor="pointer">
                  {chartData.map((d) => (
                    <Cell
                      key={d.key}
                      fill={colorForPct(d.target > 0 ? d.value / d.target : 0, metricInfo.reverse)}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyMini text="Log some meals to see your macro history." />
          )}
        </div>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)", marginTop: 8, textAlign: "center" }}>
          {focusedWeekStart
            ? "Tap a bar to view & edit that day's meals."
            : grouping === "day"
              ? "Tap a bar to view & edit that day's meals."
              : "Tap a week to drill into its days."}
        </div>
      </Card>

      {drilledDay && (
        <DayDetailModal
          date={drilledDay}
          onClose={() => setDrilledDay(null)}
          onEdit={() => router.push(`/log?date=${drilledDay}`)}
          meals={meals.filter((m) => m.date === drilledDay)}
          target={planForDate(drilledDay)}
        />
      )}

      <Card>
        <Label icon={Dumbbell}>Strength progression</Label>
        <div style={{ marginTop: 8 }}>
          {exNames.length > 0 ? (
            exNames.slice(0, 6).map((name) => {
              const hist = byEx[name].slice(-4);
              return (
                <div key={name} style={{ padding: "9px 0", borderBottom: "1px solid #232327" }}>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 13.5, fontWeight: 600 }}>{name}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                    {hist.map((h, i) => (
                      <span
                        key={i}
                        style={{
                          fontFamily: "var(--font-body)",
                          fontSize: 11.5,
                          color: i === hist.length - 1 ? "var(--accent)" : "var(--muted)",
                          background: "#101013",
                          border: "1px solid #2a2a2e",
                          borderRadius: 6,
                          padding: "3px 8px",
                        }}
                      >
                        {h.weight} lb × {h.reps}{i === hist.length - 1 ? " ←" : ""}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            <EmptyMini text="Log workout weights to watch your lifts climb." />
          )}
        </div>
      </Card>

      <Card>
        <Label icon={Scale}>Workout volume & balance</Label>

        {/* Window selector */}
        <div style={{ display: "flex", gap: 4, marginTop: 10, marginBottom: 10, background: "#101013", border: "1px solid #2a2a2e", borderRadius: 10, padding: 3 }}>
          {(["7d", "28d", "90d"] as const).map((w) => (
            <button
              key={w}
              onClick={() => setStressWindow(w)}
              style={{
                flex: 1, padding: "7px 0", borderRadius: 7, border: "none", cursor: "pointer",
                fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 11.5,
                background: stressWindow === w ? "var(--accent)" : "transparent",
                color: stressWindow === w ? "#140a06" : "var(--muted)",
              }}
            >
              {w === "7d" ? "Last 7d" : w === "28d" ? "Last 28d" : "Last 90d"}
            </button>
          ))}
        </div>

        {/* View tabs */}
        <div style={{ display: "flex", gap: 4, marginBottom: 10, background: "#101013", border: "1px solid #2a2a2e", borderRadius: 10, padding: 3, flexWrap: "wrap" }}>
          {([
            { id: "force" as const, label: "Push / Pull" },
            { id: "region" as const, label: "Upper / Lower" },
            { id: "primary" as const, label: "Primary" },
            { id: "secondary" as const, label: "Secondary" },
          ]).map((v) => (
            <button
              key={v.id}
              onClick={() => setStressView(v.id)}
              style={{
                flex: 1, padding: "6px 0", borderRadius: 7, border: "none", cursor: "pointer",
                fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 11,
                background: stressView === v.id ? "#2a2a2e" : "transparent",
                color: stressView === v.id ? "var(--ink)" : "var(--muted)",
              }}
            >
              {v.label}
            </button>
          ))}
        </div>

        {/* Planned-work toggle — only when there's something planned ahead */}
        {stressData?.hasPlanned && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
            <button
              onClick={() => setIncludePlanned((v) => !v)}
              style={{
                fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: includePlanned ? "#2a1d10" : "#101013",
                border: `1px solid ${includePlanned ? "#5a3a1a" : "#2a2a2e"}`,
                color: includePlanned ? "var(--ink)" : "var(--muted)",
                borderRadius: 8, padding: "5px 10px",
                display: "flex", alignItems: "center", gap: 6,
              }}
              title="Toggle the striped overlay showing the rest of this cycle's planned work"
            >
              <div
                style={{
                  width: 14, height: 10, borderRadius: 2,
                  backgroundImage: "repeating-linear-gradient(45deg, #e0a070 0 3px, #e0a07055 3px 6px)",
                  opacity: includePlanned ? 1 : 0.4,
                }}
              />
              {includePlanned ? "Showing planned ahead" : "Show planned ahead"}
            </button>
          </div>
        )}

        {!stressData || (stressData.doneInWindow.length === 0 && stressData.plannedInWindow.length === 0 && !stressData.hasPlanned) ? (
          <div style={{ height: 140 }}>
            <EmptyMini text="Log some workouts to see your volume breakdown." />
            <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--muted)", textAlign: "center", marginTop: 6 }}>
              debug: logs={workouts.length} sets={workoutSets.length} lib={library.bySlug.size}
              {stressData ? ` · done=${stressData.doneInWindow.length} planned=${stressData.plannedInWindow.length}` : " · stressData=null"}
              {workouts.length > 0 ? ` · withSlug=${workouts.filter(w => w.library_slug).length}` : ""}
              {workoutSets.length > 0 && workouts.length > 0 ? ` · matched=${workoutSets.filter(s => workouts.some(w => w.id === s.workout_log_id)).length}` : ""}
            </div>
          </div>
        ) : (
          <>
            {/* Imbalance banners */}
            {stressData.imbalances.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {stressData.imbalances.map((im) => (
                  <div
                    key={im.kind}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      background: "#2a1d10",
                      border: "1px solid #5a3a1a",
                      borderRadius: 10,
                      padding: "9px 11px",
                      marginBottom: 6,
                    }}
                  >
                    <AlertTriangle size={14} style={{ color: "#f5a623", flexShrink: 0, marginTop: 2 }} />
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--ink)", lineHeight: 1.4 }}>
                      {im.message}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Stale-muscle callouts — top 3 to avoid swamping the card */}
            {stressData.stale.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {stressData.stale.slice(0, 3).map((sm) => (
                  <div
                    key={sm.muscle}
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "flex-start",
                      background: "#101a23",
                      border: "1px solid #1f3a52",
                      borderRadius: 10,
                      padding: "8px 11px",
                      marginBottom: 6,
                    }}
                  >
                    <AlertTriangle size={14} style={{ color: "#7ec8e3", flexShrink: 0, marginTop: 2 }} />
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--ink)", lineHeight: 1.4 }}>
                      <strong>{muscleLabel(sm.muscle)}</strong> hasn't been trained in {sm.daysSinceLast} days
                      <span style={{ color: "var(--muted)" }}> · {sm.priorWindowSets.toFixed(1)} hard sets in the prior month</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {stressView === "force" && (
              <ForceView done={stressData.byForceDone} planned={includePlanned ? stressData.byForcePlan : { push: 0, pull: 0, static: 0, other: 0, untagged: 0 }} untaggedNames={stressData.untaggedNames} />
            )}
            {stressView === "region" && (
              <RegionView done={stressData.byRegionDone} planned={includePlanned ? stressData.byRegionPlan : { upper: 0, lower: 0, core: 0, other: 0, untagged: 0 }} />
            )}
            {stressView === "primary" && (
              <MuscleBars byMuscleDone={stressData.byPrimaryDone} byMusclePlanned={includePlanned ? stressData.byPrimaryPlan : {}} attribution="primary" />
            )}
            {stressView === "secondary" && (
              <MuscleBars byMuscleDone={stressData.bySecondaryDone} byMusclePlanned={includePlanned ? stressData.bySecondaryPlan : {}} attribution="secondary" />
            )}

            <div style={{ fontFamily: "var(--font-body)", fontSize: 10.5, color: "var(--muted)", marginTop: 10, textAlign: "center" }}>
              Hard sets — RPE-graded (≥9 full, ≤5 zero), secondary muscles at 0.5×. Striped = planned ahead.
            </div>
          </>
        )}
      </Card>

      {/* Weekly trend per muscle */}
      {stressData && Object.keys(stressData.weekly.byMuscle).length > 0 && (
        <Card>
          <Label icon={Scale}>Muscle trend — last 8 weeks</Label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
            {Object.entries(stressData.weekly.byMuscle)
              .map(([m, vals]) => ({ muscle: m, vals, total: vals.reduce((s, v) => s + v, 0) }))
              .filter((e) => e.total > 0.05)
              .sort((a, b) => b.total - a.total)
              .slice(0, 10)
              .map((e) => {
                const recent = e.vals[e.vals.length - 1];
                const prior = e.vals[e.vals.length - 2] ?? 0;
                const delta = recent - prior;
                const arrow = Math.abs(delta) < 0.5 ? "→" : delta > 0 ? "↑" : "↓";
                const arrowColor = Math.abs(delta) < 0.5 ? "var(--muted)" : delta > 0 ? "#7fd494" : "#ff5c38";
                return (
                  <div key={e.muscle} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 90, fontFamily: "var(--font-body)", fontSize: 12, color: "var(--ink)", flexShrink: 0 }}>
                      {muscleLabel(e.muscle)}
                    </div>
                    <MuscleSparkline values={e.vals} color="var(--accent)" />
                    <div style={{ width: 56, textAlign: "right", fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)", flexShrink: 0 }}>
                      <span style={{ color: arrowColor }}>{arrow}</span> {recent.toFixed(1)}
                    </div>
                  </div>
                );
              })}
          </div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 10.5, color: "var(--muted)", marginTop: 10, textAlign: "center" }}>
            Hard sets per week. Arrow compares the most recent week to the one before.
          </div>
        </Card>
      )}

      {/* Latest vitals snapshot */}
      {latestVitals && (
        <Card>
          <Label icon={Heart}>Latest vitals — {latestVitals.date}</Label>
          <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
            {[
              { label: "Resting HR", value: latestVitals.resting_hr, unit: "bpm" },
              { label: "Avg HR", value: latestVitals.avg_hr, unit: "bpm" },
              { label: "Active kcal", value: latestVitals.active_energy_kcal != null ? Math.round(latestVitals.active_energy_kcal) : null, unit: "kcal" },
              { label: "Steps", value: latestVitals.steps != null ? latestVitals.steps.toLocaleString() : null, unit: "" },
            ].map(({ label, value, unit }) => (
              <div key={label} style={{ flex: 1, minWidth: 70, background: "#101013", border: "1px solid #2a2a2e", borderRadius: 10, padding: "10px 12px" }}>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--muted)", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 4 }}>{label.toUpperCase()}</div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 18, color: value != null ? "var(--ink)" : "var(--muted)" }}>
                  {value ?? "—"}
                </div>
                {unit && <div style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--muted)" }}>{unit}</div>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {sessions.length > 0 && (
        <Card>
          <Label icon={Activity}>Watch workouts</Label>
          <div style={{ marginTop: 8 }}>
            {sessions.slice(0, 10).map((s) => {
              const typeColor: Record<string, string> = { walk: "#7fd494", run: "#ff5c38", cardio: "#f5a623", strength: "#7ec8e3", other: "#85858d" };
              const color = typeColor[s.type] ?? "#85858d";
              return (
                <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "9px 0", borderBottom: "1px solid #232327" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 700, color, background: color + "22", borderRadius: 4, padding: "1px 6px", textTransform: "uppercase" }}>{s.type}</span>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600 }}>{s.name ?? s.type}</span>
                    </div>
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                      {s.duration_min != null && <span>{Math.round(s.duration_min)} min</span>}
                      {s.distance_km != null && <span>{s.distance_km.toFixed(1)} km</span>}
                      {s.calories != null && <span>{s.calories} kcal</span>}
                      {s.avg_hr != null && <span>avg {s.avg_hr} bpm</span>}
                      {s.max_hr != null && <span>max {s.max_hr} bpm</span>}
                    </div>
                  </div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)", flexShrink: 0, marginLeft: 8 }}>{s.date.slice(5)}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card>
        <Label icon={Flame}>Active energy & steps</Label>
        <div style={{ height: 160, marginTop: 10 }}>
          {vitalsData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={vitalsData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2e" />
                <XAxis dataKey="date" stroke="#6b6b72" fontSize={11} />
                <YAxis stroke="#6b6b72" fontSize={11} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="burned" name="kcal" fill="#ff5c38" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyMini text="Apple Health data will appear here once synced." />
          )}
        </div>
        {vitalsData.length > 0 && (
          <div style={{ height: 120, marginTop: 8 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={vitalsData} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2e" />
                <XAxis dataKey="date" stroke="#6b6b72" fontSize={11} />
                <YAxis stroke="#6b6b72" fontSize={11} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="steps" name="steps" fill="#7fd494" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  );
}
