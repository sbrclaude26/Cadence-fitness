"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Plus, ChevronDown, ChevronRight, Trash2, GripVertical, Pencil } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MiniInput } from "@/components/ui/MiniInput";
import {
  checkboxStyle,
  primaryBtnStyle,
  ghostBtnStyle,
  inputStyle,
  delBtnStyle,
} from "@/components/ui/styles";
import { ExercisePicker, type ExercisePickerSelection } from "@/components/workout/ExercisePicker";
import { ExerciseDetail } from "@/components/workout/ExerciseDetail";
import type { Exercise, WeightBasis, CardioTarget } from "@/lib/types";

export interface SetEntry {
  set_index: number;
  reps: number;
  weight: number;
  weight_basis: WeightBasis;
  rpe: number | null;
}

export interface CardioActuals {
  duration_min?: number | null;
  avg_hr?: number | null;
  avg_speed_mph?: number | null;
  avg_incline_pct?: number | null;
}

export interface WorkoutLogPayload {
  exercise_name: string;
  date: string;
  custom: boolean;
  library_slug: string | null;
  position_in_session: number;
  kind: "strength" | "cardio";
  sets?: SetEntry[];
  notes?: string | null;
  cardio?: CardioActuals;
  existingId?: string;        // present on edit-and-update
  skipped?: boolean;          // user explicitly couldn't/didn't do it
}

export type LoggedRecord =
  | {
      kind: "strength";
      id: string;
      sets: SetEntry[];
      notes: string | null;
      summary: string;
      skipped?: boolean;
    }
  | {
      kind: "cardio";
      id: string;
      cardio: CardioActuals;
      notes: string | null;
      summary: string;
      skipped?: boolean;
    };

interface Props {
  exercises: Exercise[];
  initialLogged?: Record<string, LoggedRecord>;
  onLog: (entry: WorkoutLogPayload) => Promise<{ id: string } | void>;
  onDelete?: (rec: { kind: "strength" | "cardio"; id: string; name: string }) => Promise<void> | void;
  onReorder?: (orderedNames: string[]) => Promise<void> | void;
  date: string;
}

const RPE_OPTIONS = ["", "6", "7", "7.5", "8", "8.5", "9", "9.5", "10"];

// Simple subjective effort scale for hold-style exercises where RPE feels
// awkward but a feel-rating is still useful for the brain.
const EFFORT_OPTIONS: Array<{ value: string; label: string; rpe: number | null }> = [
  { value: "", label: "—", rpe: null },
  { value: "easy", label: "Easy", rpe: 6 },
  { value: "medium", label: "Medium", rpe: 7.5 },
  { value: "medium_hard", label: "Medium-Hard", rpe: 8.5 },
  { value: "very_hard", label: "Very Hard", rpe: 10 },
];

function effortFromRpe(rpe: number | null | undefined): string {
  if (rpe == null) return "";
  // Reverse-lookup matching threshold
  if (rpe <= 6.5) return "easy";
  if (rpe <= 8) return "medium";
  if (rpe <= 9) return "medium_hard";
  return "very_hard";
}

// We persist effort by appending "Effort: <Label>" to the cardio session's
// notes column (workout_sessions has no dedicated effort field). These two
// helpers strip / re-parse that fragment so the dropdown round-trips on edit.
function parseEffortFromNotes(notes: string | null | undefined): { effort: string; cleanNotes: string } {
  if (!notes) return { effort: "", cleanNotes: "" };
  const m = notes.match(/(?:^|\s·\s)Effort:\s*([A-Za-z- ]+?)\s*$/);
  if (!m) return { effort: "", cleanNotes: notes };
  const label = m[1].trim();
  const opt = EFFORT_OPTIONS.find((e) => e.label.toLowerCase() === label.toLowerCase());
  const cleanNotes = notes.slice(0, notes.length - m[0].length).replace(/\s·\s$/, "").trim();
  return { effort: opt?.value ?? "", cleanNotes };
}

function defaultBasis(ex: Exercise): WeightBasis {
  return ex.weight_basis_default ?? "total";
}

function isCardio(ex: Exercise): boolean {
  return ex.type === "time";
}

// "Simple" cardio = isometric holds, stretches, mobility — anything where
// HR/speed/incline don't apply, only duration + perceived effort. Detect by
// name first; otherwise fall back to "structured cardio_target but no
// intensity ranges (HR/speed/incline)" — that's effectively a hold the AI
// labeled as "time" without intensity targets.
function isSimpleCardio(ex: Exercise): boolean {
  if (!isCardio(ex)) return false;
  if (/\b(plank|hold|hang|isometric|bridge|wall ?sit|stretch|mobility|yoga|foam ?roll|breath)\w*/i.test(ex.name)) return true;
  const t = ex.cardio_target;
  if (!t) return false;
  const hasIntensity = t.hr_min != null || t.hr_max != null
    || t.speed_min != null || t.speed_max != null
    || t.incline_min != null || t.incline_max != null;
  return !hasIntensity;
}

function basisPillStyle(active: boolean): React.CSSProperties {
  return {
    padding: "5px 9px",
    borderRadius: 7,
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.05em",
    textTransform: "uppercase",
    border: "1px solid " + (active ? "var(--accent)" : "#2a2a2e"),
    background: active ? "var(--accent)" : "transparent",
    color: active ? "#140a06" : "var(--muted)",
    cursor: "pointer",
    fontFamily: "var(--font-body)",
  };
}

function selectStyle(): React.CSSProperties {
  return {
    width: "100%",
    background: "#101013",
    border: "1px solid #2a2a2e",
    borderRadius: 10,
    padding: "9px 8px",
    color: "var(--ink)",
    fontSize: 14,
    fontFamily: "var(--font-body)",
    outline: "none",
    boxSizing: "border-box",
    textAlign: "center",
    // textAlignLast is the property that actually centers a <select>'s
    // displayed value in WebKit/Blink; textAlign alone is ignored.
    textAlignLast: "center",
    appearance: "none",
    WebkitAppearance: "none",
  };
}

// Hidden spacer the same height as MiniInput's caption row so non-MiniInput
// controls (basis toggle, trash button) line up vertically when the row uses
// alignItems: "center".
function spacerStyle(): React.CSSProperties {
  return {
    fontSize: 9.5,
    marginTop: 2,
    height: 12,
    visibility: "hidden",
  };
}

function cardioTargetLabel(t: CardioTarget): string {
  const bits: string[] = [];
  if (t.hr_min != null || t.hr_max != null) bits.push(`HR ${t.hr_min ?? "?"}–${t.hr_max ?? "?"}`);
  if (t.speed_min != null || t.speed_max != null) bits.push(`${t.speed_min ?? "?"}–${t.speed_max ?? "?"} mph`);
  if (t.incline_min != null || t.incline_max != null) bits.push(`${t.incline_min ?? "?"}–${t.incline_max ?? "?"}% incline`);
  if (t.duration_min != null) bits.push(`${t.duration_min} min`);
  return bits.join(" · ");
}

function exerciseLabel(ex: Exercise): string {
  if (isCardio(ex)) {
    if (ex.cardio_target) return cardioTargetLabel(ex.cardio_target);
    return ex.detail ?? "";
  }
  if (ex.type === "bodyweight") return `${ex.sets}×${ex.reps} (bodyweight)`;
  const basis = ex.suggestedWeightBasis ?? ex.lastWeightBasis ?? defaultBasis(ex);
  const basisLbl = basis === "per_side" ? "lb/side" : "lb";
  const suggest = ex.suggestedWeight != null ? `suggest ${ex.suggestedWeight} ${basisLbl}` : "";
  const last = ex.lastWeight != null
    ? ` (up from ${ex.lastWeight} ${ex.lastWeightBasis === "per_side" ? "lb/side" : "lb"})`
    : "";
  return `prescribed ${ex.sets}×${ex.reps} · ${suggest}${last}`;
}

interface ExerciseCardProps {
  ex: Exercise;
  position: number;
  logged: LoggedRecord | null;
  isCustom?: boolean;
  onCommit: (payload: WorkoutLogPayload) => Promise<{ id: string } | void>;
  onDelete?: () => Promise<void> | void;
  onClearLogged: () => void;
  date: string;
}

function StrengthCard({ ex, position, logged, isCustom, onCommit, onDelete, date }: ExerciseCardProps) {
  // Default collapsed for both not-logged and logged states.
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const isLogged = logged?.kind === "strength";
  const isSkipped = Boolean(logged?.skipped);

  async function skip() {
    await onCommit({
      exercise_name: ex.name,
      date,
      custom: Boolean(isCustom),
      library_slug: ex.library_slug ?? null,
      position_in_session: position,
      kind: "strength",
      sets: [],
      notes: "skipped",
      skipped: true,
      existingId: logged?.id,
    });
  }

  const initialSets = useMemo<SetEntry[]>(() => {
    if (logged?.kind === "strength" && logged.sets.length > 0) return logged.sets;
    const n = ex.sets && ex.sets > 0 ? ex.sets : 3;
    return Array.from({ length: n }, (_, i) => ({
      set_index: i + 1,
      reps: ex.reps ?? 0,
      weight: ex.type === "weight" ? (ex.suggestedWeight ?? ex.lastWeight ?? 0) : 0,
      weight_basis: ex.suggestedWeightBasis ?? ex.lastWeightBasis ?? defaultBasis(ex),
      rpe: null,
    }));
  }, [ex, logged]);

  const [sets, setSets] = useState<SetEntry[]>(initialSets);
  // Raw text per row, kept separate from numeric `sets` so users can type
  // "42." without the trailing dot being stripped by parseFloat round-trip.
  const [drafts, setDrafts] = useState<Array<{ reps: string; weight: string }>>(
    () => initialSets.map((s) => ({
      reps: s.reps ? String(s.reps) : "",
      weight: s.weight ? String(s.weight) : "",
    })),
  );
  const [saving, setSaving] = useState(false);

  // Re-seed sets + drafts when the logged record arrives/changes (e.g. parent reload).
  useEffect(() => {
    setSets(initialSets);
    setDrafts(initialSets.map((s) => ({
      reps: s.reps ? String(s.reps) : "",
      weight: s.weight ? String(s.weight) : "",
    })));
  }, [initialSets]);

  // After a fresh log, collapse back to summary view.
  useEffect(() => {
    if (isLogged) {
      setEditing(false);
    }
  }, [isLogged]);

  function updateSet(i: number, patch: Partial<SetEntry>) {
    setSets((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function updateReps(i: number, v: string) {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, reps: v } : d)));
    const n = parseInt(v, 10);
    setSets((prev) => prev.map((s, idx) => (idx === i ? { ...s, reps: isNaN(n) ? 0 : n } : s)));
  }

  function updateWeight(i: number, v: string) {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, weight: v } : d)));
    const n = parseFloat(v);
    setSets((prev) => prev.map((s, idx) => (idx === i ? { ...s, weight: isNaN(n) ? 0 : n } : s)));
  }

  function addSet() {
    setSets((prev) => {
      const last = prev[prev.length - 1];
      const next = last
        ? { ...last, set_index: prev.length + 1, rpe: null }
        : {
            set_index: prev.length + 1,
            reps: ex.reps ?? 0,
            weight: ex.suggestedWeight ?? 0,
            weight_basis: defaultBasis(ex),
            rpe: null,
          };
      setDrafts((d) => [
        ...d,
        { reps: next.reps ? String(next.reps) : "", weight: next.weight ? String(next.weight) : "" },
      ]);
      return [...prev, next];
    });
  }

  function removeSet(i: number) {
    setSets((prev) => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, set_index: idx + 1 })));
    setDrafts((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function commit() {
    if (saving) return;
    setSaving(true);
    try {
      await onCommit({
        exercise_name: ex.name,
        date,
        custom: Boolean(isCustom),
        library_slug: ex.library_slug ?? null,
        position_in_session: position,
        kind: "strength",
        sets,
        existingId: logged?.id,
      });
      setExpanded(false);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const showForm = expanded && (!isLogged || editing);
  const showLoggedDetail = expanded && isLogged && !editing;

  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid #232327", opacity: isLogged && !editing ? 0.7 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ flex: 1, paddingRight: 8, background: "transparent", border: "none", textAlign: "left", cursor: "pointer" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {expanded ? (
              <ChevronDown size={14} color="var(--muted)" />
            ) : (
              <ChevronRight size={14} color="var(--muted)" />
            )}
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 14,
                fontWeight: 600,
                color: "var(--ink)",
                textDecoration: isLogged ? "line-through" : "none",
              }}
            >
              {ex.name}
            </div>
          </div>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 11.5,
              color: isSkipped ? "var(--muted)" : "var(--accent)",
              marginTop: 1,
              marginLeft: 18,
              fontStyle: isSkipped ? "italic" : "normal",
            }}
          >
            {isLogged && logged ? (isSkipped ? "Skipped" : logged.summary) : exerciseLabel(ex)}
          </div>
        </button>
        {!isLogged && (
          <button
            onClick={skip}
            title="Couldn't do it"
            style={{ ...ghostBtnStyle, padding: "4px 8px", fontSize: 11, marginRight: 6 }}
          >
            Skip
          </button>
        )}
        <div style={checkboxStyle(isLogged)}>{isLogged && <Check size={14} />}</div>
      </div>

      <ExerciseDetail slug={ex.library_slug ?? null} name={ex.name} compact />

      {showLoggedDetail && logged?.kind === "strength" && (
        <div style={{ marginTop: 10, marginLeft: 18 }}>
          {!isSkipped && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {logged.sets.map((s) => (
                <div
                  key={s.set_index}
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 12.5,
                    color: "var(--ink)",
                  }}
                >
                  <span style={{ color: "var(--muted)", marginRight: 6 }}>#{s.set_index}</span>
                  {s.reps} reps
                  {ex.type === "weight" && (
                    <>
                      {" · "}
                      {s.weight} {s.weight_basis === "per_side" ? "lb/side" : "lb"}
                    </>
                  )}
                  {s.rpe != null && (
                    <>
                      {" · "}
                      <span style={{ color: "var(--muted)" }}>RPE {s.rpe}</span>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setEditing(true)} style={ghostBtnStyle}>
              <Pencil size={13} /> {isSkipped ? "Log instead" : "Edit"}
            </button>
            {!isSkipped && (
              <button onClick={skip} style={ghostBtnStyle}>
                Mark as skipped
              </button>
            )}
            {onDelete && (
              <button onClick={() => onDelete()} style={{ ...ghostBtnStyle, color: "#ff8a6a", borderColor: "#3a2424" }}>
                <Trash2 size={13} /> Delete
              </button>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div style={{ marginTop: 10, marginLeft: 18 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sets.map((s, i) => (
              <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 11,
                    color: "var(--muted)",
                    width: 22,
                  }}
                >
                  #{s.set_index}
                </div>
                <MiniInput
                  label="reps"
                  def={ex.reps ?? ""}
                  val={drafts[i]?.reps ?? ""}
                  onChange={(v) => updateReps(i, v)}
                />
                {ex.type === "weight" && (
                  <>
                    <MiniInput
                      label={s.weight_basis === "per_side" ? "lb/side" : "lb"}
                      def={ex.suggestedWeight ?? ""}
                      val={drafts[i]?.weight ?? ""}
                      onChange={(v) => updateWeight(i, v)}
                    />
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <div style={{ display: "flex", gap: 3 }}>
                        <button
                          type="button"
                          onClick={() => updateSet(i, { weight_basis: "total" })}
                          style={basisPillStyle(s.weight_basis === "total")}
                        >
                          Tot
                        </button>
                        <button
                          type="button"
                          onClick={() => updateSet(i, { weight_basis: "per_side" })}
                          style={basisPillStyle(s.weight_basis === "per_side")}
                        >
                          Side
                        </button>
                      </div>
                      <div style={spacerStyle()}>·</div>
                    </div>
                  </>
                )}
                <div style={{ flex: 0.9 }}>
                  <select
                    value={s.rpe == null ? "" : String(s.rpe)}
                    onChange={(e) => updateSet(i, { rpe: e.target.value === "" ? null : parseFloat(e.target.value) })}
                    style={selectStyle()}
                  >
                    {RPE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt === "" ? "—" : opt}
                      </option>
                    ))}
                  </select>
                  <div
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 9.5,
                      color: "var(--muted)",
                      textAlign: "center",
                      marginTop: 2,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    RPE
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <button onClick={() => removeSet(i)} style={delBtnStyle} aria-label="Remove set">
                    <Trash2 size={14} />
                  </button>
                  <div style={spacerStyle()}>·</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <button onClick={addSet} style={ghostBtnStyle}>
              <Plus size={13} /> Add set
            </button>
            {editing && (
              <button onClick={() => setEditing(false)} style={ghostBtnStyle}>
                Cancel
              </button>
            )}
            <button onClick={skip} style={ghostBtnStyle}>
              Skip instead
            </button>
            <button onClick={commit} disabled={saving} style={primaryBtnStyle}>
              {saving ? "Saving…" : editing ? "Update" : "Log exercise"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CardioCard({ ex, position, logged, isCustom, onCommit, onDelete, date }: ExerciseCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const isLogged = logged?.kind === "cardio";
  const isSkipped = Boolean(logged?.skipped);
  const simple = isSimpleCardio(ex);
  const target = ex.cardio_target ?? null;

  async function skip() {
    await onCommit({
      exercise_name: ex.name,
      date,
      custom: Boolean(isCustom),
      library_slug: ex.library_slug ?? null,
      position_in_session: position,
      kind: "cardio",
      cardio: {},
      notes: "skipped",
      skipped: true,
      existingId: logged?.id,
    });
  }

  const initialActuals = useMemo(() => {
    if (logged?.kind === "cardio") {
      const { effort, cleanNotes } = parseEffortFromNotes(logged.notes);
      return {
        duration: logged.cardio.duration_min != null ? String(logged.cardio.duration_min) : "",
        hr: logged.cardio.avg_hr != null ? String(logged.cardio.avg_hr) : "",
        speed: logged.cardio.avg_speed_mph != null ? String(logged.cardio.avg_speed_mph) : "",
        incline: logged.cardio.avg_incline_pct != null ? String(logged.cardio.avg_incline_pct) : "",
        notes: cleanNotes,
        effort,
      };
    }
    return {
      duration: target?.duration_min != null ? String(target.duration_min) : "",
      hr: "",
      speed: "",
      incline: "",
      notes: "",
      effort: "",
    };
  }, [logged, target]);

  const [actuals, setActuals] = useState(initialActuals);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setActuals(initialActuals);
  }, [initialActuals]);

  useEffect(() => {
    if (isLogged) setEditing(false);
  }, [isLogged]);

  async function commit() {
    if (saving) return;
    setSaving(true);
    try {
      const cardio: CardioActuals = {
        duration_min: actuals.duration ? parseFloat(actuals.duration) : null,
        avg_hr: actuals.hr ? parseFloat(actuals.hr) : null,
        avg_speed_mph: actuals.speed ? parseFloat(actuals.speed) : null,
        avg_incline_pct: actuals.incline ? parseFloat(actuals.incline) : null,
      };
      const effortNote = actuals.effort
        ? EFFORT_OPTIONS.find((e) => e.value === actuals.effort)?.label ?? null
        : null;
      const noteParts = [actuals.notes, effortNote ? `Effort: ${effortNote}` : null].filter(Boolean);
      await onCommit({
        exercise_name: ex.name,
        date,
        custom: Boolean(isCustom),
        library_slug: ex.library_slug ?? null,
        position_in_session: position,
        kind: "cardio",
        cardio,
        notes: noteParts.length > 0 ? noteParts.join(" · ") : null,
        existingId: logged?.id,
      });
      setExpanded(false);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const showForm = expanded && (!isLogged || editing);
  const showLoggedDetail = expanded && isLogged && !editing;

  return (
    <div style={{ padding: "10px 0", borderBottom: "1px solid #232327", opacity: isLogged && !editing ? 0.7 : 1 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{ flex: 1, paddingRight: 8, background: "transparent", border: "none", textAlign: "left", cursor: "pointer" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {expanded ? (
              <ChevronDown size={14} color="var(--muted)" />
            ) : (
              <ChevronRight size={14} color="var(--muted)" />
            )}
            <div
              style={{
                fontFamily: "var(--font-body)",
                fontSize: 14,
                fontWeight: 600,
                color: "var(--ink)",
                textDecoration: isLogged ? "line-through" : "none",
              }}
            >
              {ex.name}
            </div>
          </div>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 11.5,
              color: isSkipped ? "var(--muted)" : "var(--accent)",
              marginTop: 1,
              marginLeft: 18,
              fontStyle: isSkipped ? "italic" : "normal",
            }}
          >
            {isLogged && logged ? (isSkipped ? "Skipped" : logged.summary) : exerciseLabel(ex)}
          </div>
        </button>
        {!isLogged && (
          <button
            onClick={skip}
            title="Couldn't do it"
            style={{ ...ghostBtnStyle, padding: "4px 8px", fontSize: 11, marginRight: 6 }}
          >
            Skip
          </button>
        )}
        <div style={checkboxStyle(isLogged)}>{isLogged && <Check size={14} />}</div>
      </div>

      <ExerciseDetail slug={ex.library_slug ?? null} name={ex.name} compact />

      {showLoggedDetail && logged?.kind === "cardio" && (
        <div style={{ marginTop: 10, marginLeft: 18 }}>
          {!isSkipped && (
            <>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--ink)" }}>
                {logged.summary}
              </div>
              {logged.notes && (
                <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                  {logged.notes}
                </div>
              )}
            </>
          )}
          <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setEditing(true)} style={ghostBtnStyle}>
              <Pencil size={13} /> {isSkipped ? "Log instead" : "Edit"}
            </button>
            {!isSkipped && (
              <button onClick={skip} style={ghostBtnStyle}>
                Mark as skipped
              </button>
            )}
            {onDelete && (
              <button onClick={() => onDelete()} style={{ ...ghostBtnStyle, color: "#ff8a6a", borderColor: "#3a2424" }}>
                <Trash2 size={13} /> Delete
              </button>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <div style={{ marginTop: 10, marginLeft: 18 }}>
          {simple ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <MiniInput
                label="duration (s/min)"
                def={target?.duration_min ?? ""}
                val={actuals.duration}
                onChange={(v) => setActuals((a) => ({ ...a, duration: v }))}
              />
              <div style={{ flex: 1.4 }}>
                <select
                  value={actuals.effort}
                  onChange={(e) => setActuals((a) => ({ ...a, effort: e.target.value }))}
                  style={selectStyle()}
                >
                  {EFFORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <div
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 9.5,
                    color: "var(--muted)",
                    textAlign: "center",
                    marginTop: 2,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  effort
                </div>
              </div>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <MiniInput label="min" def={target?.duration_min ?? ""} val={actuals.duration} onChange={(v) => setActuals((a) => ({ ...a, duration: v }))} />
                <MiniInput label="avg HR" def={target ? `${target.hr_min ?? ""}-${target.hr_max ?? ""}` : ""} val={actuals.hr} onChange={(v) => setActuals((a) => ({ ...a, hr: v }))} />
                <MiniInput label="mph" def={target ? `${target.speed_min ?? ""}-${target.speed_max ?? ""}` : ""} val={actuals.speed} onChange={(v) => setActuals((a) => ({ ...a, speed: v }))} />
                <MiniInput label="incl %" def={target ? `${target.incline_min ?? ""}-${target.incline_max ?? ""}` : ""} val={actuals.incline} onChange={(v) => setActuals((a) => ({ ...a, incline: v }))} />
              </div>
              <div style={{ marginTop: 8 }}>
                <select
                  value={actuals.effort}
                  onChange={(e) => setActuals((a) => ({ ...a, effort: e.target.value }))}
                  style={selectStyle()}
                >
                  {EFFORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.value === "" ? "Effort — optional" : opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <input
            value={actuals.notes}
            onChange={(e) => setActuals((a) => ({ ...a, notes: e.target.value }))}
            placeholder="Notes (optional)"
            style={{ ...inputStyle, marginTop: 8 }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {editing && (
              <button onClick={() => setEditing(false)} style={ghostBtnStyle}>
                Cancel
              </button>
            )}
            <button onClick={skip} style={ghostBtnStyle}>
              Skip instead
            </button>
            <button onClick={commit} disabled={saving} style={primaryBtnStyle}>
              {saving ? "Saving…" : editing ? "Update" : "Log cardio"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SortableExercise({
  ex,
  position,
  logged,
  isCustom,
  onCommit,
  onDelete,
  onClearLogged,
  date,
  draggable,
}: ExerciseCardProps & { draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ex.name });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    background: isDragging ? "#161618" : "transparent",
    borderRadius: isDragging ? 8 : 0,
    position: "relative",
  };
  const CardComponent = isCardio(ex) ? CardioCard : StrengthCard;
  return (
    <div ref={setNodeRef} style={style}>
      <div style={{ position: "relative" }}>
        {draggable && (
          <button
            {...attributes}
            {...listeners}
            aria-label="Drag to reorder"
            style={{
              position: "absolute",
              left: -4,
              top: 14,
              padding: 4,
              background: "transparent",
              border: "none",
              color: "#4a4a52",
              cursor: "grab",
              touchAction: "none",
              zIndex: 2,
            }}
          >
            <GripVertical size={14} />
          </button>
        )}
        <div style={{ paddingLeft: draggable ? 18 : 0 }}>
          <CardComponent
            ex={ex}
            position={position}
            logged={logged}
            isCustom={isCustom}
            onCommit={onCommit}
            onDelete={onDelete}
            onClearLogged={onClearLogged}
            date={date}
          />
        </div>
      </div>
    </div>
  );
}

function buildStrengthSummary(sets: SetEntry[]): string {
  const topRpe = sets.reduce<number | null>(
    (m, s) => (s.rpe == null ? m : Math.max(m ?? 0, s.rpe)),
    null,
  );
  return `${sets.length} sets · top RPE ${topRpe ?? "—"}`;
}

function buildCardioSummary(c: CardioActuals): string {
  const bits = [
    c.duration_min != null ? `${c.duration_min} min` : null,
    c.avg_hr != null ? `HR ${c.avg_hr}` : null,
    c.avg_speed_mph != null ? `${c.avg_speed_mph} mph` : null,
    c.avg_incline_pct != null ? `${c.avg_incline_pct}% incl` : null,
  ].filter(Boolean);
  return bits.length > 0 ? bits.join(" · ") : "logged";
}

export function WorkoutChecklist({ exercises, initialLogged, onLog, onDelete, onReorder, date }: Props) {
  const [loggedByName, setLoggedByName] = useState<Record<string, LoggedRecord>>(initialLogged ?? {});
  const [orderedNames, setOrderedNames] = useState<string[]>(() => exercises.map((e) => e.name));
  const [showCustom, setShowCustom] = useState(false);
  type CustomKind = "lift" | "cardio" | "hold";
  const [customKind, setCustomKind] = useState<CustomKind | null>(null);
  const initialCustom = {
    name: "",
    librarySlug: null as string | null,
    isCustom: false,
    sets: [{ set_index: 1, reps: 0, weight: 0, weight_basis: "total" as WeightBasis, rpe: null as number | null }] as SetEntry[],
    duration: "",
    hr: "",
    speed: "",
    incline: "",
    effort: "",
    notes: "",
  };
  const [custom, setCustom] = useState(initialCustom);
  const [customPick, setCustomPick] = useState<ExercisePickerSelection | null>(null);
  // Per-set raw text for custom-lift inputs, mirrors `custom.sets`. Same
  // trailing-dot fix as StrengthCard so users can type "42.5".
  const [customDrafts, setCustomDrafts] = useState<Array<{ reps: string; weight: string }>>(
    () => [{ reps: "", weight: "" }],
  );
  const [customSaving, setCustomSaving] = useState(false);

  function resetCustom() {
    setCustom(initialCustom);
    setCustomPick(null);
    setCustomDrafts([{ reps: "", weight: "" }]);
    setCustomKind(null);
    setShowCustom(false);
  }

  function applyPick(sel: ExercisePickerSelection) {
    setCustomPick(sel);
    setCustom((c) => ({
      ...c,
      name: sel.name,
      librarySlug: sel.slug,
      isCustom: sel.custom,
    }));
  }

  function updateCustomReps(i: number, v: string) {
    setCustomDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, reps: v } : d)));
    const n = parseInt(v, 10);
    setCustom((c) => ({
      ...c,
      sets: c.sets.map((x, idx) => (idx === i ? { ...x, reps: isNaN(n) ? 0 : n } : x)),
    }));
  }

  function updateCustomWeight(i: number, v: string) {
    setCustomDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, weight: v } : d)));
    const n = parseFloat(v);
    setCustom((c) => ({
      ...c,
      sets: c.sets.map((x, idx) => (idx === i ? { ...x, weight: isNaN(n) ? 0 : n } : x)),
    }));
  }

  // Resync order if the parent plan changes (e.g. after page reload)
  useEffect(() => {
    setOrderedNames(exercises.map((e) => e.name));
  }, [exercises]);

  useEffect(() => {
    if (initialLogged) setLoggedByName(initialLogged);
  }, [initialLogged]);

  const byName = useMemo(() => new Map(exercises.map((e) => [e.name, e])), [exercises]);
  const ordered: Exercise[] = orderedNames
    .map((n) => byName.get(n))
    .filter((e): e is Exercise => Boolean(e));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = orderedNames.indexOf(String(active.id));
    const newIdx = orderedNames.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(orderedNames, oldIdx, newIdx);
    setOrderedNames(next);
    if (onReorder) {
      Promise.resolve(onReorder(next)).catch((e) => {
        console.error("reorder failed", e);
        setOrderedNames(orderedNames);
      });
    }
  }

  async function handleCommit(payload: WorkoutLogPayload) {
    const result = await onLog(payload);
    // Parent returns the new row id; fall back to old id (or empty) if absent.
    const newId = (result && "id" in result ? result.id : null) ?? payload.existingId ?? "";
    const skipped = Boolean(payload.skipped);

    if (payload.kind === "strength") {
      const sets = payload.sets ?? [];
      setLoggedByName((m) => ({
        ...m,
        [payload.exercise_name]: {
          kind: "strength",
          id: newId,
          sets,
          notes: payload.notes ?? null,
          summary: skipped ? "Skipped" : buildStrengthSummary(sets),
          skipped,
        },
      }));
    } else {
      const cardio = payload.cardio ?? {};
      setLoggedByName((m) => ({
        ...m,
        [payload.exercise_name]: {
          kind: "cardio",
          id: newId,
          cardio,
          notes: payload.notes ?? null,
          summary: skipped ? "Skipped" : buildCardioSummary(cardio),
          skipped,
        },
      }));
    }
  }

  async function handleDelete(name: string) {
    const rec = loggedByName[name];
    if (!rec || !onDelete) return;
    await onDelete({ kind: rec.kind, id: rec.id, name });
    setLoggedByName((m) => {
      const next = { ...m };
      delete next[name];
      return next;
    });
  }

  async function commitCustom() {
    if (!custom.name || !customKind || customSaving) return;
    setCustomSaving(true);
    try {
      if (customKind === "lift") {
        await onLog({
          exercise_name: custom.name,
          date,
          custom: custom.isCustom,
          library_slug: custom.librarySlug,
          position_in_session: exercises.length + 1,
          kind: "strength",
          sets: custom.sets,
        });
      } else {
        // cardio + hold both go to workout_sessions
        const cardio: CardioActuals = {
          duration_min: custom.duration ? parseFloat(custom.duration) : null,
          avg_hr: custom.hr ? parseFloat(custom.hr) : null,
          avg_speed_mph: custom.speed ? parseFloat(custom.speed) : null,
          avg_incline_pct: custom.incline ? parseFloat(custom.incline) : null,
        };
        const effortLabel = custom.effort
          ? EFFORT_OPTIONS.find((e) => e.value === custom.effort)?.label ?? null
          : null;
        const noteParts = [custom.notes, effortLabel ? `Effort: ${effortLabel}` : null].filter(Boolean);
        await onLog({
          exercise_name: custom.name,
          date,
          custom: custom.isCustom,
          library_slug: custom.librarySlug,
          position_in_session: exercises.length + 1,
          kind: "cardio",
          cardio,
          notes: noteParts.length > 0 ? noteParts.join(" · ") : null,
        });
      }
      resetCustom();
    } finally {
      setCustomSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 8 }}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={orderedNames} strategy={verticalListSortingStrategy}>
          {ordered.map((ex, i) => (
            <SortableExercise
              key={ex.name}
              ex={ex}
              position={i + 1}
              logged={loggedByName[ex.name] ?? null}
              onCommit={handleCommit}
              onDelete={onDelete ? () => handleDelete(ex.name) : undefined}
              onClearLogged={() => {
                setLoggedByName((m) => {
                  const next = { ...m };
                  delete next[ex.name];
                  return next;
                });
              }}
              date={date}
              draggable={Boolean(onReorder)}
            />
          ))}
        </SortableContext>
      </DndContext>

      {/* Other workouts (not on the planned list) that the athlete logged. */}
      {(() => {
        const customEntries = Object.entries(loggedByName).filter(([name]) => !byName.has(name));
        if (customEntries.length === 0) return null;
        return (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed #2a2a2e" }}>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
              Also logged
            </div>
            {customEntries.map(([name, rec]) => {
              const synthEx: Exercise = rec.kind === "strength"
                ? { name, type: "weight" }
                : { name, type: "time" };
              const Card = rec.kind === "strength" ? StrengthCard : CardioCard;
              return (
                <Card
                  key={name}
                  ex={synthEx}
                  position={exercises.length + 1}
                  logged={rec}
                  isCustom
                  onCommit={handleCommit}
                  onDelete={onDelete ? () => handleDelete(name) : undefined}
                  onClearLogged={() => handleDelete(name)}
                  date={date}
                />
              );
            })}
          </div>
        );
      })()}

      {showCustom ? (
        <div style={{ paddingTop: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)" }}>
              {customKind == null ? "What did you do?" : "Did something different? Log it:"}
            </div>
            <button onClick={resetCustom} style={{ ...ghostBtnStyle, padding: "4px 8px", fontSize: 11 }}>
              Cancel
            </button>
          </div>

          {customKind == null && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => setCustomKind("lift")} style={{ ...ghostBtnStyle, flex: 1 }}>Lift</button>
              <button onClick={() => setCustomKind("cardio")} style={{ ...ghostBtnStyle, flex: 1 }}>Cardio / run</button>
              <button onClick={() => setCustomKind("hold")} style={{ ...ghostBtnStyle, flex: 1 }}>Other</button>
            </div>
          )}

          {customKind != null && (
            <>
              <div style={{ marginBottom: 8 }}>
                <ExercisePicker
                  value={customPick}
                  onChange={applyPick}
                  categoryFilter={
                    customKind === "lift"
                      ? ["strength", "powerlifting", "olympic weightlifting", "strongman"]
                      : customKind === "cardio"
                        ? ["cardio"]
                        : ["stretching", "plyometrics"]
                  }
                  placeholder={
                    customKind === "lift" ? "Search exercise (e.g. Back Squat)"
                    : customKind === "cardio" ? "Search activity (e.g. Treadmill)"
                    : "Search hold (e.g. Plank)"
                  }
                />
              </div>

              {customKind === "lift" && (
                <>
                  {custom.sets.map((s, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)", width: 22 }}>#{s.set_index}</div>
                      <MiniInput label="reps" def="" val={customDrafts[i]?.reps ?? ""} onChange={(v) => updateCustomReps(i, v)} />
                      <MiniInput label={s.weight_basis === "per_side" ? "lb/side" : "lb"} def="" val={customDrafts[i]?.weight ?? ""} onChange={(v) => updateCustomWeight(i, v)} />
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                        <div style={{ display: "flex", gap: 3 }}>
                          <button type="button" onClick={() => setCustom((c) => ({ ...c, sets: c.sets.map((x, idx) => idx === i ? { ...x, weight_basis: "total" } : x) }))} style={basisPillStyle(s.weight_basis === "total")}>Tot</button>
                          <button type="button" onClick={() => setCustom((c) => ({ ...c, sets: c.sets.map((x, idx) => idx === i ? { ...x, weight_basis: "per_side" } : x) }))} style={basisPillStyle(s.weight_basis === "per_side")}>Side</button>
                        </div>
                        <div style={spacerStyle()}>·</div>
                      </div>
                      <div style={{ flex: 0.9 }}>
                        <select
                          value={s.rpe == null ? "" : String(s.rpe)}
                          onChange={(e) => setCustom((c) => ({ ...c, sets: c.sets.map((x, idx) => idx === i ? { ...x, rpe: e.target.value === "" ? null : parseFloat(e.target.value) } : x) }))}
                          style={selectStyle()}
                        >
                          {RPE_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>{opt === "" ? "—" : opt}</option>
                          ))}
                        </select>
                        <div style={{ fontFamily: "var(--font-body)", fontSize: 9.5, color: "var(--muted)", textAlign: "center", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>RPE</div>
                      </div>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => {
                        setCustom((c) => ({
                          ...c,
                          sets: [...c.sets, { ...c.sets[c.sets.length - 1], set_index: c.sets.length + 1, rpe: null }],
                        }));
                        setCustomDrafts((d) => {
                          const last = d[d.length - 1] ?? { reps: "", weight: "" };
                          return [...d, { reps: last.reps, weight: last.weight }];
                        });
                      }}
                      style={ghostBtnStyle}
                    >
                      <Plus size={13} /> Add set
                    </button>
                    <button onClick={commitCustom} disabled={customSaving} style={primaryBtnStyle}>
                      {customSaving ? "Logging…" : "Log"}
                    </button>
                  </div>
                </>
              )}

              {customKind === "cardio" && (
                <>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <MiniInput label="min" def="" val={custom.duration} onChange={(v) => setCustom((c) => ({ ...c, duration: v }))} />
                    <MiniInput label="avg HR" def="" val={custom.hr} onChange={(v) => setCustom((c) => ({ ...c, hr: v }))} />
                    <MiniInput label="mph" def="" val={custom.speed} onChange={(v) => setCustom((c) => ({ ...c, speed: v }))} />
                    <MiniInput label="incl %" def="" val={custom.incline} onChange={(v) => setCustom((c) => ({ ...c, incline: v }))} />
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <select
                      value={custom.effort}
                      onChange={(e) => setCustom((c) => ({ ...c, effort: e.target.value }))}
                      style={selectStyle()}
                    >
                      {EFFORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.value === "" ? "Effort — optional" : opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <input
                    value={custom.notes}
                    onChange={(e) => setCustom((c) => ({ ...c, notes: e.target.value }))}
                    placeholder="Notes (optional)"
                    style={{ ...inputStyle, marginTop: 8 }}
                  />
                  <div style={{ marginTop: 10 }}>
                    <button onClick={commitCustom} disabled={customSaving} style={primaryBtnStyle}>
                      {customSaving ? "Logging…" : "Log"}
                    </button>
                  </div>
                </>
              )}

              {customKind === "hold" && (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <MiniInput label="duration (s/min)" def="" val={custom.duration} onChange={(v) => setCustom((c) => ({ ...c, duration: v }))} />
                    <div style={{ flex: 1.4 }}>
                      <select
                        value={custom.effort}
                        onChange={(e) => setCustom((c) => ({ ...c, effort: e.target.value }))}
                        style={selectStyle()}
                      >
                        {EFFORT_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 9.5, color: "var(--muted)", textAlign: "center", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.05em" }}>effort</div>
                    </div>
                  </div>
                  <input
                    value={custom.notes}
                    onChange={(e) => setCustom((c) => ({ ...c, notes: e.target.value }))}
                    placeholder="Notes (optional)"
                    style={{ ...inputStyle, marginTop: 8 }}
                  />
                  <div style={{ marginTop: 10 }}>
                    <button onClick={commitCustom} disabled={customSaving} style={primaryBtnStyle}>
                      {customSaving ? "Logging…" : "Log"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <button onClick={() => setShowCustom(true)} style={{ ...ghostBtnStyle, marginTop: 12 }}>
          <Plus size={14} /> Did a different workout
        </button>
      )}
    </div>
  );
}
