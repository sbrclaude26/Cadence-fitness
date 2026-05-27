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
