"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { findLibraryEntry, useLibrary } from "@/lib/useLibrary";
import type { WorkoutLibraryEntry } from "@/lib/workoutLibrary";

// Rich "What is this?" panel rendered under an exercise row. Surfaces equipment,
// mechanic, primary/secondary muscles, level, prose summary, and a nested
// step-by-step instructions collapse. Used by the picker dropdown (selected
// entry), the today rows, the log rows, and the in-checklist rows.

interface Props {
  // Pass either a resolved library entry directly OR a slug/name pair and we'll
  // look it up via the shared library cache. Passing the entry directly is
  // cheaper when the caller already has it (e.g. ExercisePicker has the full
  // entry on selection).
  entry?: WorkoutLibraryEntry | null;
  slug?: string | null;
  name?: string | null;
  // When `compact` is true, the toggle uses a smaller font (used in checklist
  // rows where vertical space is at a premium). Default is the picker size.
  compact?: boolean;
  indent?: number;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function MetaRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 11,
          fontWeight: 600,
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          width: 92,
          flexShrink: 0,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 12.5,
          color: "var(--ink)",
          flex: 1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

export function ExerciseDetail({ entry: passedEntry, slug, name, compact, indent }: Props) {
  const lib = useLibrary();
  const entry = passedEntry ?? findLibraryEntry(lib, slug, name);
  const [open, setOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);

  if (!entry) return null;

  // Pre-compute the metadata strings so we can detect whether any will render.
  const equipment = entry.equipment ? capitalize(entry.equipment) : null;
  const mechanicBits = [
    entry.mechanic ? capitalize(entry.mechanic) : null,
    entry.force ? capitalize(entry.force) : null,
  ].filter(Boolean);
  const mechanic = mechanicBits.length > 0 ? mechanicBits.join(" · ") : null;
  const primary = entry.primary_muscles.length > 0 ? entry.primary_muscles.map(capitalize).join(", ") : null;
  const secondary = entry.secondary_muscles.length > 0 ? entry.secondary_muscles.map(capitalize).join(", ") : null;
  const level = entry.level ? capitalize(entry.level) : null;
  const summary = entry.summary;
  const description = entry.description;

  // If literally nothing useful exists, render nothing. Should be rare since
  // all seeded rows have at least muscles + equipment.
  if (!equipment && !mechanic && !primary && !secondary && !level && !summary && !description) {
    return null;
  }

  const togglePad = compact ? { fontSize: 11 } : { fontSize: 11.5 };
  const indentPx = indent ?? 18;

  return (
    <div style={{ marginTop: 4, marginLeft: indentPx }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "transparent",
          border: "none",
          color: "var(--accent)",
          fontFamily: "var(--font-body)",
          padding: 0,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
          ...togglePad,
        }}
      >
        {open ? <ChevronUp size={compact ? 11 : 12} /> : <ChevronDown size={compact ? 11 : 12} />} What is this?
      </button>
      {open && (
        <div
          style={{
            marginTop: 6,
            background: "#0e0e10",
            border: "1px solid #232327",
            borderRadius: 8,
            padding: "10px 12px",
          }}
        >
          <MetaRow label="Equipment" value={equipment} />
          <MetaRow label="Mechanic" value={mechanic} />
          <MetaRow label="Primary" value={primary} />
          <MetaRow label="Secondary" value={secondary} />
          <MetaRow label="Level" value={level} />

          {summary && (
            <div
              style={{
                marginTop: 8,
                fontFamily: "var(--font-body)",
                fontSize: 12.5,
                color: "var(--ink)",
                lineHeight: 1.5,
              }}
            >
              {summary}
            </div>
          )}

          {description && (
            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                onClick={() => setInstructionsOpen((v) => !v)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--accent)",
                  fontFamily: "var(--font-body)",
                  fontSize: 11,
                  padding: 0,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  fontWeight: 600,
                }}
              >
                {instructionsOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />} Step-by-step instructions
              </button>
              {instructionsOpen && (
                <div
                  style={{
                    marginTop: 6,
                    fontFamily: "var(--font-body)",
                    fontSize: 12,
                    color: "var(--ink)",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.5,
                  }}
                >
                  {description}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
