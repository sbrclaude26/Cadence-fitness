// Stream-parse the Open Food Facts CSV (en.openfoodfacts.org.products.csv.gz)
// down to a popular US-branded subset and write it to lib/data/off-foods.json
// in the same shape the food_library seeder expects.
//
// Why streaming: the gzipped CSV is ~1.3GB and ~9GB uncompressed with several
// million rows. We never hold the whole thing in memory; instead we filter
// line-by-line (US country + complete macros) and keep only the top N by
// unique-scans-n. The shortlist stays in a min-heap-like Map keyed by code.
//
// Run after downloading the CSV (see scripts/buildUsdaJson.ts for the same
// pattern with the FDC dumps):
//
//   mkdir -p tmp/off && cd tmp/off
//   curl -fsSL -A "CadenceFitness/1.0" -o products.csv.gz \
//     https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz
//   cd ../.. && npx tsx scripts/buildOffJson.ts

import { createReadStream, writeFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { resolve } from "node:path";

// We accept scans=0 rows when completeness is decent because many real niche
// brands (e.g. Peak Protein bars) have never been opt-in-scanned by an OFF
// user but still have complete nutrition data. The completeness >= 0.4 +
// all-four-macros filter keeps obvious junk out. TOP_N is high enough to
// keep every passing US row; we also tie-break scans=0 candidates by
// completeness so niche but well-documented brands aren't dropped randomly.
const TOP_N = 80000;
const MIN_SCANS = 0;
const CSV_PATH = resolve(process.cwd(), "tmp/off/products.csv.gz");
const OUT_PATH = resolve(process.cwd(), "lib/data/off-foods.json");

interface OutPortion {
  unit: string;
  grams_per_unit: number;
  description: string;
  is_default: boolean;
}
interface OutFood {
  slug: string;
  name: string;
  brand: string | null;
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

// OFF tag conventions: categories_tags is a comma-joined list of slugs like
// "en:snacks,en:sweet-snacks,en:bars,en:chocolate-bars". We pick the first
// recognizable bucket so the picker categorization stays consistent with USDA.
function categoryFromTags(tags: string): string {
  const t = tags.toLowerCase();
  if (/protein-bar|cereal-bar|granola-bar|nutrition-bar/.test(t)) return "snack";
  if (/yoghurt|yogurt|cheese|milk|cream|butter|kefir/.test(t)) return "dairy";
  if (/meat|chicken|beef|pork|sausage|salami|jerky|fish/.test(t)) return "protein";
  if (/bread|pasta|noodle|grain|cereal|rice|oat/.test(t)) return "grain";
  if (/oil|nut|seed|nuts-and-seeds|peanut-butter|almond-butter/.test(t)) return "fat";
  if (/vegetable|salad|legume/.test(t)) return "veg";
  if (/fruit|berr/.test(t)) return "fruit";
  if (/beverage|drink|soda|juice|water|tea|coffee/.test(t)) return "beverage";
  if (/sauce|condiment|dressing|ketchup|mustard|mayonnais|honey/.test(t)) return "condiment";
  if (/chocolate|candy|candies|cookie|biscuit|chip|crisp|snack/.test(t)) return "snack";
  return "other";
}

function num(s: string): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(",", "."));
  return isFinite(n) ? n : null;
}

async function main() {
  console.log("Streaming OFF CSV →", CSV_PATH);
  const rl = createInterface({
    input: createReadStream(CSV_PATH).pipe(createGunzip()),
    crlfDelay: Infinity,
  });

  let headerCols: string[] = [];
  let idx: Record<string, number> = {};
  let lineNum = 0;
  let seen = 0;
  let kept = 0;
  // Keep all candidates that pass the filter; sort + slice at the end. Map
  // by code so duplicate barcodes collapse (OFF sometimes has them).
  const candidates: Array<{ scans: number; completeness: number; row: OutFood }> = [];

  for await (const line of rl) {
    lineNum++;
    if (lineNum === 1) {
      headerCols = line.split("\t");
      headerCols.forEach((c, i) => { idx[c] = i; });
      const required = ["code", "product_name", "brands", "categories_tags", "countries_tags",
        "serving_quantity", "unique_scans_n", "completeness",
        "energy-kcal_100g", "fat_100g", "carbohydrates_100g", "proteins_100g"];
      const missing = required.filter((c) => idx[c] === undefined);
      if (missing.length) throw new Error("Missing columns: " + missing.join(", "));
      continue;
    }
    seen++;
    if (seen % 200_000 === 0) {
      console.log(`  scanned ${seen.toLocaleString()} rows, kept ${candidates.length}`);
    }
    const cols = line.split("\t");
    if (cols.length < headerCols.length) continue;
    // Cheap rejects first to keep the hot path lean.
    const countries = cols[idx.countries_tags] ?? "";
    if (!countries.includes("united-states")) continue;
    const scans = parseInt(cols[idx.unique_scans_n] ?? "0", 10) || 0;
    if (scans < MIN_SCANS) continue;
    const name = (cols[idx.product_name] ?? "").trim();
    if (!name || name.length < 3) continue;
    const kcal = num(cols[idx["energy-kcal_100g"]]);
    const protein = num(cols[idx.proteins_100g]);
    const carbs = num(cols[idx.carbohydrates_100g]);
    const fat = num(cols[idx.fat_100g]);
    if (kcal == null || protein == null || carbs == null || fat == null) continue;
    if (kcal < 0 || kcal > 900) continue; // bogus rows
    if (protein < 0 || protein > 100) continue;
    if (carbs < 0 || carbs > 100) continue;
    if (fat < 0 || fat > 100) continue;
    const completeness = num(cols[idx.completeness]) ?? 0;
    if (completeness < 0.4) continue;
    const brandRaw = (cols[idx.brands] ?? "").trim();
    const brand = brandRaw ? brandRaw.split(",")[0].trim().slice(0, 60) : null;
    const code = (cols[idx.code] ?? "").trim();
    const slugBase = brand ? `${brand} ${name}` : name;
    const slug = slugify(slugBase);
    if (!slug) continue;
    const category = categoryFromTags(cols[idx.categories_tags] ?? "");
    const servingGrams = num(cols[idx.serving_quantity]);
    const portions: OutPortion[] = [{ unit: "g", grams_per_unit: 1, description: "1 g", is_default: false }];
    if (servingGrams && servingGrams > 0 && servingGrams < 1000) {
      portions.push({
        unit: "serving",
        grams_per_unit: Math.round(servingGrams * 100) / 100,
        description: `1 serving (~${Math.round(servingGrams)}g)`,
        is_default: true,
      });
    } else {
      portions[0].is_default = true;
    }
    candidates.push({
      scans,
      completeness,
      row: {
        slug,
        name,
        brand,
        category,
        calories_per_100g: Math.round(kcal * 10) / 10,
        protein_per_100g: Math.round(protein * 10) / 10,
        carbs_per_100g: Math.round(carbs * 10) / 10,
        fat_per_100g: Math.round(fat * 10) / 10,
        source: "off",
        source_ref: code,
        aliases: brand ? [name, `${brand.toLowerCase()} ${name.toLowerCase()}`] : [name],
        portions,
      },
    });
    kept++;
  }

  console.log(`Scanned ${seen.toLocaleString()} rows, kept ${kept.toLocaleString()} candidates.`);
  candidates.sort((a, b) => b.scans - a.scans || b.completeness - a.completeness);
  const top = candidates.slice(0, TOP_N);
  // Dedupe by slug — barcode collisions or near-duplicates collapse to the
  // most-scanned variant (already first because we sorted by scans desc).
  const bySlug = new Map<string, OutFood>();
  for (const c of top) if (!bySlug.has(c.row.slug)) bySlug.set(c.row.slug, c.row);
  const out = [...bySlug.values()];
  console.log(`Final: ${out.length} branded rows (top ${TOP_N} by scans, deduped).`);

  const byCat: Record<string, number> = {};
  for (const r of out) byCat[r.category] = (byCat[r.category] ?? 0) + 1;
  console.log("By category:", byCat);

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log("Wrote", OUT_PATH, `(${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
