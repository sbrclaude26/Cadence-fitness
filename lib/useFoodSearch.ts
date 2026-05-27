"use client";

import { useEffect, useRef, useState } from "react";
import type { FoodLibraryEntry } from "@/lib/types";

// Debounced search hook against /api/foods/search. Caches results by query
// in-memory so re-typing the same prefix is instant. Empty query returns
// the popular-slice the API returns (generics, alphabetical).

const cache = new Map<string, FoodLibraryEntry[]>();

async function fetchFoods(q: string, limit: number): Promise<FoodLibraryEntry[]> {
  const key = `${q}|${limit}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const res = await fetch(`/api/foods/search?q=${encodeURIComponent(q)}&limit=${limit}`, {
    cache: "force-cache",
  });
  if (!res.ok) throw new Error(`food search failed (${res.status})`);
  const json = (await res.json()) as { entries: FoodLibraryEntry[] };
  cache.set(key, json.entries);
  return json.entries;
}

export interface FoodSearchState {
  results: FoodLibraryEntry[];
  loading: boolean;
  error: string | null;
}

export function useFoodSearch(query: string, opts: { limit?: number; debounceMs?: number } = {}): FoodSearchState {
  const limit = opts.limit ?? 20;
  const debounceMs = opts.debounceMs ?? 180;
  const [state, setState] = useState<FoodSearchState>({
    results: cache.get(`${query.trim()}|${limit}`) ?? [],
    loading: false,
    error: null,
  });
  const reqId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    const id = ++reqId.current;
    const cached = cache.get(`${q}|${limit}`);
    if (cached) {
      setState({ results: cached, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    const t = setTimeout(() => {
      fetchFoods(q, limit)
        .then((entries) => {
          if (reqId.current !== id) return;
          setState({ results: entries, loading: false, error: null });
        })
        .catch((err: Error) => {
          if (reqId.current !== id) return;
          setState({ results: [], loading: false, error: err.message });
        });
    }, debounceMs);
    return () => clearTimeout(t);
  }, [query, limit, debounceMs]);

  return state;
}
