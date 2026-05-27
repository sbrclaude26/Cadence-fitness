import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { FoodLibraryEntry, FoodPortion } from "@/lib/types";

// GET /api/foods/search?q=chicken&limit=20
// Returns matches from food_library ranked by trigram similarity + prefix.
// Portions are joined in so the picker can render the unit dropdown without
// a second round-trip.

type DbRow = {
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
  aliases: string[] | null;
  food_portions: Array<{
    unit: string;
    grams_per_unit: number;
    description: string | null;
    is_default: boolean;
  }> | null;
};

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limitParam = parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;

  // Empty query → return a small "popular" slice (alphabetical, no brand)
  // so the dropdown isn't blank when the user first focuses the picker.
  const select = "slug,name,brand,category,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g,source,source_ref,aliases,food_portions(unit,grams_per_unit,description,is_default)";

  // For non-empty queries we over-fetch (up to ~120 candidates) and rerank in
  // memory. Alphabetical Postgres ordering surfaces things like "Babyfood,
  // corn and sweet potatoes" ahead of "Sweet potato, raw"; the in-memory score
  // favors exact matches, name prefixes, short canonical names, and curated
  // entries, while penalizing babyfood/baked-good variants of whole foods.
  let query = supabase.from("food_library").select(select);
  if (q) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    query = query.or(`name.ilike.${like},aliases.cs.{${q.replace(/[{}",\\]/g, "")}}`);
  } else {
    query = query.is("brand", null);
  }
  const fetchLimit = q ? Math.min(120, Math.max(limit * 6, 60)) : limit;
  const { data, error } = await query.order("name", { ascending: true }).limit(fetchLimit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as DbRow[];
  const qLower = q.toLowerCase();
  function score(r: DbRow): number {
    if (!q) return 0;
    const name = r.name.toLowerCase();
    let s = 0;
    if (name === qLower) s += 1000;
    if (name.startsWith(qLower)) s += 500;
    if (name.includes(` ${qLower}`) || name.startsWith(qLower)) s += 200;
    if (name.includes(qLower)) s += 100;
    const aliasMatch = (r.aliases ?? []).some((a) => a.toLowerCase() === qLower);
    if (aliasMatch) s += 250;
    const aliasSubstring = (r.aliases ?? []).some((a) => a.toLowerCase().includes(qLower));
    if (aliasSubstring) s += 60;
    // Strong demotions for category-y prefixes that bury whole-food matches.
    if (name.startsWith("babyfood")) s -= 600;
    else if (name.includes("babyfood")) s -= 300;
    if (name.includes("candies")) s -= 200;
    if (name.includes("formulated bar") && !qLower.includes("bar")) s -= 100;
    // Boost hand-curated entries (they use the canonical short name).
    if (r.source === "curated") s += 300;
    // Prefer concise names — long USDA descriptions are usually a specific prep
    // variant, not the canonical match.
    s -= Math.min(name.length, 80) * 0.6;
    return s;
  }
  const ranked = rows
    .map((r) => ({ r, s: score(r) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.r);

  const entries: FoodLibraryEntry[] = ranked.map((r) => {
    const portions: FoodPortion[] = (r.food_portions ?? []).map((p) => ({
      unit: p.unit,
      grams_per_unit: Number(p.grams_per_unit),
      description: p.description,
      is_default: p.is_default,
    }));
    return {
      slug: r.slug,
      name: r.name,
      brand: r.brand,
      category: r.category,
      calories_per_100g: Number(r.calories_per_100g),
      protein_per_100g: Number(r.protein_per_100g),
      carbs_per_100g: Number(r.carbs_per_100g),
      fat_per_100g: Number(r.fat_per_100g),
      source: r.source,
      source_ref: r.source_ref,
      aliases: r.aliases ?? [],
      portions,
    };
  });

  return NextResponse.json(
    { entries },
    {
      headers: {
        // Library content changes only on reseed; cache for an hour on the
        // browser so repeat queries are instant.
        "Cache-Control": "private, max-age=3600",
      },
    },
  );
}
