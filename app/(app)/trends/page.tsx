"use client";

import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  BarChart, Bar, CartesianGrid,
} from "recharts";
import { TrendingUp, Dumbbell, Flame, Heart, Footprints, Activity } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { EmptyMini } from "@/components/ui/Empty";
import { createClient } from "@/lib/supabase/client";
import type { WeightLog, WorkoutLog, Vitals, Profile, WorkoutSession } from "@/lib/types";

const tooltipStyle = { background: "#18181b", border: "1px solid #2a2a2e", borderRadius: 8, color: "#f4f1ea" };

export default function TrendsPage() {
  const supabase = createClient();
  const [weights, setWeights] = useState<WeightLog[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutLog[]>([]);
  const [vitals, setVitals] = useState<Vitals[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      const uid = data.user.id;
      Promise.all([
        supabase.from("weight_logs").select("*").eq("user_id", uid).order("date").limit(90),
        supabase.from("workout_logs").select("*").eq("user_id", uid).order("date").limit(200),
        supabase.from("vitals").select("*").eq("user_id", uid).order("date", { ascending: false }).limit(30),
        supabase.from("profiles").select("*").eq("user_id", uid).single(),
        supabase.from("workout_sessions").select("*").eq("user_id", uid).order("date", { ascending: false }).limit(20),
      ]).then(([{ data: w }, { data: wk }, { data: v }, { data: p }, { data: s }]) => {
        if (w) setWeights(w as WeightLog[]);
        if (wk) setWorkouts(wk as WorkoutLog[]);
        if (v) setVitals(v as Vitals[]);
        if (p) setProfile(p as Profile);
        if (s) setSessions(s as WorkoutSession[]);
      });
    });
  }, []);

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
