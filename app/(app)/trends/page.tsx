"use client";

import { useEffect, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  BarChart, Bar, CartesianGrid,
} from "recharts";
import { TrendingUp, Dumbbell, Flame } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { EmptyMini } from "@/components/ui/Empty";
import { createClient } from "@/lib/supabase/client";
import type { WeightLog, WorkoutLog, Vitals, Profile } from "@/lib/types";

const tooltipStyle = { background: "#18181b", border: "1px solid #2a2a2e", borderRadius: 8, color: "#f4f1ea" };

export default function TrendsPage() {
  const supabase = createClient();
  const [weights, setWeights] = useState<WeightLog[]>([]);
  const [workouts, setWorkouts] = useState<WorkoutLog[]>([]);
  const [vitals, setVitals] = useState<Vitals[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      const uid = data.user.id;
      Promise.all([
        supabase.from("weight_logs").select("*").eq("user_id", uid).order("date").limit(90),
        supabase.from("workout_logs").select("*").eq("user_id", uid).order("date").limit(200),
        supabase.from("vitals").select("*").eq("user_id", uid).order("date", { ascending: false }).limit(30),
        supabase.from("profiles").select("*").eq("user_id", uid).single(),
      ]).then(([{ data: w }, { data: wk }, { data: v }, { data: p }]) => {
        if (w) setWeights(w as WeightLog[]);
        if (wk) setWorkouts(wk as WorkoutLog[]);
        if (v) setVitals(v as Vitals[]);
        if (p) setProfile(p as Profile);
      });
    });
  }, []);

  const weightData = weights.map((w) => ({ date: w.date.slice(5), weight: w.value }));

  const vitalsData = [...vitals]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-14)
    .map((v) => ({ date: v.date.slice(5), burned: v.active_energy_kcal ?? 0 }));

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

      <Card>
        <Label icon={Flame}>Calories burned (vitals)</Label>
        <div style={{ height: 160, marginTop: 10 }}>
          {vitalsData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={vitalsData} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2e" />
                <XAxis dataKey="date" stroke="#6b6b72" fontSize={11} />
                <YAxis stroke="#6b6b72" fontSize={11} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="burned" fill="#ff5c38" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyMini text="Log vitals to track energy burn." />
          )}
        </div>
      </Card>
    </div>
  );
}
