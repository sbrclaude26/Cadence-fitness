"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { inputStyle } from "@/components/ui/styles";
import { useFoodSearch } from "@/lib/useFoodSearch";
import type { FoodLibraryEntry } from "@/lib/types";

export interface FoodPickerSelection {
  slug: string | null;
  name: string;
  custom: boolean;
  entry: FoodLibraryEntry | null;
}

interface Props {
  value?: FoodPickerSelection | null;
  onChange: (sel: FoodPickerSelection) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export function FoodPicker({ value, onChange, placeholder, autoFocus }: Props) {
  const [query, setQuery] = useState(value?.name ?? "");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { results, loading } = useFoodSearch(query, { limit: 20 });

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // When the parent passes a fresh value (e.g. when restoring from a saved
  // recipe), keep the input text in sync.
  useEffect(() => {
    setQuery(value?.name ?? "");
  }, [value?.slug, value?.name]);

  const exactMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return results.find((e) => e.name.toLowerCase() === q) ?? null;
  }, [results, query]);

  function commit(entry: FoodLibraryEntry | null, name: string) {
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
      setHighlight((h) => Math.min(h + 1, results.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (results[highlight]) commit(results[highlight], results[highlight].name);
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

  const showCustomOption = query.trim().length > 0 && !exactMatch && !loading;

  return (
    <div ref={containerRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <div style={{ position: "relative" }}>
        <Search
          size={14}
          style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none" }}
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
          placeholder={placeholder ?? "Search foods…"}
          style={{ ...inputStyle, paddingLeft: 28, paddingRight: query ? 28 : 8 }}
          role="combobox"
          aria-expanded={open}
          aria-controls="food-picker-list"
        />
        {query && (
          <button
            onClick={clear}
            aria-label="Clear"
            style={{
              position: "absolute",
              right: 6,
              top: "50%",
              transform: "translateY(-50%)",
              background: "transparent",
              border: "none",
              color: "var(--muted)",
              cursor: "pointer",
              padding: 2,
              display: "flex",
            }}
          >
            <X size={12} />
          </button>
        )}
      </div>

      {open && (
        <div
          id="food-picker-list"
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
          {results.map((entry, i) => (
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
              <div style={{ fontWeight: 600 }}>
                {entry.name}
                {entry.brand && <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6 }}>· {entry.brand}</span>}
              </div>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {Math.round(entry.calories_per_100g)} kcal · {Math.round(entry.protein_per_100g)}P / {Math.round(entry.carbs_per_100g)}C / {Math.round(entry.fat_per_100g)}F per 100g
              </div>
            </button>
          ))}
          {results.length === 0 && !showCustomOption && (
            <div style={{ padding: "10px 12px", color: "var(--muted)", fontSize: 12, fontFamily: "var(--font-body)" }}>
              {loading ? "Searching…" : "No matches."}
            </div>
          )}
          {showCustomOption && (
            <button
              role="option"
              aria-selected={highlight === results.length}
              onMouseEnter={() => setHighlight(results.length)}
              onClick={() => commit(null, query.trim())}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "8px 12px",
                background: highlight === results.length ? "#1c1c20" : "transparent",
                border: "none",
                borderTop: results.length > 0 ? "1px solid #2a2a2e" : "none",
                color: "var(--accent)",
                fontFamily: "var(--font-body)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Use custom: <span style={{ fontWeight: 600 }}>{query.trim()}</span>
              <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                Not in the library — macros will be an AI estimate.
              </div>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
