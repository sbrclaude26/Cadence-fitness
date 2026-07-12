"use client";

import { useEffect, useState } from "react";
import type { FoodLibraryEntry } from "@/lib/types";

// Client cache for the user's recent food picks (/api/foods/recents).
// One fetch per page load shared across all mounted FoodPickers; picking a
// food updates the cache optimistically (entry moves to the front) and
// persists via POST in the background, so the Recents section reflects the
// pick immediately without a refetch.

const MAX_RECENTS = 8;

let cached: FoodLibraryEntry[] | null = null;
let inflight: Promise<FoodLibraryEntry[]> | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

async function loadRecents(): Promise<FoodLibraryEntry[]> {
  if (cached) return cached;
  if (!inflight) {
    inflight = fetch(`/api/foods/recents?limit=${MAX_RECENTS}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`recents fetch failed (${res.status})`);
        const json = (await res.json()) as { entries: FoodLibraryEntry[] };
        cached = json.entries;
        notify();
        return cached;
      })
      .catch(() => {
        // Recents are a convenience — fail quiet and act like there are none.
        cached = cached ?? [];
        notify();
        return cached;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

// Record a pick: optimistic move-to-front locally, fire-and-forget persist.
export function recordFoodSelection(entry: FoodLibraryEntry) {
  cached = [entry, ...(cached ?? []).filter((e) => e.slug !== entry.slug)].slice(0, MAX_RECENTS);
  notify();
  void fetch("/api/foods/recents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slug: entry.slug }),
  }).catch(() => {});
}

export function useRecentFoods(): FoodLibraryEntry[] {
  const [recents, setRecents] = useState<FoodLibraryEntry[]>(cached ?? []);

  useEffect(() => {
    const sync = () => setRecents(cached ?? []);
    listeners.add(sync);
    void loadRecents();
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);

  return recents;
}
