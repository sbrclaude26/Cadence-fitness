"use client";

import { useEffect, useMemo, useState } from "react";
import { Watch, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { ghostBtnStyle, primaryBtnStyle } from "@/components/ui/styles";

interface WatchSession {
  id: string;
  type: string;
  name: string | null;
  duration_min: number | null;
  distance_km: number | null;
  calories: number | null;
  avg_hr: number | null;
  max_hr: number | null;
}

interface LoggedExercise {
  id: string;
  exercise_name: string;
  position_in_session: number | null;
  workout_session_id: string | null;
}

interface Props {
  userId: string;
  date: string;
  refreshKey?: number;
}

function sessionSummary(s: WatchSession): string {
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
  const [sessions, setSessions] = useState<WatchSession[]>([]);
  const [logs, setLogs] = useState<LoggedExercise[]>([]);
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [{ data: sessionRows }, { data: logRows }] = await Promise.all([
        supabase
          .from("workout_sessions")
          .select("id, type, name, duration_min, distance_km, calories, avg_hr, max_hr, source")
          .eq("user_id", userId)
          .eq("date", date)
          .eq("source", "healthkit")
          .eq("type", "strength")
          .order("created_at", { ascending: true }),
        supabase
          .from("workout_logs")
          .select("id, exercise_name, position_in_session, workout_session_id")
          .eq("user_id", userId)
          .eq("date", date)
          .order("position_in_session", { ascending: true, nullsFirst: false }),
      ]);
      if (cancelled) return;
      const s = (sessionRows ?? []) as WatchSession[];
      const l = (logRows ?? []) as LoggedExercise[];
      setSessions(s);
      setLogs(l);
      setDraft(Object.fromEntries(l.map((row) => [row.id, row.workout_session_id])));
      setLoaded(true);
    }
    load();
    return () => { cancelled = true; };
  }, [supabase, userId, date, refreshKey]);

  const dirty = useMemo(() => {
    return logs.some((row) => (draft[row.id] ?? null) !== (row.workout_session_id ?? null));
  }, [logs, draft]);

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const changed = logs.filter((row) => (draft[row.id] ?? null) !== (row.workout_session_id ?? null));
      // Update each row individually so we surface per-row errors and keep RLS
      // checks simple (each row matched by id + user_id).
      for (const row of changed) {
        const next = draft[row.id] ?? null;
        const { error } = await supabase
          .from("workout_logs")
          .update({ workout_session_id: next })
          .eq("id", row.id)
          .eq("user_id", userId);
        if (error) {
          alert(`Couldn't save link for ${row.exercise_name}: ${error.message}`);
          return;
        }
      }
      setLogs((prev) => prev.map((row) => ({ ...row, workout_session_id: draft[row.id] ?? null })));
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return null;
  if (sessions.length === 0 && logs.length === 0) return null;
  // No Apple Watch sessions to link against — nothing useful to show.
  if (sessions.length === 0) return null;

  return (
    <Card>
      <Label icon={Watch}>Apple Watch sessions</Label>
      <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
        Link each logged exercise to the Apple Watch session it happened during. Session metrics are <strong>shared</strong> across every linked exercise — not per-exercise.
      </div>

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {sessions.map((s) => {
          const linkedHere = logs.filter((row) => (draft[row.id] ?? null) === s.id);
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
                {logs.length === 0 && (
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)" }}>
                    No logged exercises on this date yet.
                  </div>
                )}
                {logs.map((row) => {
                  const selectedHere = (draft[row.id] ?? null) === s.id;
                  const selectedElsewhere = (draft[row.id] ?? null) !== null && !selectedHere;
                  return (
                    <label
                      key={row.id}
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
                          setDraft((d) => ({ ...d, [row.id]: e.target.checked ? s.id : null }))
                        }
                        style={{ accentColor: "var(--accent)" }}
                      />
                      <span style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--ink)" }}>
                        {row.exercise_name}
                      </span>
                    </label>
                  );
                })}
              </div>
              {linkedHere.length > 0 && (
                <div style={{ marginTop: 8, fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
                  <Check size={11} /> {linkedHere.length} exercise{linkedHere.length === 1 ? "" : "s"} share this session's metrics
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={() => setDraft(Object.fromEntries(logs.map((row) => [row.id, row.workout_session_id])))}
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
