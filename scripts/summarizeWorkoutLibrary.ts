// One-time fill of workout_library.summary using Claude Haiku 4.5. Reads every
// row missing a summary, batches them, asks Claude for a 2-3 sentence prose
// overview per entry, and writes back. Idempotent: rows that already have a
// summary are skipped, so re-running is cheap and resumable on failure.
//
// Run from cadence-app/:
//   set -a; source .env.local; set +a
//   npx tsx scripts/summarizeWorkoutLibrary.ts
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + ANTHROPIC_API_KEY.

import Anthropic from "@anthropic-ai/sdk";
import { AI_FAST_MODEL } from "../lib/config";

interface LibraryRow {
  slug: string;
  name: string;
  category: string;
  level: string | null;
  force: string | null;
  mechanic: string | null;
  equipment: string | null;
  primary_muscles: string[];
  secondary_muscles: string[];
  description: string | null;
  summary: string | null;
}

const BATCH_SIZE = 8;

async function fetchRowsNeedingSummary(url: string, key: string): Promise<LibraryRow[]> {
  // PostgREST `is.null` filter pulls only rows that still need a summary so
  // re-runs after a partial failure pick up where we left off.
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/workout_library`
    + `?select=slug,name,category,level,force,mechanic,equipment,primary_muscles,secondary_muscles,description,summary`
    + `&summary=is.null`
    + `&order=name.asc`;
  const res = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    throw new Error(`fetch rows failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as LibraryRow[];
}

async function writeSummaries(url: string, key: string, updates: Array<{ slug: string; summary: string }>) {
  // PATCH per row — we're updating existing rows so upsert/insert isn't right.
  // Parallelize the small batch for speed; PostgREST handles concurrent updates fine.
  const base = `${url.replace(/\/$/, "")}/rest/v1/workout_library`;
  await Promise.all(updates.map(async (u) => {
    const res = await fetch(`${base}?slug=eq.${encodeURIComponent(u.slug)}`, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ summary: u.summary }),
    });
    if (!res.ok) {
      throw new Error(`PATCH ${u.slug} failed: ${res.status} ${await res.text()}`);
    }
  }));
}

function buildPrompt(batch: LibraryRow[]): string {
  const entries = batch.map((r) => ({
    slug: r.slug,
    name: r.name,
    category: r.category,
    equipment: r.equipment,
    mechanic: r.mechanic,
    level: r.level,
    force: r.force,
    primary_muscles: r.primary_muscles,
    secondary_muscles: r.secondary_muscles,
    instructions: r.description,
  }));
  return [
    "You are writing short, plain-English overviews of strength and cardio exercises for an athlete-facing fitness app.",
    "",
    "For each exercise below, write a 2-3 sentence SUMMARY explaining:",
    "  • what the movement is (in one sentence a beginner would understand)",
    "  • which muscles or system it primarily trains",
    "  • why an athlete would do it (one short clause is fine)",
    "",
    "Rules:",
    "  • 2-3 sentences. Never more. Plain English, no jargon the average gym-goer wouldn't know.",
    "  • Do NOT restate the exercise name in the summary.",
    "  • Do NOT list step-by-step instructions — the user has those separately.",
    "  • Do NOT mention sets/reps/weight prescriptions.",
    "  • Use the muscle and equipment fields to be specific. E.g. 'targets the chest with secondary work for triceps and front delts'.",
    "",
    "Return a JSON object keyed by slug, with the summary as the value. Example:",
    `  {"bench-press": "A horizontal pressing movement done lying on a bench... Builds chest strength and size while working the triceps and front delts as supporting muscles."}`,
    "",
    "Exercises:",
    JSON.stringify(entries, null, 2),
  ].join("\n");
}

async function summarizeBatch(client: Anthropic, batch: LibraryRow[]): Promise<Record<string, string>> {
  const prompt = buildPrompt(batch);
  const res = await client.messages.create({
    model: AI_FAST_MODEL,
    max_tokens: 1500,
    temperature: 0.3,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("\n");
  // Pull the JSON object out — sometimes the model wraps it in markdown fences.
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`no JSON in response: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(match[0]) as Record<string, string>;
  return parsed;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  if (!apiKey) {
    console.error("Missing ANTHROPIC_API_KEY.");
    process.exit(1);
  }
  const client = new Anthropic({ apiKey });

  const rows = await fetchRowsNeedingSummary(url, key);
  console.log(`Found ${rows.length} rows missing a summary.`);
  if (rows.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let done = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      const summaries = await summarizeBatch(client, batch);
      const updates: Array<{ slug: string; summary: string }> = [];
      for (const r of batch) {
        const s = summaries[r.slug];
        if (typeof s === "string" && s.trim().length > 0) {
          updates.push({ slug: r.slug, summary: s.trim() });
        } else {
          console.warn(`  ! no summary returned for ${r.slug} (${r.name})`);
          failed += 1;
        }
      }
      if (updates.length > 0) {
        await writeSummaries(url, key, updates);
        done += updates.length;
      }
      console.log(`  batch ${Math.floor(i / BATCH_SIZE) + 1} — wrote ${updates.length}/${batch.length}, total ${done}/${rows.length}`);
    } catch (err) {
      console.error(`  ! batch starting at ${i} failed:`, err);
      failed += batch.length;
    }
  }

  console.log(`\nDone. Wrote ${done} summaries. Failed: ${failed}.`);
  if (failed > 0) {
    console.log("Re-run the script to retry failed entries (idempotent — skips rows that already have a summary).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
