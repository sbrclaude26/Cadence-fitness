// Idempotent seed for public.food_library + public.food_portions.
//
// Reads lib/data/curated-foods.json and upserts every row keyed by slug.
// Portions are replaced per slug (delete-then-insert) so portion edits in
// the JSON file land in the DB on re-run.
//
// Run from cadence-app/:
//   npx tsx scripts/seedFoodLibrary.ts
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the env.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

interface CuratedPortion {
  unit: string;
  grams_per_unit: number;
  description?: string | null;
  is_default?: boolean;
}

interface CuratedFood {
  slug: string;
  name: string;
  brand: string | null;
  category: string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  source: string;
  source_ref: string | null;
  aliases: string[];
  portions: CuratedPortion[];
}

function foodRow(f: CuratedFood) {
  return {
    slug: f.slug,
    name: f.name,
    brand: f.brand,
    category: f.category,
    calories_per_100g: f.calories_per_100g,
    protein_per_100g: f.protein_per_100g,
    carbs_per_100g: f.carbs_per_100g,
    fat_per_100g: f.fat_per_100g,
    source: f.source,
    source_ref: f.source_ref,
    aliases: f.aliases ?? [],
    updated_at: new Date().toISOString(),
  };
}

function portionRows(f: CuratedFood) {
  return f.portions.map((p) => ({
    food_slug: f.slug,
    unit: p.unit,
    grams_per_unit: p.grams_per_unit,
    description: p.description ?? null,
    is_default: p.is_default ?? false,
  }));
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
    process.exit(1);
  }
  const base = url.replace(/\/$/, "");
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  const curatedPath = resolve(process.cwd(), "lib/data/curated-foods.json");
  const curated = JSON.parse(readFileSync(curatedPath, "utf8")) as CuratedFood[];

  // Dedupe by slug (last write wins).
  const bySlug = new Map<string, CuratedFood>();
  for (const f of curated) bySlug.set(f.slug, f);
  const finalFoods = [...bySlug.values()];

  // ── Upsert food_library ──────────────────────────────────────────────────
  const foodRows = finalFoods.map(foodRow);
  const foodEndpoint = `${base}/rest/v1/food_library?on_conflict=slug`;
  const chunkSize = 200;
  for (let i = 0; i < foodRows.length; i += chunkSize) {
    const chunk = foodRows.slice(i, i + chunkSize);
    const res = await fetch(foodEndpoint, {
      method: "POST",
      headers: {
        ...headers,
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("food_library upsert failed at chunk", i, res.status, text);
      process.exit(1);
    }
  }

  // ── Replace food_portions per slug ───────────────────────────────────────
  // Delete first (cascade handled by FK), then insert fresh rows so edits to
  // grams_per_unit / is_default / description land deterministically.
  const slugs = finalFoods.map((f) => f.slug);
  const slugList = slugs.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(",");
  const delRes = await fetch(
    `${base}/rest/v1/food_portions?food_slug=in.(${slugList})`,
    {
      method: "DELETE",
      headers: { ...headers, Prefer: "return=minimal" },
    },
  );
  if (!delRes.ok) {
    const text = await delRes.text();
    console.error("food_portions delete failed", delRes.status, text);
    process.exit(1);
  }

  const allPortions = finalFoods.flatMap(portionRows);
  const portionEndpoint = `${base}/rest/v1/food_portions`;
  for (let i = 0; i < allPortions.length; i += chunkSize) {
    const chunk = allPortions.slice(i, i + chunkSize);
    const res = await fetch(portionEndpoint, {
      method: "POST",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("food_portions insert failed at chunk", i, res.status, text);
      process.exit(1);
    }
  }

  // ── Coverage report ──────────────────────────────────────────────────────
  const byCategory: Record<string, number> = {};
  let branded = 0;
  for (const f of finalFoods) {
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    if (f.brand) branded += 1;
  }

  console.log("Seeded food_library");
  console.log("  Total foods:", finalFoods.length);
  console.log("  Branded:", branded);
  console.log("  Generic:", finalFoods.length - branded);
  console.log("  Total portions:", allPortions.length);
  console.log("  By category:");
  for (const [cat, n] of Object.entries(byCategory).sort()) {
    console.log(`    ${cat}: ${n}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
