"use client";

import { useEffect, useState } from "react";
import type { WorkoutLibraryEntry } from "@/lib/workoutLibrary";

// Single in-memory cache shared across every consumer of the library so the
// picker, the Today rich panel, the Log rich panel, and the checklist all
// reuse one network fetch per page load.
let libraryCache: WorkoutLibraryEntry[] | null = null;
let libraryPromise: Promise<WorkoutLibraryEntry[]> | null = null;

export async function fetchLibrary(): Promise<WorkoutLibraryEntry[]> {
  if (libraryCache) return libraryCache;
  if (libraryPromise) return libraryPromise;
  libraryPromise = (async () => {
    const res = await fetch("/api/library", { cache: "force-cache" });
    if (!res.ok) {
      libraryPromise = null;
      throw new Error(`library fetch failed (${res.status})`);
    }
    const json = (await res.json()) as { entries: WorkoutLibraryEntry[] };
    libraryCache = json.entries;
    return libraryCache;
  })();
  return libraryPromise;
}

export interface LibraryIndex {
  entries: WorkoutLibraryEntry[];
  bySlug: Map<string, WorkoutLibraryEntry>;
  byName: Map<string, WorkoutLibraryEntry>;
  // Normalized-name lookup: lowercased, with leading equipment prefix
  // ("Barbell", "Dumbbell", etc.) stripped and trailing " - Variant" suffix
  // stripped. Lets analytics resolve user-typed names like "Barbell Bench
  // Press" to canonical "Bench Press". Ambiguous keys are only kept when
  // the canonical (unprefixed) entry is present, or when all colliding
  // entries share the same force + primary muscles (so the choice doesn't
  // affect aggregations).
  byNameNorm: Map<string, WorkoutLibraryEntry>;
  loading: boolean;
}

// Aggressive name normalization so user-typed variants map to canonical
// library entries. Order matters — paren-strip and dash-strip must happen
// before whitespace collapse, equipment-prefix strip before pluralization.
function normalizeName(raw: string): string {
  let s = raw.toLowerCase().trim();
  // Strip trailing parenthetical: "Leg Press (Machine)" → "leg press"
  s = s.replace(/\s*\([^)]*\)\s*$/, "");
  // Strip " - Variant" suffix
  const dash = s.indexOf(" - ");
  if (dash > 0) s = s.slice(0, dash);
  // Hyphens between words → spaces ("Bent-Over Row" same as "Bent Over Row")
  s = s.replace(/-/g, " ").replace(/\s+/g, " ").trim();
  // Strip leading equipment word
  s = s.replace(
    /^(barbell|dumbbell|cable|machine|smith machine|kettlebell|bodyweight|ez bar|trap bar|weighted)\s+/,
    "",
  );
  // Informal singular → canonical plural ("tricep" → "triceps", etc.)
  s = s.replace(/\btricep\b/g, "triceps").replace(/\bbicep\b/g, "biceps");
  // Synonym: "rear lunge" is commonly used for what the library calls "reverse lunge".
  s = s.replace(/\brear lunge\b/g, "reverse lunge");
  return s;
}

function buildIndex(entries: WorkoutLibraryEntry[]): Omit<LibraryIndex, "loading"> {
  const byName = new Map<string, WorkoutLibraryEntry>();
  for (const e of entries) byName.set(e.name.toLowerCase(), e);

  // Group entries by normalized key.
  const buckets = new Map<string, WorkoutLibraryEntry[]>();
  for (const e of entries) {
    const k = normalizeName(e.name);
    if (!k) continue;
    if (byName.has(k) && e.name.toLowerCase() !== k) {
      // The normalized key already names a real canonical entry; that one
      // wins. Don't pile prefixed variants into the same bucket.
    }
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(e);
  }

  const byNameNorm = new Map<string, WorkoutLibraryEntry>();
  for (const [k, es] of buckets) {
    if (es.length === 1) {
      byNameNorm.set(k, es[0]);
      continue;
    }
    // Prefer the canonical entry whose name *is* the normalized key.
    const canonical = es.find((e) => e.name.toLowerCase() === k);
    if (canonical) {
      byNameNorm.set(k, canonical);
      continue;
    }
    // Otherwise accept the first only if all colliding entries agree on
    // force + primary muscles — any of them is then a safe proxy for
    // aggregation purposes.
    const firstForce = es[0].force;
    const firstPrim = JSON.stringify([...es[0].primary_muscles].sort());
    const consistent = es.every(
      (e) => e.force === firstForce && JSON.stringify([...e.primary_muscles].sort()) === firstPrim,
    );
    if (consistent) byNameNorm.set(k, es[0]);
  }

  return {
    entries,
    bySlug: new Map(entries.map((e) => [e.slug, e])),
    byName,
    byNameNorm,
  };
}

// React hook returning the library indexed by slug and lowercased name. Until
// the fetch resolves, the maps are empty and `loading` is true — callers can
// gracefully render nothing in the meantime.
export function useLibrary(): LibraryIndex {
  const [state, setState] = useState<LibraryIndex>(() =>
    libraryCache
      ? { ...buildIndex(libraryCache), loading: false }
      : { entries: [], bySlug: new Map(), byName: new Map(), byNameNorm: new Map(), loading: true },
  );

  useEffect(() => {
    if (libraryCache) return;
    let alive = true;
    fetchLibrary()
      .then((entries) => {
        if (!alive) return;
        setState({ ...buildIndex(entries), loading: false });
      })
      .catch((err) => {
        console.error("library hook fetch failed", err);
        if (alive) setState((s) => ({ ...s, loading: false }));
      });
    return () => {
      alive = false;
    };
  }, []);

  return state;
}

// Convenience: look up a single entry by slug first, then by lowercased name.
// Useful when an Exercise carries `library_slug` (preferred) but legacy plan
// entries may only have a name.
export function findLibraryEntry(
  index: Pick<LibraryIndex, "bySlug" | "byName">,
  slug: string | null | undefined,
  name: string | null | undefined,
): WorkoutLibraryEntry | null {
  if (slug) {
    const hit = index.bySlug.get(slug);
    if (hit) return hit;
  }
  if (name) {
    const hit = index.byName.get(name.toLowerCase());
    if (hit) return hit;
  }
  return null;
}
