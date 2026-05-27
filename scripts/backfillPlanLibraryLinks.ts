// One-time backfill: for every plan in the `plans` table that pre-dates the
// workout library, look up each exercise in `days[].workout.exercises[]` and
// set `library_slug` to the matching entry's slug. Two-pass match:
//   1. Exact name (case-insensitive)
//   2. AI fallback — Claude Haiku maps each unmatched name to the best slug
//      in the library (or null if no good fit). Cheap and robust against
//      variant phrasings like "Barbell Bench Press" → "Bench Press".
// Idempotent: exercises that already have a library_slug are left untouched.
//
// Run from cadence-app/:
//   set -a; source .env.local; set +a
//   npx tsx scripts/backfillPlanLibraryLinks.ts            # dry-run
//   npx tsx scripts/backfillPlanLibraryLinks.ts --write    # actually patch

import Anthropic from "@anthropic-ai/sdk";
import { AI_FAST_MODEL } from "../lib/config";

interface LibraryRow {
  slug: string;
  name: string;
  category: string;
  primary_muscles: string[];
  equipment: string | null;
}

const AI_BATCH_SIZE = 25;

interface PlanRow {
  id: string;
  user_id: string;
  cycle_number: number;
  status: string;
  days: Array<{
    label: string;
    workout: {
      name: string;
      exercises: Array<{
        name: string;
        library_slug?: string | null;
        is_custom?: boolean;
        [k: string]: unknown;
      }>;
    };
  }>;
}

async function fetchLibrary(url: string, key: string): Promise<LibraryRow[]> {
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/workout_library?select=slug,name,category,primary_muscles,equipment`;
  const res = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`fetch library failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as LibraryRow[];
}

async function fetchPlans(url: string, key: string): Promise<PlanRow[]> {
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/plans?select=id,user_id,cycle_number,status,days&order=cycle_number.desc`;
  const res = await fetch(endpoint, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`fetch plans failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as PlanRow[];
}

function buildAiPrompt(names: string[], lib: LibraryRow[]): string {
  // Compact library legend so Haiku can pick a slug without hallucinating.
  const legend = lib.map((e) => ({
    slug: e.slug,
    name: e.name,
    category: e.category,
    equipment: e.equipment,
    primary_muscles: e.primary_muscles,
  }));
  return [
    "You map free-text exercise names from old workout plans onto a canonical exercise library.",
    "",
    "For each NAME below, pick the single best matching slug from the LIBRARY, or null if no entry is a reasonable match.",
    "",
    "Rules:",
    "  • Match the movement, not the wording. \"Barbell Bench Press\", \"BB Bench\", and \"Flat Bench\" all map to bench-press.",
    "  • Variant qualifiers (incline, decline, close-grip, sumo, etc.) must be respected — don't fold them into the plain movement.",
    "  • If no slug clearly fits the intent, return null. Better to leave it unmapped than to mismap.",
    "  • Slugs MUST come from the LIBRARY exactly. Do not invent.",
    "",
    "Return a single JSON object keyed by the input name, value is the slug string or null. Example:",
    `  {"BB Bench": "bench-press", "Barbell Hindu Squat": null}`,
    "",
    "LIBRARY:",
    JSON.stringify(legend),
    "",
    "NAMES:",
    JSON.stringify(names),
  ].join("\n");
}

async function aiMapNames(
  client: Anthropic,
  names: string[],
  lib: LibraryRow[],
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {};
  const validSlugs = new Set(lib.map((e) => e.slug));
  for (let i = 0; i < names.length; i += AI_BATCH_SIZE) {
    const batch = names.slice(i, i + AI_BATCH_SIZE);
    const prompt = buildAiPrompt(batch, lib);
    const res = await client.messages.create({
      model: AI_FAST_MODEL,
      max_tokens: 1500,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.warn(`  ! AI batch ${Math.floor(i / AI_BATCH_SIZE) + 1}: no JSON in response`);
      for (const n of batch) result[n] = null;
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(match[0]) as Record<string, unknown>;
    } catch (err) {
      console.warn(`  ! AI batch ${Math.floor(i / AI_BATCH_SIZE) + 1}: parse failed`, err);
      for (const n of batch) result[n] = null;
      continue;
    }
    for (const n of batch) {
      const v = parsed[n];
      if (typeof v === "string" && validSlugs.has(v)) {
        result[n] = v;
      } else {
        result[n] = null;
      }
    }
    console.log(`  AI batch ${Math.floor(i / AI_BATCH_SIZE) + 1}/${Math.ceil(names.length / AI_BATCH_SIZE)} — mapped ${batch.filter((n) => result[n]).length}/${batch.length}`);
  }
  return result;
}

async function patchPlanDays(url: string, key: string, id: string, days: PlanRow["days"]) {
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/plans?id=eq.${encodeURIComponent(id)}`;
  const res = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ days }),
  });
  if (!res.ok) throw new Error(`patch plan ${id} failed: ${res.status} ${await res.text()}`);
}

async function main() {
  const write = process.argv.includes("--write");
  const skipAi = process.argv.includes("--no-ai");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  if (!skipAi && !apiKey) {
    console.error("Missing ANTHROPIC_API_KEY (pass --no-ai to skip the AI fallback pass).");
    process.exit(1);
  }

  const lib = await fetchLibrary(url, key);
  const byName = new Map<string, string>();
  for (const e of lib) byName.set(e.name.toLowerCase().trim(), e.slug);
  console.log(`Loaded ${lib.length} library entries.`);

  const plans = await fetchPlans(url, key);
  console.log(`Loaded ${plans.length} plans.\n`);

  let totalExercises = 0;
  let totalMapped = 0;
  let totalSkippedAlreadySet = 0;
  let totalUnmatched = 0;
  const unmatchedNames = new Set<string>();
  const plansToWrite: Array<{ id: string; days: PlanRow["days"] }> = [];

  for (const plan of plans) {
    let planChanged = false;
    let mapped = 0;
    let already = 0;
    const unmatchedHere: string[] = [];

    for (const day of plan.days ?? []) {
      for (const ex of day.workout?.exercises ?? []) {
        totalExercises += 1;
        if (ex.library_slug) {
          already += 1;
          totalSkippedAlreadySet += 1;
          continue;
        }
        const slug = byName.get((ex.name ?? "").toLowerCase().trim());
        if (slug) {
          ex.library_slug = slug;
          if (ex.is_custom == null) ex.is_custom = false;
          mapped += 1;
          totalMapped += 1;
          planChanged = true;
        } else {
          unmatchedHere.push(ex.name);
          unmatchedNames.add(ex.name);
          totalUnmatched += 1;
        }
      }
    }

    const status = plan.status.padEnd(8);
    console.log(`Plan ${plan.id.slice(0, 8)}… cycle ${plan.cycle_number} [${status}] — mapped ${mapped}, already-set ${already}, unmatched ${unmatchedHere.length}`);
    if (unmatchedHere.length > 0) {
      const dedup = [...new Set(unmatchedHere)];
      console.log(`  Unmatched here: ${dedup.join(", ")}`);
    }

    if (planChanged) plansToWrite.push({ id: plan.id, days: plan.days });
  }

  // Pass 2 — AI fallback for names that didn't match exactly. Claude Haiku maps
  // each unique unmatched name to a library slug (or null) and we apply the
  // resulting matches back into the in-memory plans before writing.
  let totalAiMapped = 0;
  const aiMisses = new Set<string>();
  if (!skipAi && unmatchedNames.size > 0 && apiKey) {
    const namesArr = [...unmatchedNames].sort();
    console.log(`\nPass 2 (AI): asking Claude Haiku to map ${namesArr.length} unmatched names…`);
    const client = new Anthropic({ apiKey });
    const aiMap = await aiMapNames(client, namesArr, lib);

    for (const plan of plans) {
      let planChanged = plansToWrite.some((p) => p.id === plan.id);
      for (const day of plan.days ?? []) {
        for (const ex of day.workout?.exercises ?? []) {
          if (ex.library_slug) continue;
          const aiSlug = aiMap[ex.name];
          if (aiSlug) {
            ex.library_slug = aiSlug;
            if (ex.is_custom == null) ex.is_custom = false;
            totalAiMapped += 1;
            planChanged = true;
          }
        }
      }
      if (planChanged && !plansToWrite.some((p) => p.id === plan.id)) {
        plansToWrite.push({ id: plan.id, days: plan.days });
      }
    }

    for (const n of namesArr) if (!aiMap[n]) aiMisses.add(n);
    console.log(`AI mapped ${totalAiMapped} exercise(s) across plans; ${aiMisses.size} distinct name(s) still unmatched.`);
  }

  console.log("");
  console.log("── Summary ─────────────────────────────");
  console.log(`Plans scanned       : ${plans.length}`);
  console.log(`Exercises total     : ${totalExercises}`);
  console.log(`Already had slug    : ${totalSkippedAlreadySet}`);
  console.log(`Pass 1 (exact)      : ${totalMapped}`);
  console.log(`Pass 2 (AI)         : ${totalAiMapped}`);
  console.log(`Could NOT match     : ${totalUnmatched - totalAiMapped}`);
  const stillUnmatched = skipAi ? unmatchedNames : aiMisses;
  if (stillUnmatched.size > 0) {
    console.log(`\nDistinct unmatched names (review these — typo? not yet in library?):`);
    for (const n of [...stillUnmatched].sort()) console.log(`  • ${n}`);
  }

  if (!write) {
    console.log("\n(dry-run) Re-run with --write to apply these changes.");
    return;
  }

  console.log(`\nWriting ${plansToWrite.length} plans…`);
  for (const p of plansToWrite) {
    await patchPlanDays(url, key, p.id, p.days);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
