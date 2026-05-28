"use client";

import { useEffect, useMemo, useState } from "react";
import { Watch, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { ghostBtnStyle, primaryBtnStyle } from "@/components/ui/styles";

interface AppleWorkout {
  id: string;
  type: string;
  name: string | null;
  duration_min: number | null;
  distance_km: number | null;
  calories: number | null;
  avg_hr: number | null;
  max_hr: number | null;
}

type LinkableKind = "strength" | "cardio";

// Unified "thing you might link to an Apple Watch session." Strength comes from
// workout_logs, cardio (+ holds) from workout_sessions; we treat them the same
// in the UI but route the save to the correct table by `kind`.
interface LinkableItem {
  id: string;
  kind: LinkableKind;
  name: string;
  position_in_session: number | null;
  apple_workout_id: string | null;
}

interface Props {
  userId: string;
  date: string;
  refreshKey?: number;
}

function sessionSummary(s: AppleWorkout): string {
  const bits: string[] = [];
  if (s.duration_min != null) bits.push(`${Math.round(s.duration_min)} min`);
  if (s.calories != null) bits.push(`~${s.calories} cal`);
  if (s.avg_hr != null) bits.push(`avg HR ${s.avg_hr}`);
  if (s.max_hr != null) bits.push(`max HR ${s.max_hr}`);
  if (s.distance_km != null) bits.push(`${s.distance_km.toFixed(2)} km`);
  return bits.join(" · ");
}

export function WatchSessionLinker({ userId, date, refreshKey }: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [sessions, setSessions] = useState<AppleWorkout[]>([]);
  const [items, setItems] = useState<LinkableItem[]>([]);
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [{ data: sessionRows }, { data: logRows }, { data: cardioRows }] = await Promise.all([
        supabase
          .from("apple_workouts")
          .select("id, type, name, duration_min, distance_km, calories, avg_hr, max_hr")
          .eq("user_id", userId)
          .eq("date", date)
          .order("created_at", { ascending: true }),
        supabase
          .from("workout_logs")
          .select("id, exercise_name, position_in_session, apple_workout_id, notes")
          .eq("user_id", userId)
          .eq("date", date)
          .order("position_in_session", { ascending: true, nullsFirst: false }),
        supabase
          .from("workout_sessions")
          .select("id, name, planned_exercise_name, position_in_session, apple_workout_id")
          .eq("user_id", userId)
          .eq("date", date)
          .order("position_in_session", { ascending: true, nullsFirst: false }),
      ]);
      if (cancelled) return;

      const s = (sessionRows ?? []) as AppleWorkout[];

      type LogRow = { id: string; exercise_name: string; position_in_session: number | null; apple_workout_id: string | null; notes: string | null };
      type CardioRow = { id: string; name: string | null; planned_exercise_name: string | null; position_in_session: number | null; apple_workout_id: string | null };

      const strengthItems: LinkableItem[] = ((logRows ?? []) as LogRow[])
        // Skipped exercises live in workout_logs with notes='skipped' but have
        // no actual work attached — exclude from the linker.
        .filter((row) => (row.notes ?? "").toLowerCase().trim() !== "skipped")
        .map((row) => ({
          id: row.id,
          kind: "strength",
          name: row.exercise_name,
          position_in_session: row.position_in_session,
          apple_workout_id: row.apple_workout_id,
        }));

      const cardioItems: LinkableItem[] = ((cardioRows ?? []) as CardioRow[]).map((row) => ({
        id: row.id,
        kind: "cardio",
        name: row.name ?? row.planned_exercise_name ?? "Cardio",
        position_in_session: row.position_in_session,
        apple_workout_id: row.apple_workout_id,
      }));

      const combined = [...strengthItems, ...cardioItems].sort((a, b) => {
        const ap = a.position_in_session ?? Number.MAX_SAFE_INTEGER;
        const bp = b.position_in_session ?? Number.MAX_SAFE_INTEGER;
        return ap - bp;
      });

      setSessions(s);
      setItems(combined);
      setDraft(Object.fromEntries(combined.map((row) => [`${row.kind}:${row.id}`, row.apple_workout_id])));
      setLoaded(true);
    }
    load();
    return () => { cancelled = true; };
  }, [supabase, userId, date, refreshKey]);

  const dirty = useMemo(() => {
    return items.some((row) => (draft[`${row.kind}:${row.id}`] ?? null) !== (row.apple_workout_id ?? null));
  }, [items, draft]);

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const changed = items.filter((row) => (draft[`${row.kind}:${row.id}`] ?? null) !== (row.apple_workout_id ?? null));
      for (const row of changed) {
        const next = draft[`${row.kind}:${row.id}`] ?? null;
        const table = row.kind === "strength" ? "workout_logs" : "workout_sessions";
        const { error } = await supabase
          .from(table)
          .update({ apple_workout_id: next })
          .eq("id", row.id)
          .eq("user_id", userId);
        if (error) {
          alert(`Couldn't save link for ${row.name}: ${error.message}`);
          return;
        }
      }
      setItems((prev) => prev.map((row) => ({ ...row, apple_workout_id: draft[`${row.kind}:${row.id}`] ?? null })));
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;
  if (sessions.length === 0) return null;

  return (
    <Card>
      <Label icon={Watch}>Apple Watch sessions</Label>
      <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
        Link each logged exercise or cardio block to the Apple Watch session it happened during. Session metrics are <strong>shared</strong> across every linked item — not per-exercise.
      </div>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {sessions.map((s) => {
          const linkedHere = items.filter((row) => (draft[`${row.kind}:${row.id}`] ?? null) === s.id);
          return (
            <div key={s.id} style={{ border: "1px solid #2a2a2e", borderRadius: 10, padding: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                  {s.name ?? s.type}
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--accent)" }}>
                  {sessionSummary(s) || "no metrics"}
                </div>
              </div>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                {items.length === 0 && (
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)" }}>
                    No logged exercises or cardio on this date yet.
                  </div>
                )}
                {items.map((row) => {
                  const key = `${row.kind}:${row.id}`;
                  const selectedHere = (draft[key] ?? null) === s.id;
                  const selectedElsewhere = (draft[key] ?? null) !== null && !selectedHere;
                  return (
                    <label
                      key={key}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        cursor: "pointer",
                        opacity: selectedElsewhere ? 0.4 : 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedHere}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [key]: e.target.checked ? s.id : null }))
                        }
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--ink)" }}>
                        {row.name}
                      </span>
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                        {row.kind}
                      </span>
                    </label>
                  );
                })}
              </div>
              {linkedHere.length > 0 && (
                <div style={{ marginTop: 8, fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
                  <Check size={11} /> {linkedHere.length} item{linkedHere.length === 1 ? "" : "s"} share this session's metrics
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={() => setDraft(Object.fromEntries(items.map((row) => [`${row.kind}:${row.id}`, row.apple_workout_id])))}
          disabled={!dirty || saving}
          style={{ ...ghostBtnStyle, opacity: dirty ? 1 : 0.5 }}
        >
          Reset
        </button>
        <button
          onClick={save}
          disabled={!dirty || saving}
          style={{ ...primaryBtnStyle, opacity: dirty ? 1 : 0.5 }}
        >
          {saving ? "Saving…" : "Save links"}
        </button>
      </div>
    </Card>
  );
}
