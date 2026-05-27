"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { inputStyle } from "@/components/ui/styles";
import { fetchLibrary } from "@/lib/useLibrary";
import { ExerciseDetail } from "@/components/workout/ExerciseDetail";
import type { WorkoutLibraryEntry } from "@/lib/workoutLibrary";

export interface ExercisePickerSelection {
  slug: string | null;            // null when the user picked a custom name
  name: string;
  custom: boolean;
  entry: WorkoutLibraryEntry | null;
}

interface Props {
  value?: ExercisePickerSelection | null;
  onChange: (sel: ExercisePickerSelection) => void;
  categoryFilter?: Array<string>; // e.g. ["strength","powerlifting"] to restrict the list
  placeholder?: string;
  autoFocus?: boolean;
}

function scoreMatch(entry: WorkoutLibraryEntry, q: string): number {
  if (!q) return 0;
  const name = entry.name.toLowerCase();
  if (name === q) return 1000;
  if (name.startsWith(q)) return 500;
  if (name.includes(q)) return 200;
  // Match on primary muscles or equipment as a softer signal.
  for (const m of entry.primary_muscles) if (m.toLowerCase().includes(q)) return 50;
  if (entry.equipment && entry.equipment.toLowerCase().includes(q)) return 25;
  return 0;
}

export function ExercisePicker({ value, onChange, categoryFilter, placeholder, autoFocus }: Props) {
  const [library, setLibrary] = useState<WorkoutLibraryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetchLibrary()
      .then((entries) => {
        if (!alive) return;
        setLibrary(entries);
        setLoading(false);
      })
      .catch((err) => {
        console.error("library fetch failed", err);
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Close on outside click
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const restrict = categoryFilter && categoryFilter.length > 0
      ? library.filter((e) => categoryFilter.includes(e.category))
      : library;
    if (!q) return restrict.slice(0, 50);
    return restrict
      .map((e) => ({ e, s: scoreMatch(e, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map((x) => x.e);
  }, [library, query, categoryFilter]);

  // Exact-name match (case-insensitive) so we don't show "Use custom" when the
  // user typed a real library entry character-for-character.
  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return library.find((e) => e.name.toLowerCase() === q) ?? null;
  }, [library, query]);

  function commit(entry: WorkoutLibraryEntry | null, name: string) {
    onChange({
      slug: entry?.slug ?? null,
      name: entry?.name ?? name,
      custom: !entry,
      entry,
    });
    setQuery(entry?.name ?? name);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, filtered.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlight]) commit(filtered[highlight], filtered[highlight].name);
      else if (query.trim()) commit(null, query.trim());
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function clear() {
    setQuery("");
    onChange({ slug: null, name: "", custom: false, entry: null });
    setOpen(true);
    inputRef.current?.focus();
  }

  const showCustomOption = query.trim().length > 0 && !exactMatch;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div style={{ position: "relative" }}>
        <Search
          size={14}
          style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none" }}
        />
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? (loading ? "Loading library…" : "Search exercises…")}
          style={{ ...inputStyle, paddingLeft: 32, paddingRight: query ? 36 : 12 }}
          role="combobox"
          aria-expanded={open}
          aria-controls="exercise-picker-list"
        />
        {query && (
          <button
            onClick={clear}
            aria-label="Clear"
            style={{
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              padding: 4,
              display: "flex",
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && (
        <div
          id="exercise-picker-list"
          role="listbox"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: 4,
            background: "#101013",
            border: "1px solid #2a2a2e",
            borderRadius: 10,
            maxHeight: 320,
            overflowY: "auto",
            zIndex: 30,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {filtered.map((entry, i) => (
            <button
              key={entry.slug}
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => commit(entry, entry.name)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                background: i === highlight ? "#1c1c20" : "transparent",
                border: "none",
                color: "var(--ink)",
                fontFamily: "var(--font-body)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              <div style={{ fontWeight: 600 }}>{entry.name}</div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {entry.category}
                {entry.equipment ? ` · ${entry.equipment}` : ""}
                {entry.primary_muscles.length > 0 ? ` · ${entry.primary_muscles.join(", ")}` : ""}
              </div>
            </button>
          ))}
          {filtered.length === 0 && !showCustomOption && (
            <div style={{ padding: "10px 12px", color: "var(--muted)", fontSize: 12, fontFamily: "var(--font-body)" }}>
              {loading ? "Loading library…" : "No matches."}
            </div>
          )}
          {showCustomOption && (
            <button
              role="option"
              aria-selected={highlight === filtered.length}
              onMouseEnter={() => setHighlight(filtered.length)}
              onClick={() => commit(null, query.trim())}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                background: highlight === filtered.length ? "#1c1c20" : "transparent",
                border: "none",
                borderTop: filtered.length > 0 ? "1px solid #2a2a2e" : "none",
                color: "var(--accent)",
                fontFamily: "var(--font-body)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Use custom: <span style={{ fontWeight: 600 }}>{query.trim()}</span>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                Not in the library — saved as custom.
              </div>
            </button>
          )}
        </div>
      )}

      {value?.entry && (
        <ExerciseDetail entry={value.entry} indent={0} />
      )}
    </div>
  );
}
