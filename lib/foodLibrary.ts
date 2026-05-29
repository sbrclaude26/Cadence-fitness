// Canonical food library types + helpers.
// The library itself lives in public.food_library + public.food_portions
// (seeded by scripts/seedFoodLibrary.ts). The picker reads it via
// GET /api/foods/search; the planner route reads it via the Supabase server
// client.

import type {
  FoodLibraryEntry,
  FoodPortion,
  Ingredient,
  IngredientMacros,
} from "@/lib/types";

// Stable slug derived from "brand name" — lowercase, ascii-only, dash-separated.
// Re-running the seed must produce the same slug for the same display name.
export function toFoodSlug(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")    // strip combining diacritics
    .replace(/&/g, " and ")
    .replace(/['"`’%]/g, "")            // collapse apostrophes / percent signs
    .replace(/[^a-z0-9]+/g, "-")        // non-alphanumeric → dash
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

// Compact representation injected into the planner prompt. Kept small so
// hundreds of entries don't blow the context window.
export interface FoodBriefEntry {
  slug: string;
  name: string;
  brand: string | null;
  category: string;
  per100g: { calories: number; protein: number; carbs: number; fat: number };
  portions: Array<{ unit: string; grams_per_unit: number }>;
}

export function toFoodBrief(entry: FoodLibraryEntry): FoodBriefEntry {
  return {
    slug: entry.slug,
    name: entry.name,
    brand: entry.brand,
    category: entry.category,
    per100g: {
      calories: entry.calories_per_100g,
      protein: entry.protein_per_100g,
      carbs: entry.carbs_per_100g,
      fat: entry.fat_per_100g,
    },
    portions: entry.portions.map((p) => ({ unit: p.unit, grams_per_unit: p.grams_per_unit })),
  };
}

// ─── Unit conversion ──────────────────────────────────────────────────────────

// Grams per unit for units the user can type even if the food has no
// explicit portion row. These are universal conversions (mass) — volumes
// like tbsp/cup/ml are food-specific so they're only used as a fallback
// when the library row is missing portions.
const STATIC_GRAMS_PER_UNIT: Record<string, number> = {
  g: 1,
  oz: 28.3495,
  lb: 453.592,
  ml: 1,            // assumes density ~ water; fine for liquids without portions
};

// Generic volume defaults — applied only when a food has no explicit volume
// portion in the library. These match USDA's median household weights so
// the fallback is reasonable for "1 cup rice" etc., but they're not
// food-specific. The library's own portions always win.
const GENERIC_VOLUME_GRAMS: Record<string, number> = {
  tbsp: 15,
  tsp: 5,
  cup: 240,
  slice: 28,
  piece: 50,
  scoop: 30,
};

export function gramsForPortion(
  entry: FoodLibraryEntry | null | undefined,
  unit: string,
  qty: number,
): number | null {
  if (!isFinite(qty) || qty <= 0) return null;
  const u = unit.trim().toLowerCase();
  if (entry?.portions) {
    const hit = entry.portions.find((p) => p.unit.toLowerCase() === u);
    if (hit) return hit.grams_per_unit * qty;
  }
  if (u in STATIC_GRAMS_PER_UNIT) return STATIC_GRAMS_PER_UNIT[u] * qty;
  if (u in GENERIC_VOLUME_GRAMS) return GENERIC_VOLUME_GRAMS[u] * qty;
  return null;
}

// Compute macros for a given portion of a library entry. Returns null when
// the unit can't be resolved to grams (caller should fall back to AI guess).
export function macrosFor(
  entry: FoodLibraryEntry,
  unit: string,
  qty: number,
): IngredientMacros | null {
  const grams = gramsForPortion(entry, unit, qty);
  if (grams === null) return null;
  const factor = grams / 100;
  return {
    calories: round1(entry.calories_per_100g * factor),
    protein: round1(entry.protein_per_100g * factor),
    carbs: round1(entry.carbs_per_100g * factor),
    fat: round1(entry.fat_per_100g * factor),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Sum macros across an ingredient list. Used to derive locked batch totals.
export function sumMacros(ingredients: Ingredient[]): IngredientMacros {
  const acc: IngredientMacros = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const ing of ingredients) {
    if (!ing.macros) continue;
    acc.calories += ing.macros.calories;
    acc.protein += ing.macros.protein;
    acc.carbs += ing.macros.carbs;
    acc.fat += ing.macros.fat;
  }
  return {
    calories: round1(acc.calories),
    protein: round1(acc.protein),
    carbs: round1(acc.carbs),
    fat: round1(acc.fat),
  };
}

// ─── Legacy qty string parser ────────────────────────────────────────────────

// Older rows store qty as a single string like "200 g", "1 tbsp", "1 1/2 cup".
// Parse into a numeric qty + unit so the new UI can render them. Falls back
// to qty as-is + a default unit of "g".
const FALLBACK_UNITS = ["g","oz","lb","cup","tbsp","tsp","ml","piece","slice","scoop"];

export function parseLegacyQty(qty: string): { qty: string; unit: string } {
  const s = String(qty ?? "").trim();
  if (!s) return { qty: "", unit: "g" };
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)\s*(.*)$/);
  if (mixed) {
    const num = parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
    const unit = (mixed[4] || "").trim() || "g";
    return { qty: String(num), unit: FALLBACK_UNITS.includes(unit) ? unit : "g" };
  }
  const frac = s.match(/^(\d+)\/(\d+)\s*(.*)$/);
  if (frac) {
    const num = (parseInt(frac[1]) / parseInt(frac[2])).toFixed(2).replace(/\.?0+$/, "");
    const unit = (frac[3] || "").trim() || "g";
    return { qty: num, unit: FALLBACK_UNITS.includes(unit) ? unit : "g" };
  }
  const plain = s.match(/^(\d*\.?\d+)\s*(.*)$/);
  const unit = plain?.[2]?.trim() || "g";
  return { qty: plain?.[1] ?? s, unit: FALLBACK_UNITS.includes(unit) ? unit : "g" };
}

// Adopt structured fields on a legacy Ingredient without losing the original
// `qty` string (so old code that still reads `qty` keeps working).
export function withStructuredQty(ing: Ingredient): Ingredient {
  if (ing.unit !== undefined) return ing;
  const { qty, unit } = parseLegacyQty(ing.qty);
  return { ...ing, qty, unit };
}

// ─── Shared library search + resolver ───────────────────────────────────────
// Two callers: `GET /api/foods/search` (user-facing picker) and the cycle
// planner route (resolves Claude-named ingredients server-side). Both want
// the same scoring, so the SQL pass + in-memory rerank live here.

// We deliberately type the supabase client loosely here — the typed builder
// from @supabase/ssr is generic over the DB schema and changes between
// versions; the surface we use (from/select/or/eq/ilike/limit/order/is) is
// tiny and stable, so an opaque shape keeps the call sites flexible.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SearchSupabase = any;

const FOOD_SELECT =
  "slug,name,brand,category,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g,source,source_ref,aliases,food_portions(unit,grams_per_unit,description,is_default)";

type FoodSearchRow = {
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

const TYPE_WORDS = new Set(["bar", "bars", "chip", "chips", "cookie", "cookies", "sauce", "drink", "drinks", "shake", "shakes", "snack", "snacks"]);

function scoreFoodRow(r: FoodSearchRow, qLower: string, qTokens: string[], brandQueryTokens: string[]): number {
  if (!qLower) return 0;
  const name = r.name.toLowerCase();
  const brand = (r.brand ?? "").toLowerCase();
  const aliasText = (r.aliases ?? []).join(" ").toLowerCase();
  const combined = (brand ? `${brand} ${name}` : name) + " " + aliasText;
  let s = 0;
  if (name === qLower) s += 1000;
  if (combined === qLower) s += 1000;
  const nameBase = name.split(",")[0].trim();
  if (nameBase === qLower) s += 900;
  if (name.startsWith(qLower)) s += 500;
  if (brand && brand === qLower) s += 700;
  if (brand && brand.startsWith(qLower)) s += 400;
  if (combined.startsWith(qLower)) s += 350;
  if (name.includes(` ${qLower}`)) s += 200;
  if (combined.includes(qLower)) s += 120;
  if (name.includes(qLower)) s += 100;
  const aliasMatch = (r.aliases ?? []).some((a) => a.toLowerCase() === qLower);
  if (aliasMatch) s += 600;
  const aliasSubstring = (r.aliases ?? []).some((a) => a.toLowerCase().includes(qLower));
  if (aliasSubstring) s += 60;
  let tokenHits = 0;
  for (const t of qTokens) if (combined.includes(t)) tokenHits += 1;
  if (qTokens.length > 0) {
    s += (tokenHits / qTokens.length) * 400;
    if (tokenHits === qTokens.length) s += 200;
    if (tokenHits === 0) s -= 200;
  }
  if (brand && brandQueryTokens.length >= 2) {
    const brandHits = brandQueryTokens.filter((t) => brand.includes(t)).length;
    if (brandHits === brandQueryTokens.length) s += 800;
    else s += (brandHits / brandQueryTokens.length) * 200;
  }
  if (!brand && qTokens.length === 1) s += 150;
  if (name.startsWith("babyfood")) s -= 600;
  else if (name.includes("babyfood")) s -= 300;
  if (name.includes("candies")) s -= 200;
  if (name.includes("formulated bar") && !qLower.includes("bar")) s -= 100;
  if (r.source === "curated") s += 500;
  s -= Math.min(name.length, 80) * 0.6;
  return s;
}

function rowToEntry(r: FoodSearchRow): FoodLibraryEntry {
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
}

// Ranked search over food_library. Multi-pass SQL union (curated, branded,
// tight, loose), then in-memory rerank. Returns up to `limit` entries.
export async function searchFoodLibrary(
  supabase: SearchSupabase,
  q: string,
  limit: number = 20,
): Promise<{ entries: FoodLibraryEntry[]; error: string | null }> {
  const sanitized = q.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
  const tokens = sanitized.toLowerCase().split(/\s+/).filter((t) => t.length >= 2).slice(0, 5);

  const buildLoose = () => {
    let query = supabase.from("food_library").select(FOOD_SELECT);
    if (sanitized) {
      const fullLike = `%${sanitized}%`;
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
      return query.or(clauses.join(",")).order("name", { ascending: true }).limit(sanitized ? 200 : limit);
    }
    return query.is("brand", null).order("name", { ascending: true }).limit(limit);
  };

  const allTokens = sanitized.toLowerCase().split(/\s+/).filter((t) => t.length >= 2);
  const brandTokens = allTokens.filter((t) => !TYPE_WORDS.has(t)).slice(0, 4);

  const tightPromise = sanitized
    ? supabase
        .from("food_library")
        .select(FOOD_SELECT)
        .or(`name.ilike.%${sanitized}%,brand.ilike.%${sanitized}%`)
        .limit(100)
    : Promise.resolve({ data: [], error: null });

  const curatedPromise = sanitized && allTokens.length > 0
    ? (async () => {
        const curOr = allTokens
          .slice(0, 4)
          .flatMap((t) => [`name.ilike.%${t}%`, `aliases.cs.{${t}}`])
          .join(",");
        return await supabase
          .from("food_library")
          .select(FOOD_SELECT)
          .eq("source", "curated")
          .or(curOr)
          .limit(60);
      })()
    : Promise.resolve({ data: [], error: null });

  const brandedPromise = sanitized && brandTokens.length > 0
    ? (async () => {
        // Build chained ilike via the raw query — but for typing simplicity
        // we go through a minimal cast.
        let bq = supabase.from("food_library").select(FOOD_SELECT) as unknown as {
          ilike: (col: string, pattern: string) => typeof bq;
          limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }>;
        };
        for (const t of brandTokens) bq = bq.ilike("brand", `%${t}%`);
        return await bq.limit(60);
      })()
    : Promise.resolve({ data: [], error: null });

  const loosePromise = buildLoose();

  const [looseRes, tightRes, brandedRes, curatedRes] = await Promise.all([
    loosePromise,
    tightPromise,
    brandedPromise,
    curatedPromise,
  ]);

  const errMsg = looseRes.error?.message ?? tightRes.error?.message ?? brandedRes.error?.message ?? curatedRes.error?.message ?? null;
  if (errMsg) return { entries: [], error: errMsg };

  const merged = new Map<string, FoodSearchRow>();
  for (const r of (curatedRes.data ?? []) as FoodSearchRow[]) merged.set(r.slug, r);
  for (const r of (brandedRes.data ?? []) as FoodSearchRow[]) if (!merged.has(r.slug)) merged.set(r.slug, r);
  for (const r of (tightRes.data ?? []) as FoodSearchRow[]) if (!merged.has(r.slug)) merged.set(r.slug, r);
  for (const r of (looseRes.data ?? []) as FoodSearchRow[]) if (!merged.has(r.slug)) merged.set(r.slug, r);
  const rows = [...merged.values()];

  const qLower = q.toLowerCase().trim();
  const qTokens = qLower.split(/\s+/).filter((t) => t.length >= 2);
  const brandQueryTokens = qTokens.filter((t) => !TYPE_WORDS.has(t));

  const ranked = rows
    .map((r) => ({ r, s: scoreFoodRow(r, qLower, qTokens, brandQueryTokens) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.r);

  return { entries: ranked.map(rowToEntry), error: null };
}

// Resolve a Claude-named ingredient ("Greek yogurt, plain, nonfat") to the
// best matching food_library entry. Returns null if the top match's relevance
// score falls below `minScore` — the caller falls back to an AI macro guess.
//
// The threshold is conservative: in practice, exact-name or strong-brand hits
// land at 600+, full-token hits at ~500, weak partials at 100–200. We pick
// 250 as the floor for "trust this match" — strong enough to filter out
// false positives like "Nutella" matching "Greek yogurt with chocolate".
export async function resolveIngredientToLibrary(
  supabase: SearchSupabase,
  name: string,
  minScore: number = 250,
): Promise<FoodLibraryEntry | null> {
  const q = (name ?? "").trim();
  if (!q) return null;

  const sanitized = q.replace(/[%_,()]/g, " ").replace(/\s+/g, " ").trim();
  const { entries, error } = await searchFoodLibrary(supabase, sanitized, 5);
  if (error || entries.length === 0) return null;

  // Re-score the top entries with the same scorer to apply the threshold.
  const qLower = q.toLowerCase().trim();
  const qTokens = qLower.split(/\s+/).filter((t) => t.length >= 2);
  const brandQueryTokens = qTokens.filter((t) => !TYPE_WORDS.has(t));
  const top = entries[0];
  // Reconstruct a FoodSearchRow shape for scoring.
  const rowForScore: FoodSearchRow = {
    slug: top.slug,
    name: top.name,
    brand: top.brand,
    category: top.category,
    calories_per_100g: top.calories_per_100g,
    protein_per_100g: top.protein_per_100g,
    carbs_per_100g: top.carbs_per_100g,
    fat_per_100g: top.fat_per_100g,
    source: top.source,
    source_ref: top.source_ref,
    aliases: top.aliases,
    food_portions: null,
  };
  const score = scoreFoodRow(rowForScore, qLower, qTokens, brandQueryTokens);
  return score >= minScore ? top : null;
}

// ─── Persistent ingredient-name resolution cache ─────────────────────────────
// Wraps resolveIngredientToLibrary with a Postgres-backed cache so the
// scorer + downstream Haiku fallback only run once per phrase across all
// users + plan generations. See migration 020_food_resolutions.sql.

export function normalizeIngredientName(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ResolutionRow = {
  name_normalized: string;
  food_slug: string | null;
  score: number | null;
  source: "auto" | "ai_guess" | "manual_override";
  hit_count: number;
};

// Cached resolver. Returns the same shape as resolveIngredientToLibrary —
// either a FoodLibraryEntry or null (caller falls back to AI guess).
// On hit: bumps hit_count and returns immediately (no scorer call).
// On miss: runs the scorer, persists the verdict, returns.
// `manual_override` rows are honored even when food_slug is null (means
// "we explicitly know this phrase has no library match — go straight to AI").
export async function resolveIngredientCached(
  supabase: SearchSupabase,
  name: string,
  minScore: number = 250,
): Promise<FoodLibraryEntry | null> {
  const key = normalizeIngredientName(name);
  if (!key) return null;

  const { data: cached } = await supabase
    .from("food_resolutions")
    .select("name_normalized,food_slug,score,source,hit_count")
    .eq("name_normalized", key)
    .maybeSingle();

  const row = cached as ResolutionRow | null;

  if (row) {
    // Fire-and-forget hit_count bump — don't block the resolver on it.
    void supabase
      .from("food_resolutions")
      .update({ hit_count: row.hit_count + 1, updated_at: new Date().toISOString() })
      .eq("name_normalized", key);

    if (row.food_slug) {
      const entry = await fetchFoodLibraryEntry(supabase, row.food_slug);
      if (entry) return entry;
      // Cached slug vanished from the library (deletion). Fall through and
      // re-resolve to refresh the cache.
    } else if (row.source === "manual_override" || row.source === "ai_guess") {
      // Negative verdict was already cached — skip the scorer.
      return null;
    }
  }

  // Cache miss (or stale slug) — run the scorer, persist the verdict.
  const entry = await resolveIngredientToLibrary(supabase, name, minScore);
  await supabase
    .from("food_resolutions")
    .upsert({
      name_normalized: key,
      food_slug: entry?.slug ?? null,
      score: null,
      source: entry ? "auto" : "ai_guess",
      hit_count: 1,
      updated_at: new Date().toISOString(),
    }, { onConflict: "name_normalized" });
  return entry;
}

async function fetchFoodLibraryEntry(
  supabase: SearchSupabase,
  slug: string,
): Promise<FoodLibraryEntry | null> {
  const { data, error } = await supabase
    .from("food_library")
    .select(FOOD_SELECT)
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  return rowToEntry(data as FoodSearchRow);
}

// Re-export Portion for convenience.
export type { FoodPortion };

// The seven units we surface in the unit dropdown when a food has no
// library-specific portions. Order is intentional: g and oz first (mass,
// always correct), then volumes.
export const FALLBACK_UNIT_LIST = ["g", "oz", "lb", "ml", "tbsp", "tsp", "cup", "slice", "piece", "scoop"] as const;
