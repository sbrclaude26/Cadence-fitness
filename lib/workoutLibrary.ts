// Canonical exercise library types + helpers.
// The library itself lives in public.workout_library (seeded by
// scripts/seedWorkoutLibrary.ts). The picker reads it via GET /api/library;
// the planner route reads it via the Supabase server client.

export interface WorkoutLibraryEntry {
  slug: string;
  name: string;
  category: string;                   // e.g. "strength" | "cardio" | "stretching" | ...
  level: string | null;               // "beginner" | "intermediate" | "expert" | null
  force: string | null;               // "push" | "pull" | "static" | null
  mechanic: string | null;            // "compound" | "isolation" | null
  equipment: string | null;
  primary_muscles: string[];
  secondary_muscles: string[];
  description: string | null;         // joined instructions; may be null for sparse entries
  summary: string | null;             // 2-3 sentence prose overview; populated by scripts/summarizeWorkoutLibrary.ts
}

// Stable slug derived from display name. Lowercase, ascii-only, dash-separated.
// Re-running the seed must produce the same slug for the same display name.
export function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")    // strip combining diacritics
    .replace(/&/g, " and ")
    .replace(/['"`’]/g, "")             // collapse apostrophes
    .replace(/[^a-z0-9]+/g, "-")        // non-alphanumeric → dash
    .replace(/^-+|-+$/g, "")            // trim leading/trailing dashes
    .replace(/-{2,}/g, "-");
}

// Compact representation injected into the planner prompt. Kept small so
// 800+ entries don't blow the context window — the planner only needs enough
// to choose a slug confidently.
export interface LibraryBriefEntry {
  slug: string;
  name: string;
  category: string;
  equipment: string | null;
  mechanic: string | null;
  level: string | null;
  force: string | null;
  primary_muscles: string[];
  secondary_muscles: string[];
  summary: string | null;
  description: string | null;
}

export function toLibraryBrief(entry: WorkoutLibraryEntry): LibraryBriefEntry {
  return {
    slug: entry.slug,
    name: entry.name,
    category: entry.category,
    equipment: entry.equipment,
    mechanic: entry.mechanic,
    level: entry.level,
    force: entry.force,
    primary_muscles: entry.primary_muscles,
    secondary_muscles: entry.secondary_muscles,
    summary: entry.summary,
    description: entry.description,
  };
}

// Aggressive name normalization so user-typed / Apple-Health variants map to
// canonical library entries. Order matters — paren-strip and dash-strip before
// whitespace collapse, equipment-prefix strip before pluralization. Shared by
// the client library hook (useLibrary) AND the server planner route so the
// brain's volume tagging matches what the Trends tab shows.
export function normalizeExerciseName(raw: string): string {
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

// Build the lowercased-name and normalized-name lookup maps from library
// entries. Ambiguous normalized keys are only kept when the canonical
// (unprefixed) entry is present, or when all colliding entries share the same
// force + primary muscles (so the choice doesn't affect aggregations).
export function buildLibraryNameIndexes(entries: WorkoutLibraryEntry[]): {
  byName: Map<string, WorkoutLibraryEntry>;
  byNameNorm: Map<string, WorkoutLibraryEntry>;
} {
  const byName = new Map<string, WorkoutLibraryEntry>();
  for (const e of entries) byName.set(e.name.toLowerCase(), e);

  const buckets = new Map<string, WorkoutLibraryEntry[]>();
  for (const e of entries) {
    const k = normalizeExerciseName(e.name);
    if (!k) continue;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(e);
  }

  const byNameNorm = new Map<string, WorkoutLibraryEntry>();
  for (const [k, es] of buckets) {
    if (es.length === 1) {
      byNameNorm.set(k, es[0]);
      continue;
    }
    const canonical = es.find((e) => e.name.toLowerCase() === k);
    if (canonical) {
      byNameNorm.set(k, canonical);
      continue;
    }
    const firstForce = es[0].force;
    const firstPrim = JSON.stringify([...es[0].primary_muscles].sort());
    const consistent = es.every(
      (e) => e.force === firstForce && JSON.stringify([...e.primary_muscles].sort()) === firstPrim,
    );
    if (consistent) byNameNorm.set(k, es[0]);
  }

  return { byName, byNameNorm };
}
