"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, X, Check, BookmarkPlus, AlertTriangle, Pencil, RefreshCw } from "lucide-react";
import { inputStyle, primaryBtnStyle, ghostBtnStyle } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";
import { FoodPicker, type FoodPickerSelection } from "@/components/meals/FoodPicker";
import { gramsForPortion, macrosFor, sumMacros, parseLegacyQty, FALLBACK_UNIT_LIST } from "@/lib/foodLibrary";
import type { FoodLibraryEntry, FoodPortion, Ingredient, IngredientMacros, Meal, MealSlot } from "@/lib/types";

// Same column set lib/foodLibrary.ts uses server-side; food_library is
// readable by any authenticated user (RLS, migration 015) so the browser
// client can rehydrate prefilled rows without a dedicated API route.
const FOOD_ENTRY_SELECT =
  "slug,name,brand,category,calories_per_100g,protein_per_100g,carbs_per_100g,fat_per_100g,fiber_per_100g,source,source_ref,aliases,food_portions(unit,grams_per_unit,description,is_default)";

interface FoodEntryRow {
  slug: string;
  name: string;
  brand: string | null;
  category: string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  fiber_per_100g: number | null;
  source: string;
  source_ref: string | null;
  aliases: string[] | null;
  food_portions: Array<{
    unit: string;
    grams_per_unit: number;
    description: string | null;
    is_default: boolean;
  }> | null;
}

function entryFromRow(r: FoodEntryRow): FoodLibraryEntry {
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
    fiber_per_100g: r.fiber_per_100g == null ? null : Number(r.fiber_per_100g),
    source: r.source,
    source_ref: r.source_ref,
    aliases: r.aliases ?? [],
    portions,
  };
}

interface IngredientRow {
  item: string;
  qty: string;
  unit: string;
  food_slug: string | null;
  entry: FoodLibraryEntry | null;
  macros: IngredientMacros | null;          // library-computed OR override
  override: boolean;                          // true when user edited macros for this meal
  ai_guess: boolean;
  ai_loading: boolean;
  ai_error: string | null;
}

function emptyRow(): IngredientRow {
  return {
    item: "", qty: "", unit: "g", food_slug: null, entry: null,
    macros: null, override: false, ai_guess: false, ai_loading: false, ai_error: null,
  };
}

interface Props {
  mode?: "recipe" | "batch";
  slot?: MealSlot;
  defaultName?: string;
  defaultIngredients?: Ingredient[];
  defaultMacros?: { calories: number; protein: number; carbs: number; fat: number };
  defaultServings?: number;
  showSaveToRecipes?: boolean;
  applyLabel?: string;
  onBuild: (meal: Omit<Meal, "slot"> & { servings?: number }) => void;
  onCancel: () => void;
}

export function MealBuilder({
  mode = "recipe",
  defaultName = "",
  defaultIngredients,
  defaultMacros,
  defaultServings,
  showSaveToRecipes = true,
  applyLabel,
  onBuild,
  onCancel,
}: Props) {
  const supabase = createClient();
  const [name, setName] = useState(defaultName);

  const [rows, setRows] = useState<IngredientRow[]>(() => {
    if (defaultIngredients?.length) {
      return defaultIngredients.map((ing) => {
        const parsed = parseLegacyQty(ing.qty);
        return {
          item: ing.item,
          qty: ing.unit !== undefined ? ing.qty : parsed.qty,
          unit: ing.unit ?? parsed.unit,
          food_slug: ing.food_slug ?? null,
          entry: null,
          macros: ing.macros ?? null,
          // Library rows (food_slug set) get their entry rehydrated on mount
          // and macros recomputed live — treating every saved macro block as
          // an override froze qty edits on prefilled recipes. Only custom
          // rows with hand-entered (non-AI) macros are genuine overrides.
          override: !ing.food_slug && !!ing.macros && !ing.ai_guess,
          ai_guess: !!ing.ai_guess,
          ai_loading: false,
          ai_error: null,
        };
      });
    }
    return [emptyRow()];
  });

  const [servings, setServings] = useState(defaultServings ? String(defaultServings) : "1");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingMacrosFor, setEditingMacrosFor] = useState<number | null>(null);

  // Live macro recompute: any time a row's qty/unit/entry changes, recompute
  // macros (unless the user has manually overridden them for this meal).
  function recomputeRowMacros(row: IngredientRow): IngredientRow {
    if (row.override) return row;
    if (!row.entry) return row;
    const qtyNum = parseFloat(row.qty);
    if (!isFinite(qtyNum) || qtyNum <= 0) return { ...row, macros: null };
    const grams = gramsForPortion(row.entry, row.unit, qtyNum);
    if (grams === null) return { ...row, macros: null };
    return { ...row, macros: macrosFor(row.entry, row.unit, qtyNum) };
  }

  function updateRow(i: number, patch: Partial<IngredientRow>) {
    setRows((r) => r.map((row, idx) => idx === i ? recomputeRowMacros({ ...row, ...patch }) : row));
  }

  // Rehydrate library entries for prefilled rows (defaultIngredients only
  // carry food_slug, not the full entry). Without the entry, recomputeRowMacros
  // bails and qty edits leave macros frozen. Keeps the saved unit as-is —
  // only onPick resets the unit to the food's default portion.
  useEffect(() => {
    const slugs = [...new Set(
      rows.filter((r) => r.food_slug && !r.entry).map((r) => r.food_slug!),
    )];
    if (slugs.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("food_library")
        .select(FOOD_ENTRY_SELECT)
        .in("slug", slugs);
      if (cancelled || error || !data) return;
      const bySlug = new Map<string, FoodLibraryEntry>();
      for (const r of data as FoodEntryRow[]) bySlug.set(r.slug, entryFromRow(r));
      setRows((rs) => rs.map((row) => {
        if (!row.food_slug || row.entry) return row;
        const entry = bySlug.get(row.food_slug);
        // Slug no longer in the library — clear it so the AI-estimate
        // fallback can take over instead of waiting forever.
        if (!entry) return { ...row, food_slug: null };
        const hydrated: IngredientRow = { ...row, entry };
        if (hydrated.override) return hydrated;
        const qtyNum = parseFloat(hydrated.qty);
        const fresh = isFinite(qtyNum) && qtyNum > 0 ? macrosFor(entry, hydrated.unit, qtyNum) : null;
        // Keep the stored macros when the saved unit can't be resolved to
        // grams — stale-but-plausible beats blank.
        return fresh ? { ...hydrated, macros: fresh, ai_guess: false } : hydrated;
      }));
    })();
    return () => { cancelled = true; };
    // Mount-only: rows added later get their entry from onPick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onPick(i: number, sel: FoodPickerSelection) {
    setRows((rows) => rows.map((row, idx) => {
      if (idx !== i) return row;
      if (sel.entry) {
        // Library hit — pre-fill default unit if the food has one.
        const defaultPortion = sel.entry.portions.find((p) => p.is_default) ?? sel.entry.portions[0];
        const nextUnit = defaultPortion?.unit ?? row.unit ?? "g";
        const next: IngredientRow = {
          ...row,
          item: sel.entry.name,
          food_slug: sel.entry.slug,
          entry: sel.entry,
          unit: nextUnit,
          ai_guess: false,
          ai_error: null,
          override: false,                  // fresh pick → reset override
        };
        return recomputeRowMacros(next);
      }
      // Custom — clear any library state and trigger AI estimate when qty is set.
      const next: IngredientRow = {
        ...row,
        item: sel.name,
        food_slug: null,
        entry: null,
        macros: null,
        ai_guess: false,
        ai_error: null,
        override: false,
      };
      return next;
    }));
  }

  // Available units for a row: the food's library portions first, else fallback.
  function unitsFor(row: IngredientRow): string[] {
    let units: string[];
    if (row.entry?.portions?.length) {
      const fromLib = row.entry.portions.map((p) => p.unit);
      // Always allow g/oz in addition to library portions.
      const extras = ["g", "oz"].filter((u) => !fromLib.includes(u));
      units = [...fromLib, ...extras];
    } else {
      units = [...FALLBACK_UNIT_LIST];
    }
    // The saved unit must stay selectable even when it isn't in the list
    // (legacy units, or a food whose portions changed) — otherwise the
    // <select> silently snaps to the first option and the qty is reinterpreted.
    if (row.unit && !units.includes(row.unit)) units = [row.unit, ...units];
    return units;
  }

  // ── AI fallback for custom (non-library) ingredients ──────────────────────
  async function estimateRowAi(i: number) {
    const row = rows[i];
    if (!row.item.trim() || !row.qty.trim()) return;
    updateRow(i, { ai_loading: true, ai_error: null });
    try {
      const res = await fetch("/api/macros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredients: [{ item: row.item, qty: `${row.qty} ${row.unit}`.trim() }],
          servings: 1,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      // Skip rows that got a library entry while the request was in flight
      // (mount rehydration) — library macros beat the AI guess.
      setRows((rs) => rs.map((r, idx) => idx === i && !r.entry ? {
        ...r,
        macros: {
          calories: Math.round(json.calories || 0),
          protein: Math.round(json.protein || 0),
          carbs: Math.round(json.carbs || 0),
          fat: Math.round(json.fat || 0),
          // /api/macros doesn't estimate fiber; unknown, not zero.
          fiber: null,
        },
        ai_guess: true,
        ai_loading: false,
        ai_error: null,
        override: false,
      } : r));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI estimate failed";
      updateRow(i, { ai_loading: false, ai_error: msg });
    }
  }

  // Auto-trigger AI estimate for custom items when qty + name are present
  // and no macros yet exist for that row.
  useEffect(() => {
    rows.forEach((row, i) => {
      if (
        !row.entry &&
        !row.food_slug &&   // slugged rows are waiting on library rehydration
        row.item.trim() &&
        row.qty.trim() &&
        !row.macros &&
        !row.ai_loading &&
        !row.ai_error
      ) {
        estimateRowAi(i);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => `${r.item}|${r.qty}|${r.unit}|${!!r.entry}|${!!r.food_slug}|${!!r.macros}`).join("§")]);

  const totals = useMemo(() => {
    const ingredients: Ingredient[] = rows
      .filter((r) => r.item.trim() && r.macros)
      .map((r) => ({ item: r.item, qty: r.qty, unit: r.unit, macros: r.macros! }));
    return sumMacros(ingredients);
  }, [rows]);

  function buildPayload() {
    const srv = parseFloat(servings) || 1;
    const valid = rows.filter((r) => r.item.trim() && r.qty.trim());
    const fullBatch: Ingredient[] = valid.map((r) => ({
      item: r.item,
      qty: r.qty,
      unit: r.unit,
      food_slug: r.food_slug,
      macros: r.macros ?? undefined,
      ai_guess: r.ai_guess || undefined,
    }));

    if (mode === "batch") {
      return {
        name: name.trim(),
        recipe: valid.map((r) => `${r.qty} ${r.unit} ${r.item}`).join(", "),
        ingredients: fullBatch,
        calories: totals.calories,
        protein: totals.protein,
        carbs: totals.carbs,
        fat: totals.fat,
        fiber: totals.fiber,
        fiberPartial: totals.fiberPartial,
        servings: srv,
      };
    }

    // Recipe: store per-serving quantities, so logging × servings = full batch.
    const perServing: Ingredient[] = valid.map((r) => {
      const num = parseFloat(r.qty);
      const divided = !isNaN(num) && srv > 1
        ? parseFloat((num / srv).toFixed(3)).toString()
        : r.qty;
      const scaledMacros: IngredientMacros | undefined = r.macros && srv > 1 ? {
        calories: round1(r.macros.calories / srv),
        protein: round1(r.macros.protein / srv),
        carbs: round1(r.macros.carbs / srv),
        fat: round1(r.macros.fat / srv),
        fiber: r.macros.fiber == null ? null : round1(r.macros.fiber / srv),
      } : r.macros ?? undefined;
      return {
        item: r.item,
        qty: divided,
        unit: r.unit,
        food_slug: r.food_slug,
        macros: scaledMacros,
        ai_guess: r.ai_guess || undefined,
      };
    });
    const recipeTotals: IngredientMacros = srv > 1 ? {
      calories: round1(totals.calories / srv),
      protein: round1(totals.protein / srv),
      carbs: round1(totals.carbs / srv),
      fat: round1(totals.fat / srv),
      fiber: totals.fiber == null ? null : round1(totals.fiber / srv),
    } : totals;
    return {
      name: name.trim(),
      recipe: valid.map((r) => `${r.qty} ${r.unit} ${r.item}`).join(", "),
      ingredients: perServing,
      calories: recipeTotals.calories,
      protein: recipeTotals.protein,
      carbs: recipeTotals.carbs,
      fat: recipeTotals.fat,
      fiber: recipeTotals.fiber,
      fiberPartial: totals.fiberPartial,
    };
  }

  function apply() {
    if (!name.trim()) return;
    onBuild(buildPayload());
  }

  async function saveToRecipes() {
    if (!name.trim()) return;
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const payload = buildPayload();
      await supabase.from("meal_recipes").insert({ ...payload, user_id: user.id });
      setSaved(true);
    }
    setSaving(false);
  }

  // Show defaultMacros block (e.g. when an existing batch is being edited and
  // came in with totals but no per-ingredient breakdown yet — we still want
  // to surface the inherited totals before the user adds rows). Otherwise
  // totals are always derived.
  const showInheritedTotals = !!defaultMacros && rows.every((r) => !r.macros);

  return (
    <div style={{ background: "#101013", border: "1px solid #2a2a2e", borderRadius: 12, padding: 14, marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.05em" }}>
          BUILD MEAL
        </div>
        <button onClick={onCancel} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}>
          <X size={16} />
        </button>
      </div>

      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Meal name (e.g. Eggs & Rice)"
        style={{ ...inputStyle, marginBottom: 12 }}
      />

      <div style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em", marginBottom: 6 }}>
        INGREDIENTS
      </div>

      {rows.map((row, i) => (
        <IngredientRowView
          key={i}
          row={row}
          rowIndex={i}
          unitsAvailable={unitsFor(row)}
          editingMacros={editingMacrosFor === i}
          canRemove={rows.length > 1}
          onPick={(sel) => onPick(i, sel)}
          onChange={(patch) => updateRow(i, patch)}
          onRemove={() => setRows((r) => r.filter((_, idx) => idx !== i))}
          onRetryAi={() => estimateRowAi(i)}
          onStartEdit={() => setEditingMacrosFor(i)}
          onStopEdit={() => setEditingMacrosFor(null)}
          onMacrosOverride={(macros) => {
            setRows((rs) => rs.map((r, idx) => idx === i ? {
              ...r, macros, override: true,
            } : r));
          }}
        />
      ))}

      <button onClick={() => setRows((r) => [...r, emptyRow()])} style={{ ...ghostBtnStyle, marginBottom: 12, fontSize: 13 }}>
        <Plus size={13} /> Add ingredient
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
          {mode === "batch" ? "Yields ~servings (estimate):" : "Recipe makes (servings):"}
        </div>
        <input value={servings} onChange={(e) => setServings(e.target.value)} inputMode="decimal" style={{ ...inputStyle, width: 60 }} />
      </div>

      {/* Locked totals (derived) */}
      <div style={{ background: "#0a0a0d", border: "1px solid #2a2a2e", borderRadius: 10, padding: 10, marginBottom: 10 }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em", marginBottom: 6 }}>
          {mode === "batch" ? "BATCH TOTAL" : "PER RECIPE"} (sum of ingredients)
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {(["calories", "protein", "carbs", "fat"] as const).map((k) => {
            const fromTotals = totals[k];
            const value = showInheritedTotals && defaultMacros ? defaultMacros[k] : fromTotals;
            return (
              <div key={k} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 600 }}>
                  {Math.round(value)}
                </div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 9.5, color: "var(--muted)", marginTop: 2, textTransform: "uppercase" }}>
                  {k === "calories" ? "kcal" : k}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button onClick={apply} disabled={!name.trim()} style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center" }}>
          <Check size={14} /> {applyLabel ?? (mode === "batch" ? "Save batch" : "Save")}
        </button>

        {showSaveToRecipes && mode !== "batch" && (
          <button
            onClick={saveToRecipes}
            disabled={!name.trim() || saving || saved}
            style={{ ...ghostBtnStyle, width: "100%", justifyContent: "center", fontSize: 13, color: saved ? "#7fd494" : "var(--muted)" }}
          >
            <BookmarkPlus size={14} />
            {saved ? "Saved to My Recipes!" : saving ? "Saving…" : "Save to My Recipes"}
          </button>
        )}
      </div>
    </div>
  );
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ─── Single ingredient row ────────────────────────────────────────────────────

interface RowProps {
  row: IngredientRow;
  rowIndex: number;
  unitsAvailable: string[];
  editingMacros: boolean;
  canRemove: boolean;
  onPick: (sel: FoodPickerSelection) => void;
  onChange: (patch: Partial<IngredientRow>) => void;
  onRemove: () => void;
  onRetryAi: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onMacrosOverride: (macros: IngredientMacros) => void;
}

function IngredientRowView({
  row, unitsAvailable, editingMacros, canRemove,
  onPick, onChange, onRemove, onRetryAi, onStartEdit, onStopEdit, onMacrosOverride,
}: RowProps) {
  const [editing, setEditing] = useState<{ calories: string; protein: string; carbs: string; fat: string }>(() => ({
    calories: row.macros ? String(Math.round(row.macros.calories)) : "",
    protein: row.macros ? String(Math.round(row.macros.protein)) : "",
    carbs: row.macros ? String(Math.round(row.macros.carbs)) : "",
    fat: row.macros ? String(Math.round(row.macros.fat)) : "",
  }));

  useEffect(() => {
    if (!editingMacros && row.macros) {
      setEditing({
        calories: String(Math.round(row.macros.calories)),
        protein: String(Math.round(row.macros.protein)),
        carbs: String(Math.round(row.macros.carbs)),
        fat: String(Math.round(row.macros.fat)),
      });
    }
  }, [row.macros, editingMacros]);

  return (
    <div style={{ marginBottom: 8, border: "1px solid #1f1f23", borderRadius: 10, padding: 8 }}>
      {/* row 1: picker spans full width (+ remove). row 2: qty + unit. */}
      <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FoodPicker
            value={{ slug: row.food_slug, name: row.item, custom: !row.entry && !!row.item, entry: row.entry }}
            onChange={onPick}
            placeholder="Search foods…"
          />
        </div>
        {canRemove && (
          <button
            onClick={onRemove}
            aria-label="Remove ingredient"
            style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: "0 4px", flexShrink: 0 }}
          >
            <X size={14} />
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
        <input
          value={row.qty}
          onChange={(e) => onChange({ qty: e.target.value })}
          placeholder="Amt"
          inputMode="decimal"
          style={{ ...inputStyle, width: 72, flexShrink: 0 }}
        />
        <select
          value={row.unit}
          onChange={(e) => onChange({ unit: e.target.value })}
          style={{ ...inputStyle, width: 96, flexShrink: 0, cursor: "pointer", appearance: "none", paddingRight: 6 }}
        >
          {unitsAvailable.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>

      {/* Per-ingredient macros line */}
      {!editingMacros && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {row.macros ? (
            <>
              <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)" }}>
                <span style={{ color: "var(--ink)", fontWeight: 600 }}>{Math.round(row.macros.calories)}</span> kcal · {" "}
                <span style={{ color: "var(--ink)" }}>{Math.round(row.macros.protein)}P</span> / {" "}
                <span style={{ color: "var(--ink)" }}>{Math.round(row.macros.carbs)}C</span> / {" "}
                <span style={{ color: "var(--ink)" }}>{Math.round(row.macros.fat)}F</span> / {" "}
                <span style={{ color: "var(--ink)" }}>
                  {row.macros.fiber == null ? "—" : Math.round(row.macros.fiber)}Fib
                </span>
              </span>
              {row.ai_guess && (
                <span style={{
                  fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
                  color: "#f4c178", background: "rgba(244,193,120,0.12)",
                  border: "1px solid rgba(244,193,120,0.4)", padding: "2px 6px", borderRadius: 10,
                  display: "inline-flex", alignItems: "center", gap: 3,
                }}>
                  <AlertTriangle size={10} /> AI ESTIMATE
                </span>
              )}
              {row.override && (
                <span style={{
                  fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
                  color: "var(--muted)", border: "1px solid #2a2a2e",
                  padding: "2px 6px", borderRadius: 10,
                }}>
                  OVERRIDDEN
                </span>
              )}
              <button
                onClick={onStartEdit}
                aria-label="Edit macros"
                style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 2 }}
              >
                <Pencil size={12} />
              </button>
              {row.ai_guess && !row.override && (
                <button
                  onClick={onRetryAi}
                  aria-label="Re-estimate"
                  style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 2 }}
                >
                  <RefreshCw size={12} />
                </button>
              )}
            </>
          ) : (
            <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)" }}>
              {row.ai_loading ? "Estimating…" : row.ai_error ? row.ai_error : row.item ? "Set a quantity to see macros." : "Pick a food to see macros."}
            </span>
          )}
        </div>
      )}

      {/* Macros override editor */}
      {editingMacros && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 10.5, color: "var(--muted)", letterSpacing: "0.05em" }}>
            Override macros (this meal only)
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["calories", "protein", "carbs", "fat"] as const).map((k) => (
              <div key={k} style={{ flex: 1 }}>
                <input
                  value={editing[k]}
                  onChange={(e) => setEditing((m) => ({ ...m, [k]: e.target.value }))}
                  inputMode="decimal"
                  style={{ ...inputStyle, padding: "6px 6px", fontSize: 12, textAlign: "center" }}
                />
                <div style={{ fontFamily: "var(--font-body)", fontSize: 9, color: "var(--muted)", textAlign: "center", marginTop: 2, textTransform: "uppercase" }}>
                  {k === "calories" ? "kcal" : k}
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => {
                onMacrosOverride({
                  calories: parseFloat(editing.calories) || 0,
                  protein: parseFloat(editing.protein) || 0,
                  carbs: parseFloat(editing.carbs) || 0,
                  fat: parseFloat(editing.fat) || 0,
                });
                onStopEdit();
              }}
              style={{ ...primaryBtnStyle, flex: 1, justifyContent: "center", padding: "6px 10px", fontSize: 12 }}
            >
              <Check size={12} /> Save override
            </button>
            <button onClick={onStopEdit} style={{ ...ghostBtnStyle, padding: "6px 10px", fontSize: 12 }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
