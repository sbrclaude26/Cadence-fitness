// Idempotent seed for public.workout_library.
//
// Reads lib/data/exercises.json (Free Exercise DB) + lib/data/cardioSupplement.json,
// normalizes names, applies the cycle-exercise alias map so common names match
// what the user sees, and upserts every row keyed by slug.
//
// Run from cadence-app/:
//   npx tsx scripts/seedWorkoutLibrary.ts
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env
// (.env.local is picked up by Next.js but not by raw tsx — pass via shell or
// `node --env-file=.env.local`).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toSlug } from "../lib/workoutLibrary";

interface RawEntry {
  name: string;
  force: string | null;
  level: string | null;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions?: string[];
  category: string;
}

// Maps the 21 cycle display names → the canonical Free Exercise DB row name.
// Slug is derived from the DISPLAY name (the left side) so the picker and the
// Brain always speak in the names the athlete is used to.
const CYCLE_ALIASES: Array<{ display: string; sourceName: string }> = [
  { display: "Bench Press",          sourceName: "Barbell Bench Press - Medium Grip" },
  { display: "Overhead Press",       sourceName: "Standing Military Press" },
  { display: "Incline DB Press",     sourceName: "Incline Dumbbell Press" },
  { display: "Triceps Pushdown",     sourceName: "Triceps Pushdown" },
  { display: "Lateral Raise",        sourceName: "Side Lateral Raise" },
  { display: "Push-ups",             sourceName: "Pushups" },
  { display: "Back Squat",           sourceName: "Barbell Full Squat" },
  { display: "Romanian Deadlift",    sourceName: "Romanian Deadlift" },
  { display: "Leg Press",            sourceName: "Leg Press" },
  { display: "Walking Lunges",       sourceName: "Bodyweight Walking Lunge" },
  { display: "Leg Curl",             sourceName: "Lying Leg Curls" },
  { display: "Calf Raise",           sourceName: "Rocking Standing Calf Raise" },
  { display: "Barbell Row",          sourceName: "Bent Over Barbell Row" },
  { display: "Lat Pulldown",         sourceName: "Wide-Grip Lat Pulldown" },
  { display: "Seated Cable Row",     sourceName: "Seated Cable Rows" },
  { display: "Face Pull",            sourceName: "Face Pull" },
  { display: "Biceps Curl",          sourceName: "Barbell Curl" },
  { display: "Pull-ups",             sourceName: "Pullups" },
  { display: "Hanging Knee Raise",   sourceName: "Hanging Leg Raise" },
  { display: "Cable Crunch",         sourceName: "Cable Crunch" },
  { display: "Russian Twist",        sourceName: "Russian Twist" },
];

function flattenDescription(instructions: string[] | undefined): string | null {
  if (!instructions || instructions.length === 0) return null;
  return instructions.map((s) => s.trim()).filter(Boolean).join("\n\n");
}

function rowFromEntry(displayName: string, e: RawEntry) {
  return {
    slug: toSlug(displayName),
    name: displayName,
    category: e.category,
    level: e.level,
    force: e.force,
    mechanic: e.mechanic,
    equipment: e.equipment,
    primary_muscles: e.primaryMuscles ?? [],
    secondary_muscles: e.secondaryMuscles ?? [],
    description: flattenDescription(e.instructions),
    updated_at: new Date().toISOString(),
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
    process.exit(1);
  }
  const dbPath = resolve(process.cwd(), "lib/data/exercises.json");
  const cardioPath = resolve(process.cwd(), "lib/data/cardioSupplement.json");
  const dbRaw = JSON.parse(readFileSync(dbPath, "utf8")) as RawEntry[];
  const cardioRaw = JSON.parse(readFileSync(cardioPath, "utf8")) as RawEntry[];

  // Build a name → entry index for the DB so the alias map can find rows fast.
  const byName = new Map<string, RawEntry>();
  for (const e of dbRaw) byName.set(e.name, e);

  // Track which DB rows are claimed by an alias so we don't double-seed them.
  // The alias display name wins (it's what the user already sees); the
  // original sourceName row is replaced rather than added separately.
  const claimedSourceNames = new Set<string>();
  const rows: ReturnType<typeof rowFromEntry>[] = [];
  const aliasReport: Array<{ display: string; sourceName: string; matched: boolean }> = [];

  for (const a of CYCLE_ALIASES) {
    const src = byName.get(a.sourceName);
    if (!src) {
      aliasReport.push({ ...a, matched: false });
      continue;
    }
    rows.push(rowFromEntry(a.display, src));
    claimedSourceNames.add(a.sourceName);
    aliasReport.push({ ...a, matched: true });
  }

  for (const e of dbRaw) {
    if (claimedSourceNames.has(e.name)) continue;
    rows.push(rowFromEntry(e.name, e));
  }

  for (const e of cardioRaw) {
    rows.push(rowFromEntry(e.name, e));
  }

  // Dedupe by slug — last write wins. Cycle aliases were pushed first so any
  // later collision (extremely unlikely) gets overridden by the alias row.
  const bySlug = new Map<string, ReturnType<typeof rowFromEntry>>();
  for (const r of rows) bySlug.set(r.slug, r);
  const finalRows = [...bySlug.values()];

  // Upsert in chunks via PostgREST. We avoid @supabase/supabase-js here because
  // its Realtime client requires a WebSocket impl that Node <22 doesn't ship.
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/workout_library?on_conflict=slug`;
  const chunkSize = 200;
  for (let i = 0; i < finalRows.length; i += chunkSize) {
    const chunk = finalRows.slice(i, i + chunkSize);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("Upsert failed at chunk", i, res.status, text);
      process.exit(1);
    }
  }

  // ── Coverage report ───────────────────────────────────────────────────────
  const byCategory: Record<string, number> = {};
  let withDesc = 0;
  for (const r of finalRows) {
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    if (r.description) withDesc += 1;
  }

  console.log("Seeded workout_library");
  console.log("  Total rows:", finalRows.length);
  console.log("  With description:", withDesc, "/", finalRows.length);
  console.log("  By category:");
  for (const [cat, n] of Object.entries(byCategory).sort()) {
    console.log(`    ${cat}: ${n}`);
  }

  const missing = aliasReport.filter((r) => !r.matched);
  if (missing.length > 0) {
    console.log("\nWARNING — cycle aliases that did not match a DB row:");
    for (const m of missing) {
      console.log(`  ${m.display}  (looked for "${m.sourceName}")`);
    }
  } else {
    console.log("\nAll", aliasReport.length, "cycle aliases mapped cleanly.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
