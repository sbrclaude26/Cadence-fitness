"use client";

import { useEffect, useMemo, useState } from "react";
import { Watch, Check, ChevronDown, ChevronRight } from "lucide-react";
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

// One row per exercise_name collapsing duplicate workout_logs/sessions for the
// same exercise on the same day — including dupes that span both tables (a
// strength stub in workout_logs + the real entry in workout_sessions). The
// checkbox acts on the whole group; save fans out to both tables.
interface LinkGroup {
  key: string;
  name: string;
  kinds: LinkableKind[];
  position: number | null;
  strengthIds: string[];
  cardioIds: string[];
  currentLink: string | null;
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
  const [groups, setGroups] = useState<LinkGroup[]>([]);
  const [draft, setDraft] = useState<Record<string, string | null>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
      type Item = { id: string; kind: LinkableKind; name: string; position: number | null; apple_workout_id: string | null };

      const items: Item[] = [
        ...((logRows ?? []) as LogRow[])
          // Skipped exercises live in workout_logs with notes='skipped' but have
          // no actual work attached — exclude from the linker.
          .filter((row) => (row.notes ?? "").toLowerCase().trim() !== "skipped")
          .map((row) => ({
            id: row.id,
            kind: "strength" as const,
            name: row.exercise_name,
            position: row.position_in_session,
            apple_workout_id: row.apple_workout_id,
          })),
        ...((cardioRows ?? []) as CardioRow[]).map((row) => ({
          id: row.id,
          kind: "cardio" as const,
          name: row.name ?? row.planned_exercise_name ?? "Cardio",
          position: row.position_in_session,
          apple_workout_id: row.apple_workout_id,
        })),
      ];

      // Collapse rows by name (across kinds). Same exercise can have stubs in
      // workout_logs AND a real entry in workout_sessions — show one checkbox.
      const byKey = new Map<string, LinkGroup>();
      for (const it of items) {
        const key = it.name;
        const existing = byKey.get(key);
        if (existing) {
          if (it.kind === "strength") existing.strengthIds.push(it.id);
          else existing.cardioIds.push(it.id);
          if (!existing.kinds.includes(it.kind)) existing.kinds.push(it.kind);
          if (existing.position == null || (it.position != null && it.position < existing.position)) {
            existing.position = it.position;
          }
          if (existing.currentLink == null && it.apple_workout_id != null) {
            existing.currentLink = it.apple_workout_id;
          }
        } else {
          byKey.set(key, {
            key,
            name: it.name,
            kinds: [it.kind],
            position: it.position,
            strengthIds: it.kind === "strength" ? [it.id] : [],
            cardioIds: it.kind === "cardio" ? [it.id] : [],
            currentLink: it.apple_workout_id,
          });
        }
      }
      const combined = Array.from(byKey.values()).sort((a, b) => {
        const ap = a.position ?? Number.MAX_SAFE_INTEGER;
        const bp = b.position ?? Number.MAX_SAFE_INTEGER;
        return ap - bp;
      });

      setSessions(s);
      setGroups(combined);
      setDraft(Object.fromEntries(combined.map((g) => [g.key, g.currentLink])));
      setExpanded({});
      setLoaded(true);
    }
    load();
    return () => { cancelled = true; };
  }, [supabase, userId, date, refreshKey]);

  const dirty = useMemo(() => {
    return groups.some((g) => (draft[g.key] ?? null) !== (g.currentLink ?? null));
  }, [groups, draft]);

  async function save() {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const changed = groups.filter((g) => (draft[g.key] ?? null) !== (g.currentLink ?? null));
      for (const g of changed) {
        const next = draft[g.key] ?? null;
        if (g.strengthIds.length > 0) {
          const { error } = await supabase
            .from("workout_logs")
            .update({ apple_workout_id: next })
            .in("id", g.strengthIds)
            .eq("user_id", userId);
          if (error) { alert(`Couldn't save link for ${g.name}: ${error.message}`); return; }
        }
        if (g.cardioIds.length > 0) {
          const { error } = await supabase
            .from("workout_sessions")
            .update({ apple_workout_id: next })
            .in("id", g.cardioIds)
            .eq("user_id", userId);
          if (error) { alert(`Couldn't save link for ${g.name}: ${error.message}`); return; }
        }
      }
      setGroups((prev) => prev.map((g) => ({ ...g, currentLink: draft[g.key] ?? null })));
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

      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        {sessions.map((s) => {
          const linkedHere = groups.filter((g) => (draft[g.key] ?? null) === s.id);
          const isOpen = expanded[s.id] ?? false;
          const summary = sessionSummary(s) || "no metrics";
          return (
            <div key={s.id} style={{ border: "1px solid #2a2a2e", borderRadius: 10, overflow: "hidden" }}>
              <button
                type="button"
                onClick={() => setExpanded((e) => ({ ...e, [s.id]: !isOpen }))}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 10,
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "var(--ink)",
                }}
              >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                    {s.name ?? s.type}
                  </div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--accent)" }}>
                    {summary}
                  </div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)", display: "flex", alignItems: "center", gap: 4 }}>
                    <Check size={11} /> {linkedHere.length} item{linkedHere.length === 1 ? "" : "s"} linked
                  </div>
                </div>
              </button>

              {isOpen && (
                <div style={{ padding: "0 10px 10px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                  {groups.length === 0 && (
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)" }}>
                      No logged exercises or cardio on this date yet.
                    </div>
                  )}
                  {groups.map((g) => {
                    const selectedHere = (draft[g.key] ?? null) === s.id;
                    const selectedElsewhere = (draft[g.key] ?? null) !== null && !selectedHere;
                    return (
                      <label
                        key={g.key}
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
                            setDraft((d) => ({ ...d, [g.key]: e.target.checked ? s.id : null }))
                          }
                          style={{ accentColor: "var(--accent)" }}
                        />
                        <span style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--ink)" }}>
                          {g.name}
                        </span>
                        <span style={{ fontFamily: "var(--font-body)", fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 0.5 }}>
                          {g.kinds.join(" + ")}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button
          onClick={() => setDraft(Object.fromEntries(groups.map((g) => [g.key, g.currentLink])))}
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
