"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  BarChart, Bar, CartesianGrid, Cell,
} from "recharts";
import { TrendingUp, Dumbbell, Flame, Heart, Activity, UtensilsCrossed, ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { EmptyMini } from "@/components/ui/Empty";
import { createClient } from "@/lib/supabase/client";
import { CYCLE_DAYS } from "@/lib/config";
import type { WeightLog, WorkoutLog, Vitals, Profile, WorkoutSession, MealLog, MealSlot, Plan } from "@/lib/types";

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

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }
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

export default function TrendsPage() {
  const supabase = createClient();
  const router = useRouter();
  const [weights, setWeights] = useState<WeightLog[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutLog[]>([]);
  const [vitals, setVitals] = useState<Vitals[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [meals, setMeals] = useState<MealLog[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);

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
      Promise.all([
        supabase.from("weight_logs").select("*").eq("user_id", uid).order("date").limit(90),
        supabase.from("workout_logs").select("*").eq("user_id", uid).order("date").limit(200),
        supabase.from("vitals").select("*").eq("user_id", uid).order("date", { ascending: false }).limit(30),
        supabase.from("profiles").select("*").eq("user_id", uid).single(),
        supabase.from("workout_sessions").select("*").eq("user_id", uid).order("date", { ascending: false }).limit(20),
        supabase.from("meal_logs").select("*").eq("user_id", uid).gte("date", cutoff).order("date", { ascending: false }),
        supabase.from("plans").select("*").eq("user_id", uid).in("status", ["current", "archived"]).order("generated_at", { ascending: false }),
      ]).then(([{ data: w }, { data: wk }, { data: v }, { data: p }, { data: s }, { data: m }, { data: pl }]) => {
        if (w) setWeights(w as WeightLog[]);
        if (wk) setWorkouts(wk as WorkoutLog[]);
        if (v) setVitals(v as Vitals[]);
        if (p) setProfile(p as Profile);
        if (s) setSessions(s as WorkoutSession[]);
        if (m) setMeals(m as MealLog[]);
        if (pl) setPlans(pl as unknown as Plan[]);
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
