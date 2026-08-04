// One-off backfill of fiber onto historical rows.
//
// Fiber only became available once the food library was reseeded with it
// (migration 028), so everything logged before that has fiber = null. This
// recomputes it wherever the data actually supports it:
//
//   meal_recipes / meal_prep_batches — ingredients that carry a food_slug can
//     be re-priced against the library.
//   meal_logs with a batch_id — fiber is the batch total scaled by portion_pct.
//
//   standalone meal_logs whose NAME exactly matches a library food or a saved
//     recipe — single-ingredient builder logs are named after the food they
//     came from, so the name identifies the food and the logged calories
//     identify the portion. Every derived portion is cross-checked against a
//     second macro before it is trusted (see deriveScale).
//
// Deliberately NOT backfilled: meals whose name matches nothing (free-text,
// AI-estimated, or multi-item builder names). meal_logs stores no ingredient
// list, so there is nothing to recompute from and a guess would invent data.
// Those stay null, which the UI renders as "—".
//
// Ingredients that resolve are summed; anything unresolved marks the row's
// fiber as a floor (fiber_partial), which the UI renders as "≥ N g". Only rows
// where NOTHING resolves stay null. An all-or-nothing rule threw away most of
// the recoverable signal — 28 of 36 unfilled batches were ~75% resolvable and
// were being blocked by a single unknown ingredient.
//
// Usage (from cadence-app/, with .env.local loaded):
//   set -a && . ./.env.local && set +a && npx tsx scripts/backfillFiber.ts [--apply]
// Without --apply it reports what it would change and writes nothing.

import { createClient } from "@supabase/supabase-js";
import { effectiveFiberPer100g, gramsForPortion, parseLegacyQty } from "../lib/foodLibrary";
import type { FoodLibraryEntry, Ingredient } from "../lib/types";

const APPLY = process.argv.includes("--apply");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// supabase-js insists on a WebSocket for its realtime client even when unused.
if (typeof globalThis.WebSocket === "undefined") {
  (globalThis as Record<string, unknown>).WebSocket = class { close() {} } as unknown;
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

type LibRow = FoodLibraryEntry & { food_portions?: Array<{ unit: string; grams_per_unit: number; description: string | null; is_default: boolean }> };

async function loadLibrary(slugs: string[]): Promise<Map<string, FoodLibraryEntry>> {
  const out = new Map<string, FoodLibraryEntry>();
  const CHUNK = 200;
  for (let i = 0; i < slugs.length; i += CHUNK) {
    const chunk = slugs.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("food_library")
      .select("slug,name,brand,category,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g,fiber_per_100g,source,source_ref,aliases,food_portions(unit,grams_per_unit,description,is_default)")
      .in("slug", chunk);
    if (error) throw error;
    for (const r of (data ?? []) as unknown as LibRow[]) {
      out.set(r.slug, {
        ...r,
        fiber_per_100g: r.fiber_per_100g == null ? null : Number(r.fiber_per_100g),
        calories_per_100g: Number(r.calories_per_100g),
        protein_per_100g: Number(r.protein_per_100g),
        carbs_per_100g: Number(r.carbs_per_100g),
        fat_per_100g: Number(r.fat_per_100g),
        portions: (r.food_portions ?? []).map((p) => ({
          unit: p.unit,
          grams_per_unit: Number(p.grams_per_unit),
          description: p.description,
          is_default: p.is_default,
        })),
      } as FoodLibraryEntry);
    }
  }
  return out;
}

interface FiberResult {
  /** Sum over ingredients that resolved. Null only when none did. */
  fiber: number | null;
  /** True when at least one ingredient couldn't be resolved — value is a floor. */
  partial: boolean;
}

function fiberFor(ingredients: Ingredient[], lib: Map<string, FoodLibraryEntry>): FiberResult {
  if (!ingredients?.length) return { fiber: null, partial: false };
  let total = 0;
  let known = 0;
  let unknown = 0;
  for (const ing of ingredients) {
    const entry = ing.food_slug ? lib.get(ing.food_slug) : null;
    const per100 = entry ? effectiveFiberPer100g(entry) : null;
    if (!entry || per100 == null) { unknown++; continue; }
    // New rows store a numeric qty + separate unit; legacy rows pack both into
    // qty ("200 g").
    const parsed = ing.unit !== undefined ? { qty: ing.qty, unit: ing.unit } : parseLegacyQty(ing.qty);
    const grams = gramsForPortion(entry, parsed.unit || "g", parseFloat(parsed.qty));
    if (grams == null) { unknown++; continue; }
    total += (per100 * grams) / 100;
    known++;
  }
  if (known === 0) return { fiber: null, partial: false };
  return { fiber: Math.round(total * 10) / 10, partial: unknown > 0 };
}

/**
 * How much of a 100g reference a logged row represents, derived from its
 * macros. Returns null when the row can't be reconciled with the reference.
 *
 * Calories are the primary scalar. A second macro must independently agree
 * within tolerance — if the athlete hand-edited a row's macros (the "edit
 * macros" pencil) the proportions break, and a portion derived from calories
 * alone would silently invent a fiber number.
 */
const SCALE_TOLERANCE = 0.25;

function deriveScale(
  logged: { calories: number; protein: number; carbs: number; fat: number },
  per100: { calories_per_100g: number; protein_per_100g: number; carbs_per_100g: number; fat_per_100g: number },
): number | null {
  const candidates: Array<[number, number]> = [
    [logged.calories, per100.calories_per_100g],
    [logged.protein, per100.protein_per_100g],
    [logged.carbs, per100.carbs_per_100g],
    [logged.fat, per100.fat_per_100g],
  ];
  const scales = candidates
    .filter(([, ref]) => ref > 0.5)
    .map(([val, ref]) => val / ref)
    .filter((x) => isFinite(x) && x > 0);
  if (scales.length === 0) return null;

  const primary = per100.calories_per_100g > 0.5 && logged.calories > 0
    ? logged.calories / per100.calories_per_100g
    : scales[0];
  // At least one other macro has to corroborate the primary scale.
  const corroborated = scales.some((x) => x !== primary && Math.abs(x - primary) / primary <= SCALE_TOLERANCE);
  if (scales.length > 1 && !corroborated) return null;
  return primary;
}

async function main() {
  const [{ data: recipes, error: rErr }, { data: batches, error: bErr }] = await Promise.all([
    supabase.from("meal_recipes").select("id, name, ingredients, fiber, fiber_partial, calories"),
    supabase.from("meal_prep_batches").select("id, name, ingredients, total_fiber"),
  ]);
  if (rErr) throw rErr;
  if (bErr) throw bErr;

  // One library fetch covering every slug referenced anywhere.
  const slugs = new Set<string>();
  for (const row of [...(recipes ?? []), ...(batches ?? [])]) {
    for (const ing of (row.ingredients ?? []) as Ingredient[]) {
      if (ing.food_slug) slugs.add(ing.food_slug);
    }
  }
  const lib = await loadLibrary([...slugs]);
  console.log(`library: resolved ${lib.size}/${slugs.size} referenced slugs`);

  let recipesSet = 0;
  let recipesPartial = 0;
  for (const r of recipes ?? []) {
    const { fiber, partial } = fiberFor((r.ingredients ?? []) as Ingredient[], lib);
    if (fiber == null) continue;
    recipesSet++;
    if (partial) recipesPartial++;
    if (APPLY) {
      const { error } = await supabase.from("meal_recipes")
        .update({ fiber, fiber_partial: partial }).eq("id", r.id);
      if (error) console.error("recipe update failed", r.id, error.message);
    }
  }

  let batchesSet = 0;
  let batchesPartial = 0;
  const batchFiber = new Map<string, FiberResult>();
  for (const b of batches ?? []) {
    const result = fiberFor((b.ingredients ?? []) as Ingredient[], lib);
    if (result.fiber == null) continue;
    batchesSet++;
    if (result.partial) batchesPartial++;
    batchFiber.set(b.id as string, result);
    if (APPLY) {
      const { error } = await supabase.from("meal_prep_batches")
        .update({ total_fiber: result.fiber, total_fiber_partial: result.partial }).eq("id", b.id);
      if (error) console.error("batch update failed", b.id, error.message);
    }
  }

  // meal_logs that came from a batch: scale the batch total by the portion.
  const { data: logs, error: lErr } = await supabase
    .from("meal_logs")
    .select("id, batch_id, portion_pct, fiber")
    .not("batch_id", "is", null);
  if (lErr) throw lErr;

  let logsSet = 0;
  for (const log of logs ?? []) {
    const batch = batchFiber.get(log.batch_id as string);
    if (!batch || batch.fiber == null) continue;
    const pct = Number(log.portion_pct);
    if (!isFinite(pct) || pct <= 0) continue;
    const fiber = Math.round((batch.fiber * pct) / 100 * 10) / 10;
    logsSet++;
    if (APPLY) {
      const { error } = await supabase.from("meal_logs")
        .update({ fiber, fiber_partial: batch.partial }).eq("id", log.id);
      if (error) console.error("log update failed", log.id, error.message);
    }
  }

  // ── Standalone logs: recover from the meal name ──────────────────────────
  const { data: standalone, error: sErr } = await supabase
    .from("meal_logs")
    .select("id, name, calories, protein, carbs, fat, fiber, user_id")
    .is("batch_id", null)
    .is("fiber", null);
  if (sErr) throw sErr;

  // Query with the names as stored — the column isn't lower-cased, so an
  // `.in()` of lower-cased strings matches nothing. The lookup map is keyed
  // case-insensitively afterwards.
  const names = [...new Set((standalone ?? []).map((m) => (m.name ?? "").trim()).filter(Boolean))];
  const byName = new Map<string, { fiberPer100: number | null; per100: { calories_per_100g: number; protein_per_100g: number; carbs_per_100g: number; fat_per_100g: number } }>();
  const CH = 100;
  for (let i = 0; i < names.length; i += CH) {
    const { data } = await supabase
      .from("food_library")
      .select("name, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g, fiber_per_100g")
      .in("name", names.slice(i, i + CH));
    for (const f of (data ?? []) as Array<Record<string, unknown>>) {
      const key = String(f.name).trim().toLowerCase();
      // Duplicate names exist across brands; a second, differing row makes the
      // match ambiguous, so drop it rather than pick arbitrarily.
      const per100 = {
        calories_per_100g: Number(f.calories_per_100g),
        protein_per_100g: Number(f.protein_per_100g),
        carbs_per_100g: Number(f.carbs_per_100g),
        fat_per_100g: Number(f.fat_per_100g),
      };
      const fiberPer100 = effectiveFiberPer100g({
        fiber_per_100g: f.fiber_per_100g == null ? null : Number(f.fiber_per_100g),
        carbs_per_100g: per100.carbs_per_100g,
      });
      const existing = byName.get(key);
      if (existing && (existing.fiberPer100 !== fiberPer100 || existing.per100.calories_per_100g !== per100.calories_per_100g)) {
        byName.set(key, { fiberPer100: null, per100 });  // ambiguous → unusable
        continue;
      }
      if (!existing) byName.set(key, { fiberPer100, per100 });
    }
  }

  // Saved recipes are logged 1:1 by name, so their stored fiber scales the
  // same way.
  const recipeByName = new Map<string, { fiber: number; partial: boolean; calories: number }>();
  for (const r of recipes ?? []) {
    const fiber = (r as Record<string, unknown>).fiber;
    if (fiber == null) continue;
    recipeByName.set(String(r.name).trim().toLowerCase(), {
      fiber: Number(fiber),
      partial: Boolean((r as Record<string, unknown>).fiber_partial),
      calories: Number((r as Record<string, unknown>).calories) || 0,
    });
  }

  let fromLibrary = 0, fromRecipe = 0, skippedNoMatch = 0, skippedUnreconciled = 0, skippedUnknownFiber = 0;
  for (const m of standalone ?? []) {
    const key = (m.name ?? "").trim().toLowerCase();
    const logged = {
      calories: Number(m.calories) || 0,
      protein: Number(m.protein) || 0,
      carbs: Number(m.carbs) || 0,
      fat: Number(m.fat) || 0,
    };

    const rec = recipeByName.get(key);
    if (rec) {
      const scale = rec.calories > 0 && logged.calories > 0 ? logged.calories / rec.calories : 1;
      const fiber = Math.round(rec.fiber * scale * 10) / 10;
      fromRecipe++;
      if (APPLY) {
        const { error } = await supabase.from("meal_logs")
          .update({ fiber, fiber_partial: rec.partial }).eq("id", m.id);
        if (error) console.error("log(recipe) update failed", m.id, error.message);
      }
      continue;
    }

    const hit = byName.get(key);
    if (!hit) { skippedNoMatch++; continue; }
    if (hit.fiberPer100 == null) { skippedUnknownFiber++; continue; }
    const scale = deriveScale(logged, hit.per100);
    if (scale == null) { skippedUnreconciled++; continue; }
    const fiber = Math.round(hit.fiberPer100 * scale * 10) / 10;
    // Fiber is a fraction of total carbohydrate, so it can never exceed the
    // row's logged carbs. A violation means the library row and the logged
    // macros disagree — skip rather than store an impossible number.
    if (fiber > logged.carbs + 0.5) { skippedUnreconciled++; continue; }
    fromLibrary++;
    if (APPLY) {
      const { error } = await supabase.from("meal_logs")
        .update({ fiber, fiber_partial: false }).eq("id", m.id);
      if (error) console.error("log(library) update failed", m.id, error.message);
    }
  }

  console.log(`standalone logs: ${fromLibrary} from library name, ${fromRecipe} from recipe name, skipped ${skippedNoMatch} unmatched / ${skippedUnreconciled} macros-not-proportional / ${skippedUnknownFiber} food has no fiber data`);

  console.log(`${APPLY ? "updated" : "would update"}: ${recipesSet}/${recipes?.length ?? 0} recipes (${recipesPartial} partial), ${batchesSet}/${batches?.length ?? 0} batches (${batchesPartial} partial), ${logsSet}/${logs?.length ?? 0} batch-linked meal logs`);
  if (!APPLY) console.log("dry run — re-run with --apply to write");
}

main().catch((e) => { console.error(e); process.exit(1); });
