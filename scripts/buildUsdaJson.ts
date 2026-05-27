// One-shot transformer: USDA FDC bulk dumps → lib/data/usda-foods.json in the
// shape our food_library seeder expects. Run after downloading the FDC zips:
//
//   mkdir -p tmp/fdc && cd tmp/fdc
//   curl -fsSL -o foundation.zip https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_foundation_food_json_2026-04-30.zip
//   curl -fsSL -o sr_legacy.zip  https://fdc.nal.usda.gov/fdc-datasets/FoodData_Central_sr_legacy_food_json_2018-04.zip
//   unzip -o foundation.zip && unzip -o sr_legacy.zip && cd ../..
//   npx tsx scripts/buildUsdaJson.ts
//
// Foundation Foods (~360 rows, hand-curated USDA whole foods) gives the
// cleanest macro + portion data; SR Legacy (~7800 rows) is the breadth layer
// for everything else. Slugs that collide with curated entries are dropped
// later by the seeder (curated wins).

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

// Same slug rules as lib/foodLibrary.ts:toFoodSlug — kept duplicated here so
// this script has no compile-time dep on the app's path aliases.
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

const CATEGORY_MAP: Record<string, string> = {
  "Vegetables and Vegetable Products": "veg",
  "Fruits and Fruit Juices": "fruit",
  "Dairy and Egg Products": "dairy",
  "Cereal Grains and Pasta": "grain",
  "Legumes and Legume Products": "protein",
  "Finfish and Shellfish Products": "protein",
  "Nut and Seed Products": "fat",
  "Beef Products": "protein",
  "Poultry Products": "protein",
  "Fats and Oils": "fat",
  "Pork Products": "protein",
  "Sausages and Luncheon Meats": "protein",
  "Lamb, Veal, and Game Products": "protein",
  "Restaurant Foods": "other",
  "Beverages": "beverage",
  "Spices and Herbs": "condiment",
  "Soups, Sauces, and Gravies": "condiment",
  "Baked Products": "grain",
  "Breakfast Cereals": "grain",
  "Sweets": "snack",
  "Snacks": "snack",
  "Fast Foods": "other",
  "Meals, Entrees, and Side Dishes": "other",
  "American Indian/Alaska Native Foods": "other",
  "Baby Foods": "other",
};

// USDA FoodData Central nutrient IDs we care about. Energy has a fallback
// chain because Foundation Foods inconsistently report it under 1008 (legacy
// kcal) vs 2047 (Atwater general factors) vs 2048 (Atwater specific
// factors); we accept whichever lands first.
const NID = {
  energyLegacyKcal: 1008,
  energyAtwaterGeneral: 2047,
  energyAtwaterSpecific: 2048,
  protein: 1003,
  fat: 1004,
  carbs: 1005,
} as const;

interface RawNutrient {
  nutrient?: { id?: number };
  amount?: number;
}
interface RawPortion {
  measureUnit?: { name?: string };
  modifier?: string;
  gramWeight?: number;
  amount?: number;
}
interface RawFood {
  description?: string;
  foodCategory?: { description?: string };
  fdcId?: number;
  foodNutrients?: RawNutrient[];
  foodPortions?: RawPortion[];
}

interface OutPortion {
  unit: string;
  grams_per_unit: number;
  description: string;
  is_default: boolean;
}
interface OutFood {
  slug: string;
  name: string;
  brand: null;
  category: string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  source: string;
  source_ref: string;
  aliases: string[];
  portions: OutPortion[];
}

function nutrientAmount(food: RawFood, id: number): number | null {
  for (const n of food.foodNutrients ?? []) {
    if (n.nutrient?.id === id && typeof n.amount === "number") return n.amount;
  }
  return null;
}

function pickEnergy(food: RawFood, protein: number, carbs: number, fat: number): number | null {
  const legacy = nutrientAmount(food, NID.energyLegacyKcal);
  if (legacy != null) return legacy;
  const atwGen = nutrientAmount(food, NID.energyAtwaterGeneral);
  if (atwGen != null) return atwGen;
  const atwSpec = nutrientAmount(food, NID.energyAtwaterSpecific);
  if (atwSpec != null) return atwSpec;
  // last resort: derive from macros (Atwater factors 4/4/9)
  return Math.round((protein * 4 + carbs * 4 + fat * 9) * 10) / 10;
}

// Normalize free-text portion units (modifier or measureUnit.name) to our
// canonical small set: g | oz | tbsp | tsp | cup | slice | piece | scoop | ml | lb.
// Anything we don't recognize is dropped; the row still gets per-100g math and
// the FoodPicker's static fallback units (g, oz) take over in the UI.
function normalizeUnit(rawUnit: string | undefined, modifier: string | undefined): string | null {
  const candidates = [rawUnit, modifier].filter(Boolean) as string[];
  for (const c of candidates) {
    const t = c.toLowerCase().trim();
    if (!t || t === "undetermined") continue;
    if (t === "g" || t === "gram" || t === "grams") return "g";
    if (t === "oz" || t === "ounce" || t === "ounces") return "oz";
    if (t === "lb" || t === "pound" || t === "pounds") return "lb";
    if (t === "ml" || t === "milliliter" || t === "milliliters" || t === "fl oz" || t === "fluid ounce") return "ml";
    if (t === "tbsp" || t === "tablespoon" || t === "tablespoons") return "tbsp";
    if (t === "tsp" || t === "teaspoon" || t === "teaspoons") return "tsp";
    if (t.startsWith("cup")) return "cup";
    if (t === "slice" || t === "slices") return "slice";
    if (t === "scoop" || t === "scoops") return "scoop";
    if (t === "piece" || t === "pieces" || t === "each" || t === "item" || t === "unit" ||
        t === "egg" || t === "fillet" || t === "bar" || t === "link" ||
        t === "wedge" || t === "drumstick" || t === "fruit" || t === "banana" ||
        t === "onion" || t === "olive" || t === "cookie" || t === "spear" || t === "steak" ||
        t === "roast" || t === "chop") return "piece";
    if (t === "serving" || t === "racc" || t === "nlea serving") return "serving";
  }
  return null;
}

function portionsFor(food: RawFood): OutPortion[] {
  const out: OutPortion[] = [];
  const seen = new Set<string>();
  for (const p of food.foodPortions ?? []) {
    if (!p.gramWeight || p.gramWeight <= 0) continue;
    const unit = normalizeUnit(p.measureUnit?.name, p.modifier);
    if (!unit || unit === "serving") continue; // skip "serving" — it's not a recognizable household measure
    // Convert "2 tbsp = 34g" → "1 tbsp = 17g" so picker math is qty × grams_per_unit.
    const amount = p.amount && p.amount > 0 ? p.amount : 1;
    const perUnit = p.gramWeight / amount;
    if (perUnit < 0.1 || perUnit > 5000) continue;
    if (seen.has(unit)) continue;
    seen.add(unit);
    out.push({
      unit,
      grams_per_unit: Math.round(perUnit * 1000) / 1000,
      description: `1 ${unit} (~${Math.round(perUnit)}g)`,
      is_default: false,
    });
  }
  // Always include g as a portion so the picker has a universal unit.
  if (!seen.has("g")) {
    out.push({ unit: "g", grams_per_unit: 1, description: "1 g", is_default: false });
  }
  // Default selection: prefer piece > cup > tbsp > oz > g.
  const preferOrder = ["piece", "cup", "tbsp", "oz", "g"];
  for (const u of preferOrder) {
    const found = out.find((p) => p.unit === u);
    if (found) { found.is_default = true; break; }
  }
  return out;
}

function transform(food: RawFood, source: string): OutFood | null {
  if (!food.description) return null;
  const protein = nutrientAmount(food, NID.protein);
  const fat = nutrientAmount(food, NID.fat);
  const carbs = nutrientAmount(food, NID.carbs);
  // Drop rows missing any of the big three macros — they'd be useless in the picker.
  if (protein == null || fat == null || carbs == null) return null;
  const kcal = pickEnergy(food, protein, carbs, fat);
  if (kcal == null) return null;
  const categoryDesc = food.foodCategory?.description ?? "";
  const category = CATEGORY_MAP[categoryDesc] ?? "other";
  const slug = slugify(food.description);
  if (!slug) return null;
  return {
    slug,
    name: food.description,
    brand: null,
    category,
    calories_per_100g: Math.round(kcal * 10) / 10,
    protein_per_100g: Math.round(protein * 10) / 10,
    carbs_per_100g: Math.round(carbs * 10) / 10,
    fat_per_100g: Math.round(fat * 10) / 10,
    source,
    source_ref: String(food.fdcId ?? ""),
    aliases: [],
    portions: portionsFor(food),
  };
}

function findFile(dir: string, prefix: string): string {
  const matches = readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith(".json"));
  if (matches.length === 0) throw new Error(`No file in ${dir} starting with ${prefix}`);
  return resolve(dir, matches[0]);
}

function main() {
  const fdcDir = resolve(process.cwd(), "tmp/fdc");
  const foundationPath = findFile(fdcDir, "FoodData_Central_foundation_food_json");
  const srPath = findFile(fdcDir, "FoodData_Central_sr_legacy_food_json");

  console.log("Loading Foundation Foods…");
  const foundation = JSON.parse(readFileSync(foundationPath, "utf8")).FoundationFoods.filter(Boolean) as RawFood[];
  console.log("  raw rows:", foundation.length);

  console.log("Loading SR Legacy…");
  const sr = JSON.parse(readFileSync(srPath, "utf8")).SRLegacyFoods.filter(Boolean) as RawFood[];
  console.log("  raw rows:", sr.length);

  const out: OutFood[] = [];
  const bySlug = new Map<string, OutFood>();

  // Foundation first — when both sets describe the same food we keep Foundation
  // because its portion data is denser and the nutrient values are more recent.
  for (const f of foundation) {
    const row = transform(f, "usda_foundation");
    if (!row) continue;
    bySlug.set(row.slug, row);
  }
  for (const f of sr) {
    const row = transform(f, "usda_sr_legacy");
    if (!row) continue;
    if (bySlug.has(row.slug)) continue; // Foundation wins
    bySlug.set(row.slug, row);
  }
  for (const r of bySlug.values()) out.push(r);

  console.log("Output rows:", out.length);
  const byCat: Record<string, number> = {};
  for (const r of out) byCat[r.category] = (byCat[r.category] ?? 0) + 1;
  console.log("By category:", byCat);

  const outPath = resolve(process.cwd(), "lib/data/usda-foods.json");
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("Wrote", outPath, `(${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
}

main();
