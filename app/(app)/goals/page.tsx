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

// Inbound Shortcut endpoints plus the outbound Health export.
type SyncKind = "vitals" | "workouts" | "export";

function GoalsContent() {
  const supabase = createClient();
  const [profile, setProfile] = useState<Omit<Profile, "user_id">>(DEFAULT_PROFILE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [ingestToken, setIngestToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedKind, setCopiedKind] = useState<SyncKind | null>(null);
  const [showExportHelp, setShowExportHelp] = useState(false);

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
    if (!userId || saving) return;
    setSaving(true);
    setSaveError("");
    const { error } = await supabase.from("profiles").upsert({ user_id: userId, ...profile }, { onConflict: "user_id" });
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const daysSinceStart = daysBetween(profile.start_date, todayStr());

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const vitalsUrl = ingestToken ? `${origin}/api/ingest/vitals?token=${ingestToken}` : null;
  const workoutsUrl = ingestToken ? `${origin}/api/ingest/workouts?token=${ingestToken}` : null;
  const exportUrl = ingestToken ? `${origin}/api/export/health?token=${ingestToken}&days=30` : null;

  const urlFor = (kind: SyncKind) =>
    kind === "vitals" ? vitalsUrl : kind === "workouts" ? workoutsUrl : exportUrl;

  async function copyUrl(kind: SyncKind) {
    const url = urlFor(kind);
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopiedKind(kind);
    setCopied(true);
    setTimeout(() => { setCopied(false); setCopiedKind(null); }, 2000);
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
          <input
            value={profile.goal_event_date ?? ""}
            onChange={set("goal_event_date")}
            type="date"
            style={{ ...inputStyle, WebkitAppearance: "none", appearance: "none", display: "block", maxWidth: "100%" }}
          />
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
          <input
            value={profile.start_date}
            onChange={set("start_date")}
            type="date"
            style={{ ...inputStyle, WebkitAppearance: "none", appearance: "none", display: "block", maxWidth: "100%" }}
          />
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
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--muted)", margin: "6px 0 12px", lineHeight: 1.5 }}>
          <strong style={{ color: "var(--ink)" }}>Into Cadence:</strong> endpoints to POST Apple Health data to as JSON.
        </div>

        {([
          { kind: "vitals" as const, label: "Vitals", url: vitalsUrl },
          { kind: "workouts" as const, label: "Workouts", url: workoutsUrl },
        ]).map(({ kind, label, url }) => (
          <div key={kind} style={{ marginBottom: 12 }}>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
              {label}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{
                flex: 1, fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)",
                background: "#0c0c0e", border: "1px solid #2a2a2e", borderRadius: 8,
                padding: "8px 10px", wordBreak: "break-all", lineHeight: 1.4,
              }}>
                {url ?? "Loading…"}
              </div>
              <button
                onClick={() => copyUrl(kind)}
                disabled={!url}
                style={{ ...primaryBtnStyle, padding: "0 14px", flexShrink: 0 }}
              >
                {copied && copiedKind === kind ? <CheckIcon size={14} /> : <Copy size={14} />}
                {copied && copiedKind === kind ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        ))}

        <div style={{ borderTop: "1px solid #2a2a2e", marginTop: 4, paddingTop: 12 }}>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--muted)", marginBottom: 12, lineHeight: 1.5 }}>
            <strong style={{ color: "var(--ink)" }}>Back into Apple Health:</strong> the last 30 days of weight and
            nutrition as JSON, for an iOS Shortcut to write with <em>Log Health Sample</em>. Workouts aren&apos;t
            included — Shortcuts can&apos;t create workout samples.
          </div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>
            Weight &amp; nutrition export
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{
              flex: 1, fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)",
              background: "#0c0c0e", border: "1px solid #2a2a2e", borderRadius: 8,
              padding: "8px 10px", wordBreak: "break-all", lineHeight: 1.4,
            }}>
              {exportUrl ?? "Loading…"}
            </div>
            <button
              onClick={() => copyUrl("export")}
              disabled={!exportUrl}
              style={{ ...primaryBtnStyle, padding: "0 14px", flexShrink: 0 }}
            >
              {copied && copiedKind === "export" ? <CheckIcon size={14} /> : <Copy size={14} />}
              {copied && copiedKind === "export" ? "Copied" : "Copy"}
            </button>
          </div>

          <button
            onClick={() => setShowExportHelp((v) => !v)}
            style={{
              background: "none", border: "none", padding: "10px 0 0", cursor: "pointer",
              fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 700, color: "var(--accent)",
            }}
          >
            {showExportHelp ? "Hide setup steps" : "How do I set this up?"}
          </button>

          {showExportHelp && (
            <ol style={{
              fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--muted)",
              lineHeight: 1.6, margin: "8px 0 0", paddingLeft: 18,
              // The global reset strips list markers; these steps are ordered,
              // so put the numbers back.
              listStyle: "decimal outside",
            }}>
              <li>Copy the URL above.</li>
              <li>In the <strong>Shortcuts</strong> app, create a new shortcut.</li>
              <li>Add <strong>Get Contents of URL</strong> and paste the URL.</li>
              <li>Add <strong>Get Dictionary Value</strong> → key <code>records</code>.</li>
              <li>Add <strong>Repeat with Each</strong>. Inside the loop, add one{" "}
                <strong>Log Health Sample</strong>{" "}per metric you want, taking the value from the
                repeat item&apos;s <code>weightLb</code>, <code>calories</code>, <code>proteinG</code>,
                <code> carbsG</code>, or <code>fatG</code>, and the sample date from <code>date</code>.
                Map them to Weight, Dietary Energy, Protein, Carbohydrates and Total Fat.
              </li>
              <li>Skip days where the value is empty — days you didn&apos;t weigh in come through as null.</li>
              <li>Run it manually, or add a daily Automation so it syncs on its own.</li>
            </ol>
          )}
        </div>
      </Card>

      <button onClick={save} disabled={saving} style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center", marginBottom: saveError ? 8 : 24 }}>
        {saved ? "Saved ✓" : saving ? "Saving…" : "Save goals"}
      </button>
      {saveError && (
        <div style={{ color: "#ff8a6a", fontFamily: "var(--font-body)", fontSize: 13, padding: "0 2px 24px" }}>
          Couldn&apos;t save: {saveError}
        </div>
      )}
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
