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

// Re-export Portion for convenience.
export type { FoodPortion };

// The seven units we surface in the unit dropdown when a food has no
// library-specific portions. Order is intentional: g and oz first (mass,
// always correct), then volumes.
export const FALLBACK_UNIT_LIST = ["g", "oz", "lb", "ml", "tbsp", "tsp", "cup", "slice", "piece", "scoop"] as const;
