"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Target, Dumbbell, UtensilsCrossed, Plane, Sparkles, Heart, Copy, Check as CheckIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { Field } from "@/components/ui/Field";
import { primaryBtnStyle, inputStyle, textareaStyle } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";
import { localDateStr } from "@/lib/date";
import type { Profile } from "@/lib/types";

const todayStr = () => localDateStr();
const daysBetween = (a: string, b: string) =>
  Math.max(0, Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000));

const DEFAULT_PROFILE: Omit<Profile, "user_id"> = {
  start_weight: 200, current_weight: 200, goal_weight: 180,
  start_date: todayStr(), target_rate: 1,
  primary_goal: "", goal_event_date: null,
  experience: "Intermediate", training_history: "",
  exclusions: "", equipment: "Dumbbells, barbell, bands, treadmill",
  workout_days: "4 days/week, strength + cardio",
  diet_prefs: "No restrictions. High-protein.",
  pantry: "Olive oil, salt, pepper, spices, rice, eggs, garlic, onion, butter",
  disruptions: "",
};

function GoalsContent() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Omit<Profile, "user_id">>(DEFAULT_PROFILE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [ingestToken, setIngestToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setUserId(data.user.id);
      const { data: prof } = await supabase.from("profiles").select("*").eq("user_id", data.user.id).single();
      if (prof) {
        setProfile(prof as Omit<Profile, "user_id">);
        const res = await fetch("/api/me/token");
        const json = await res.json();
        if (json.token) setIngestToken(json.token);
      }
    });
  }, []);

  const searchParams = useSearchParams();
  const isOnboarding = searchParams.get("onboarding") === "1";

  const set = (k: keyof typeof profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setProfile((p) => ({ ...p, [k]: e.target.value }));

  async function save() {
    if (!userId) return;
    setSaving(true);
    await supabase.from("profiles").upsert({ user_id: userId, ...profile }, { onConflict: "user_id" });
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const daysSinceStart = daysBetween(profile.start_date, todayStr());

  const webhookUrl = ingestToken
    ? `https://cadence-app-sooty.vercel.app/api/ingest/vitals?token=${ingestToken}`
    : null;

  async function copyUrl() {
    if (!webhookUrl) return;
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{ paddingTop: 16 }}>
      {isOnboarding && (
        <div style={{
          background: "var(--accent)",
          borderRadius: 14,
          padding: "14px 16px",
          marginBottom: 14,
          color: "#140a06",
        }}>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16, marginBottom: 4 }}>
            Welcome to Cadence 👋
          </div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 13, lineHeight: 1.5 }}>
            Fill in your goals below, tap <strong>Save goals</strong>, then head to the Today tab to build your first plan.
          </div>
        </div>
      )}
      <Card accent>
        <Label icon={Sparkles}>Primary goal</Label>
        <Field label="What is your main goal right now?">
          <textarea
            value={profile.primary_goal}
            onChange={set("primary_goal")}
            rows={2}
            placeholder="e.g. Improve VO2 max, look lean for a beach trip, get stronger on the bench"
            style={textareaStyle}
          />
        </Field>
        <Field label="Target event date (optional)">
          <input value={profile.goal_event_date ?? ""} onChange={set("goal_event_date")} type="date" style={inputStyle} />
        </Field>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
          This drives your entire plan — training emphasis, calories, and macros.
        </div>
      </Card>

      <Card>
        <Label icon={Target}>Weight targets</Label>
        <Field label="Start weight (lb)">
          <input value={profile.start_weight} onChange={set("start_weight")} inputMode="decimal" style={inputStyle} />
        </Field>
        <Field label="Current weight (lb)">
          <input value={profile.current_weight} onChange={set("current_weight")} inputMode="decimal" style={inputStyle} />
        </Field>
        <Field label="Goal weight (lb)">
          <input value={profile.goal_weight} onChange={set("goal_weight")} inputMode="decimal" style={inputStyle} />
        </Field>
        <Field label="Target rate (lb/week)">
          <input value={profile.target_rate} onChange={set("target_rate")} inputMode="decimal" style={inputStyle} />
        </Field>
        <Field label="Start date">
          <input value={profile.start_date} onChange={set("start_date")} type="date" style={inputStyle} />
        </Field>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
          {daysSinceStart} days in.
        </div>
      </Card>

      <Card>
        <Label icon={Dumbbell}>Training</Label>
        <Field label="Experience level">
          <select value={profile.experience} onChange={set("experience")} style={inputStyle}>
            <option>Beginner</option>
            <option>Intermediate</option>
            <option>Advanced</option>
          </select>
        </Field>
        <Field label="Training history & background">
          <textarea value={profile.training_history} onChange={set("training_history")} rows={2} placeholder="e.g. Lifted in college, comfortable with barbell" style={textareaStyle} />
        </Field>
        <Field label="Exercises to avoid / injuries">
          <textarea value={profile.exclusions} onChange={set("exclusions")} rows={2} placeholder="e.g. No deadlifts, bad lower back" style={textareaStyle} />
        </Field>
        <Field label="Equipment available">
          <textarea value={profile.equipment} onChange={set("equipment")} rows={2} style={textareaStyle} />
        </Field>
        <Field label="Workout schedule">
          <textarea value={profile.workout_days} onChange={set("workout_days")} rows={2} style={textareaStyle} />
        </Field>
      </Card>

      <Card>
        <Label icon={UtensilsCrossed}>Food</Label>
        <Field label="Diet preferences / restrictions">
          <textarea value={profile.diet_prefs} onChange={set("diet_prefs")} rows={2} style={textareaStyle} />
        </Field>
        <Field label="Pantry staples on hand">
          <textarea value={profile.pantry} onChange={set("pantry")} rows={2} style={textareaStyle} />
        </Field>
      </Card>

      <Card accent>
        <Label icon={Plane}>Upcoming disruptions</Label>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", margin: "4px 0 8px" }}>
          The AI adapts these days automatically — hotel gym, no kitchen, travel, etc.
        </div>
        <textarea value={profile.disruptions} onChange={set("disruptions")} rows={2} placeholder="e.g. Traveling Thu–Sat, hotel gym only" style={textareaStyle} />
      </Card>

      <Card>
        <Label icon={Heart}>Apple Health sync</Label>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", margin: "6px 0 12px", lineHeight: 1.5 }}>
          Connect <strong style={{ color: "var(--ink)" }}>Health Auto Export</strong> (free app) to automatically sync your heart rate and calories burned into Cadence every day.
        </div>

        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 600, color: "var(--ink)", marginBottom: 6 }}>
          Step 1 — Copy your personal webhook URL
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <div style={{
            flex: 1, fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)",
            background: "#0c0c0e", border: "1px solid #2a2a2e", borderRadius: 8,
            padding: "8px 10px", wordBreak: "break-all", lineHeight: 1.4,
          }}>
            {webhookUrl ?? "Loading…"}
          </div>
          <button
            onClick={copyUrl}
            disabled={!webhookUrl}
            style={{ ...primaryBtnStyle, padding: "0 14px", flexShrink: 0 }}
          >
            {copied ? <CheckIcon size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>

        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
          Step 2 — Set up Health Auto Export
        </div>
        {[
          'Download "Health Auto Export" from the App Store (free)',
          'Open the app → tap "+" to create a new export',
          "Select metrics: Resting Heart Rate, Heart Rate, Active Energy, Steps",
          "Set format: REST API / Webhook",
          "Paste your URL above into the URL field",
          "Set schedule: Automatic (runs in background daily)",
          "Tap Save — done!",
        ].map((step, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <div style={{
              fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 11,
              color: "var(--accent)", minWidth: 18, paddingTop: 1,
            }}>
              {i + 1}
            </div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
              {step}
            </div>
          </div>
        ))}

        <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)", marginTop: 8, lineHeight: 1.4 }}>
          Once connected, your vitals appear in the Trends tab and Claude uses them to calibrate your calorie targets.
        </div>
      </Card>

      <button onClick={save} disabled={saving} style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center", marginBottom: 24 }}>
        {saved ? "Saved ✓" : saving ? "Saving…" : "Save goals"}
      </button>
    </div>
  );
}

export default function GoalsPage() {
  return (
    <Suspense>
      <GoalsContent />
    </Suspense>
  );
}
