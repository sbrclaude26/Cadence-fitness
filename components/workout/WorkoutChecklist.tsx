"use client";

import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { MiniInput } from "@/components/ui/MiniInput";
import { checkboxStyle, primaryBtnStyle, ghostBtnStyle, inputStyle } from "@/components/ui/styles";
import type { Exercise, WorkoutLog } from "@/lib/types";

interface Props {
  exercises: Exercise[];
  onLog: (entry: Omit<WorkoutLog, "id" | "user_id" | "created_at">) => void;
  date: string;
}

export function WorkoutChecklist({ exercises, onLog, date }: Props) {
  const [rows, setRows] = useState<Record<string, Record<string, string>>>({});
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [showCustom, setShowCustom] = useState(false);
  const [custom, setCustom] = useState({ name: "", sets: "", reps: "", weight: "" });

  const get = (ex: Exercise, field: string, def: string | number | undefined) => {
    const v = rows[ex.name]?.[field];
    return v != null && v !== "" ? v : def ?? "";
  };
  const upd = (ex: Exercise, field: string, val: string) =>
    setRows((r) => ({ ...r, [ex.name]: { ...r[ex.name], [field]: val } }));

  function toggleDone(ex: Exercise) {
    const nowDone = !done[ex.name];
    setDone((d) => ({ ...d, [ex.name]: nowDone }));
    if (nowDone) {
      onLog({
        date,
        exercise_name: ex.name,
        sets: parseInt(String(get(ex, "sets", ex.sets))) || 0,
        reps: parseInt(String(get(ex, "reps", ex.reps))) || 0,
        weight: ex.type === "weight" ? parseFloat(String(get(ex, "weight", ex.suggestedWeight))) || 0 : 0,
        custom: false,
      });
    }
  }

  function logCustom() {
    if (!custom.name) return;
    onLog({
      date,
      exercise_name: custom.name,
      sets: parseInt(custom.sets) || 0,
      reps: parseInt(custom.reps) || 0,
      weight: parseFloat(custom.weight) || 0,
      custom: true,
    });
    setCustom({ name: "", sets: "", reps: "", weight: "" });
    setShowCustom(false);
  }

  const exerciseLabel = (ex: Exercise) => {
    if (ex.type === "time") return ex.detail ?? "";
    if (ex.type === "bodyweight") return `${ex.sets}×${ex.reps} (bodyweight)`;
    const suggest = ex.suggestedWeight != null ? `suggest ${ex.suggestedWeight} lb` : "";
    const last = ex.lastWeight != null ? ` (up from ${ex.lastWeight})` : "";
    return `prescribed ${ex.sets}×${ex.reps} · ${suggest}${last}`;
  };

  return (
    <div style={{ marginTop: 8 }}>
      {exercises.map((ex, i) => {
        const isDone = done[ex.name];
        return (
          <div
            key={i}
            style={{ padding: "10px 0", borderBottom: "1px solid #232327", opacity: isDone ? 0.5 : 1 }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ flex: 1, paddingRight: 8 }}>
                <div
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 14,
                    fontWeight: 600,
                    textDecoration: isDone ? "line-through" : "none",
                  }}
                >
                  {ex.name}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 11.5,
                    color: "var(--accent)",
                    marginTop: 1,
                  }}
                >
                  {exerciseLabel(ex)}
                </div>
              </div>
              <button onClick={() => toggleDone(ex)} style={checkboxStyle(isDone)}>
                {isDone && <Check size={14} />}
              </button>
            </div>

            {!isDone && ex.type !== "time" && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <MiniInput
                  label="sets"
                  def={ex.sets}
                  val={rows[ex.name]?.sets ?? ""}
                  onChange={(v) => upd(ex, "sets", v)}
                />
                <MiniInput
                  label="reps"
                  def={ex.reps}
                  val={rows[ex.name]?.reps ?? ""}
                  onChange={(v) => upd(ex, "reps", v)}
                />
                {ex.type === "weight" && (
                  <MiniInput
                    label="lb"
                    def={ex.suggestedWeight}
                    val={rows[ex.name]?.weight ?? ""}
                    onChange={(v) => upd(ex, "weight", v)}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      {showCustom ? (
        <div style={{ paddingTop: 12 }}>
          <div
            style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", marginBottom: 6 }}
          >
            Did something different? Log it:
          </div>
          <input
            value={custom.name}
            onChange={(e) => setCustom({ ...custom, name: e.target.value })}
            placeholder="Exercise / activity"
            style={{ ...inputStyle, marginBottom: 6 }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <MiniInput label="sets" def="" val={custom.sets} onChange={(v) => setCustom({ ...custom, sets: v })} />
            <MiniInput label="reps" def="" val={custom.reps} onChange={(v) => setCustom({ ...custom, reps: v })} />
            <MiniInput label="lb" def="" val={custom.weight} onChange={(v) => setCustom({ ...custom, weight: v })} />
            <button onClick={logCustom} style={primaryBtnStyle}>Log</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowCustom(true)} style={{ ...ghostBtnStyle, marginTop: 12 }}>
          <Plus size={14} /> Did a different workout
        </button>
      )}
    </div>
  );
}
