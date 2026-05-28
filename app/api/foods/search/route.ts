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
    // Match against name | brand | aliases. We also tokenize so "peak protein"
    // hits a row with name="Chocolate Peanut Butter Crunch" and brand="Peak
    // Protein" — the full-string ilike never would. Tokens >= 2 chars only so
    // single-letter noise doesn't blow up the OR list. Cap at 5 tokens to
    // keep the URL bounded.
    // Strip commas/parens from the query before building PostgREST clauses —
    // commas inside an `or=` value are parsed as clause separators and crash
    // the logic tree, which means user queries with commas (or copy-pastes of
    // USDA names) return 500s.
    const sanitized = q.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
    const tokens = sanitized.toLowerCase().split(/\s+/).filter((t) => t.length >= 2).slice(0, 5);
    const fullLike = `%${sanitized}%`;
    // SQL pass narrows on name+brand only. PostgREST won't accept the
    // `aliases::text.ilike.%q%` cast inside an or-tree, so alias substring
    // matching is handled by the in-memory scorer after the over-fetch.
    // For exact-element aliases ("greek yogurt") we still get a fast match
    // via the gin index on the array.
    const aliasExact = sanitized.replace(/[{}",\\]/g, "");
    const clauses = [
      `name.ilike.${fullLike}`,
      `brand.ilike.${fullLike}`,
      `aliases.cs.{${aliasExact}}`,
    ];
    for (const t of tokens) {
      const tokLike = `%${t}%`;
      clauses.push(`name.ilike.${tokLike}`);
      clauses.push(`brand.ilike.${tokLike}`);
    }
    query = query.or(clauses.join(","));
  } else {
    query = query.is("brand", null);
  }
  // Run multiple targeted queries in parallel and union by slug:
  //   1. tight: full query as substring of name|brand (high precision)
  //   2. branded: brand contains EVERY token (catches branded items where the
  //      brand name carries most of the user's typed words, e.g. "peak
  //      protein bar" → brand contains "peak" AND "protein"; we also try
  //      with common product-type words stripped so "bar" doesn't sink it)
  //   3. loose: the big OR (any token in name|brand) for recall
  // The in-memory scorer then ranks across the union. Without the branded
  // pass, alphabetical Postgres ordering on the loose query buried niche
  // brands under hundreds of digit/A/B-prefixed rows containing "protein".
  const TYPE_WORDS = new Set(["bar", "bars", "chip", "chips", "cookie", "cookies", "sauce", "drink", "drinks", "shake", "shakes", "snack", "snacks"]);
  // Commas/parens are PostgREST or-clause separators — strip them everywhere
  // before injecting into a logic tree (otherwise "Chicken breast, raw" 500s).
  const sanitizedQ = q.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
  const allTokens = sanitizedQ.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  const brandTokens = allTokens.filter((t) => !TYPE_WORDS.has(t)).slice(0, 4);

  const tightPromise = q && sanitizedQ
    ? supabase.from("food_library").select(select)
        .or(`name.ilike.%${sanitizedQ}%,brand.ilike.%${sanitizedQ}%`)
        .limit(100)
    : null;

  // Curated-priority pass: tiny set (<200 rows total in DB), so we sweep all
  // of them whose name|aliases match any token. Whole foods like "Chicken
  // breast, raw" otherwise get buried under the 200-row alphabetical OFF
  // window which is dominated by branded items.
  const curatedPromise = q && allTokens.length > 0
    ? (async () => {
        const curOr = allTokens
          .slice(0, 4)
          .flatMap((t) => [`name.ilike.%${t}%`, `aliases.cs.{${t}}`])
          .join(",");
        return await supabase
          .from("food_library")
          .select(select)
          .eq("source", "curated")
          .or(curOr)
          .limit(60);
      })()
    : null;

  const brandedPromise = q && brandTokens.length > 0
    ? (async () => {
        let bq = supabase.from("food_library").select(select);
        for (const t of brandTokens) bq = bq.ilike("brand", `%${t}%`);
        return await bq.limit(60);
      })()
    : null;

  const looseLimit = q ? 200 : limit;
  const loosePromise = query.order("name", { ascending: true }).limit(looseLimit);

  const [looseRes, tightRes, brandedRes, curatedRes] = await Promise.all([
    loosePromise,
    tightPromise ?? Promise.resolve({ data: [], error: null }),
    brandedPromise ?? Promise.resolve({ data: [], error: null }),
    curatedPromise ?? Promise.resolve({ data: [], error: null }),
  ]);
  const error = looseRes.error ?? tightRes.error ?? brandedRes?.error ?? curatedRes?.error;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const merged = new Map<string, unknown>();
  for (const r of (curatedRes?.data ?? []) as Array<{ slug: string }>) merged.set(r.slug, r);
  for (const r of (brandedRes?.data ?? []) as Array<{ slug: string }>) if (!merged.has(r.slug)) merged.set(r.slug, r);
  for (const r of (tightRes?.data ?? []) as Array<{ slug: string }>) if (!merged.has(r.slug)) merged.set(r.slug, r);
  for (const r of (looseRes.data ?? []) as Array<{ slug: string }>) if (!merged.has(r.slug)) merged.set(r.slug, r);
  const data = [...merged.values()];

  const rows = data as unknown as DbRow[];
  const qLower = q.toLowerCase().trim();
  const qTokens = qLower.split(/\s+/).filter((t) => t.length >= 2);
  // Same TYPE_WORDS list as the branded SQL pass — keep in sync.
  const TYPE_WORDS_SCORE = new Set(["bar", "bars", "chip", "chips", "cookie", "cookies", "sauce", "drink", "drinks", "shake", "shakes", "snack", "snacks"]);
  const brandQueryTokens = qTokens.filter((t) => !TYPE_WORDS_SCORE.has(t));
  function score(r: DbRow): number {
    if (!q) return 0;
    const name = r.name.toLowerCase();
    const brand = (r.brand ?? "").toLowerCase();
    const aliasText = (r.aliases ?? []).join(" ").toLowerCase();
    const combined = (brand ? `${brand} ${name}` : name) + " " + aliasText;
    let s = 0;
    if (name === qLower) s += 1000;
    if (combined === qLower) s += 1000;
    // USDA-style canonical names look like "Almonds, raw" or "Sweet potato,
    // raw" — match the base segment before the first comma so single-word
    // queries surface the canonical entry over branded variants with the
    // same single-word name.
    const nameBase = name.split(",")[0].trim();
    if (nameBase === qLower) s += 900;
    if (name.startsWith(qLower)) s += 500;
    if (brand && brand === qLower) s += 700;
    if (brand && brand.startsWith(qLower)) s += 400;
    if (combined.startsWith(qLower)) s += 350;
    if (name.includes(` ${qLower}`)) s += 200;
    if (combined.includes(qLower)) s += 120;
    if (name.includes(qLower)) s += 100;
    // Alias exact matches are strong: curated entries explicitly list the
    // term users will type ("chicken", "egg", "greek yogurt"), so an exact
    // alias hit should outweigh USDA generic name matches.
    const aliasMatch = (r.aliases ?? []).some((a) => a.toLowerCase() === qLower);
    if (aliasMatch) s += 600;
    const aliasSubstring = (r.aliases ?? []).some((a) => a.toLowerCase().includes(qLower));
    if (aliasSubstring) s += 60;
    // Per-token scoring: rows that hit MORE of the query's tokens (in either
    // name or brand) win. This is what lets "peak protein bar" surface a row
    // with name="Chocolate Peanut Butter Crunch" + brand="Peak Protein" — two
    // out of three tokens hit, beating accidental single-token matches.
    let tokenHits = 0;
    for (const t of qTokens) {
      if (combined.includes(t)) tokenHits += 1;
    }
    if (qTokens.length > 0) {
      s += (tokenHits / qTokens.length) * 400;
      if (tokenHits === qTokens.length) s += 200;        // all tokens present
      if (tokenHits === 0) s -= 200;                      // SQL false positive
    }
    // Brand-match bonus: if every non-type-word token from the query appears
    // in this row's brand field, treat it as a strong brand match. This is
    // what lets "peak protein bar" rank Peak Protein items above generic
    // "protein bar" rows. We only fire the big bonus for 2+ brand tokens —
    // for a single-word query like "chicken", a brand named "Chicken Of The
    // Sea" should NOT outrank the generic "Chicken breast, raw".
    if (brand && brandQueryTokens.length >= 2) {
      const brandHits = brandQueryTokens.filter((t) => brand.includes(t)).length;
      if (brandHits === brandQueryTokens.length) s += 800;
      else s += (brandHits / brandQueryTokens.length) * 200;
    }
    // Generic-food preference for single-word queries: when the user types
    // one word and a row has no brand, slight boost so whole-food matches
    // beat branded variants alphabetically.
    if (!brand && qTokens.length === 1) s += 150;
    // Strong demotions for category-y prefixes that bury whole-food matches.
    if (name.startsWith("babyfood")) s -= 600;
    else if (name.includes("babyfood")) s -= 300;
    if (name.includes("candies")) s -= 200;
    if (name.includes("formulated bar") && !qLower.includes("bar")) s -= 100;
    // Boost hand-curated entries (they use the canonical short name).
    if (r.source === "curated") s += 500;
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
