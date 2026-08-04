"use client";

import { useCallback, useRef, useState } from "react";

// Keeps tab state alive across unmounts so switching tabs paints instantly.
//
// Every tab loads by firing a Promise.all of Supabase queries from a mount
// effect. The App Router unmounts a page when you navigate away, so coming
// back dropped all that state and re-ran the whole fetch — the tab rendered
// empty for as long as the round trip took, every single switch.
//
// The fix is stale-while-revalidate at the state layer rather than a query
// cache: the last value each page held is kept outside React, a remount seeds
// its state from that synchronously (so the first paint already has data), and
// the page's existing load effect still runs and overwrites with fresh data.
// When the cache is empty the behaviour is identical to before.
//
// Deliberately NOT a full query cache: the pages set many independent pieces
// of state from one batched fetch, and rewriting them around a query client
// would have been a much larger change for the same visible result.

const memory = new Map<string, unknown>();

// sessionStorage extends this across a reload and PWA backgrounding, which is
// the other half of the complaint ("re-enter the app"). It is deliberately
// session-scoped rather than localStorage: a fully closed app starts clean, so
// nutrition history isn't left on disk indefinitely.
const STORAGE_PREFIX = "cadence.snap.";

function readPersisted<T>(key: string): T | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_PREFIX + key);
    return raw == null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function persist(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota or a value with cycles — the in-memory copy still works, so a
    // failure here only costs persistence across a reload.
  }
}

/** Drop every snapshot. Called on sign-out so the next account starts clean. */
export function clearSnapshots(): void {
  memory.clear();
  if (typeof window === "undefined") return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const k = window.sessionStorage.key(i);
      if (k?.startsWith(STORAGE_PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => window.sessionStorage.removeItem(k));
  } catch {
    // Nothing to do — memory is already cleared.
  }
}

/**
 * Drop-in replacement for useState whose value survives unmount.
 *
 * `key` must be unique per page + field. The initial value is used only when
 * nothing has been cached yet.
 */
export function useSnapshot<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    if (memory.has(key)) return memory.get(key) as T;
    const persisted = readPersisted<T>(key);
    if (persisted !== undefined) {
      memory.set(key, persisted);
      return persisted;
    }
    return initial;
  });

  // Kept in a ref so the setter identity stays stable across renders — these
  // are called from load effects that would otherwise re-fire.
  const latest = useRef(value);
  latest.current = value;

  const set = useCallback((next: T | ((prev: T) => T)) => {
    const resolved = typeof next === "function"
      ? (next as (prev: T) => T)(latest.current)
      : next;
    latest.current = resolved;
    memory.set(key, resolved);
    persist(key, resolved);
    setValue(resolved);
  }, [key]);

  return [value, set];
}
