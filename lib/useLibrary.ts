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
  loading: boolean;
}

function buildIndex(entries: WorkoutLibraryEntry[]): Omit<LibraryIndex, "loading"> {
  return {
    entries,
    bySlug: new Map(entries.map((e) => [e.slug, e])),
    byName: new Map(entries.map((e) => [e.name.toLowerCase(), e])),
  };
}

// React hook returning the library indexed by slug and lowercased name. Until
// the fetch resolves, the maps are empty and `loading` is true — callers can
// gracefully render nothing in the meantime.
export function useLibrary(): LibraryIndex {
  const [state, setState] = useState<LibraryIndex>(() =>
    libraryCache
      ? { ...buildIndex(libraryCache), loading: false }
      : { entries: [], bySlug: new Map(), byName: new Map(), loading: true },
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
