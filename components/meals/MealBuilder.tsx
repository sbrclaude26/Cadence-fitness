"use client";

import { useState } from "react";
import { Plus, X, Check, Loader, BookmarkPlus } from "lucide-react";
import { inputStyle, primaryBtnStyle, ghostBtnStyle } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";
import type { Meal, MealSlot } from "@/lib/types";

interface IngredientRow { item: string; qty: string; unit: string; }

const UNITS = ["g", "oz", "lb", "cup", "tbsp", "tsp", "ml", "piece", "slice", "scoop"];

interface Props {
  mode?: "recipe" | "batch";
  slot?: MealSlot;
  defaultName?: string;
  defaultIngredients?: { item: string; qty: string }[];
  defaultMacros?: { calories: number; protein: number; carbs: number; fat: number };
  defaultServings?: number;
  showSaveToRecipes?: boolean;
  applyLabel?: string;
  onBuild: (meal: Omit<Meal, "slot"> & { servings?: number }) => void;
  onCancel: () => void;
}

export function MealBuilder({ mode = "recipe", slot, defaultName = "", defaultIngredients, defaultMacros, defaultServings, showSaveToRecipes = true, applyLabel, onBuild, onCancel }: Props) {
  const supabase = createClient();
  const [name, setName] = useState(defaultName);
  const [ingredients, setIngredients] = useState<IngredientRow[]>(() => {
    if (defaultIngredients?.length) {
      return defaultIngredients.map((ing) => {
        const s = ing.qty.trim();
        const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)\s*(.*)$/);
        if (mixed) {
          const num = parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
          const unit = mixed[4].trim() || "g";
          return { qty: String(num), unit: UNITS.includes(unit) ? unit : "g", item: ing.item };
        }
        const frac = s.match(/^(\d+)\/(\d+)\s*(.*)$/);
        if (frac) {
          const num = (parseInt(frac[1]) / parseInt(frac[2])).toFixed(2).replace(/\.?0+$/, "");
          const unit = frac[3].trim() || "g";
          return { qty: num, unit: UNITS.includes(unit) ? unit : "g", item: ing.item };
        }
        const plain = s.match(/^(\d*\.?\d+)\s*(.*)$/);
        const unit = plain?.[2]?.trim() || "g";
        return { qty: plain?.[1] ?? s, unit: UNITS.includes(unit) ? unit : "g", item: ing.item };
      });
    }
    return [{ item: "", qty: "", unit: "g" }];
  });
  const [servings, setServings] = useState(defaultServings ? String(defaultServings) : "1");
  const [macros, setMacros] = useState({
    calories: defaultMacros ? String(Math.round(defaultMacros.calories)) : "",
    protein: defaultMacros ? String(Math.round(defaultMacros.protein)) : "",
    carbs: defaultMacros ? String(Math.round(defaultMacros.carbs)) : "",
    fat: defaultMacros ? String(Math.round(defaultMacros.fat)) : "",
  });
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  function updateRow(i: number, key: keyof IngredientRow, val: string) {
    setIngredients((rows) => rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  }

  async function estimate() {
    const valid = ingredients
      .filter((r) => r.item.trim() && r.qty.trim())
      .map((r) => ({ item: r.item, qty: `${r.qty} ${r.unit}`.trim() }));
    if (!valid.length) return;
    setEstimating(true); setError("");
    try {
      // Batch mode always estimates whole-batch totals; recipe mode divides by servings.
      const macroServings = mode === "batch" ? 1 : (parseFloat(servings) || 1);
      const res = await fetch("/api/macros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredients: valid, servings: macroServings }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setMacros({
        calories: String(Math.round(json.calories || 0)),
        protein: String(Math.round(json.protein || 0)),
        carbs: String(Math.round(json.carbs || 0)),
        fat: String(Math.round(json.fat || 0)),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error estimating macros");
    } finally { setEstimating(false); }
  }

  function buildPayload() {
    const srv = parseFloat(servings) || 1;
    const valid = ingredients.filter((r) => r.item.trim() && r.qty.trim());
    const fullBatch = valid.map((r) => ({ item: r.item, qty: `${r.qty} ${r.unit}`.trim() }));
    if (mode === "batch") {
      // Batch: store whole-batch quantities + whole-batch macros. No division.
      return {
        name: name.trim(),
        recipe: fullBatch.map((r) => `${r.qty} ${r.item}`).join(", "),
        ingredients: fullBatch,
        calories: parseFloat(macros.calories) || 0,
        protein: parseFloat(macros.protein) || 0,
        carbs: parseFloat(macros.carbs) || 0,
        fat: parseFloat(macros.fat) || 0,
        servings: srv,
      };
    }
    // Recipe mode: store per-serving quantities so the meal prep ×occurrences scaling is correct.
    const perServing = valid.map((r) => {
      const num = parseFloat(r.qty);
      const divided = !isNaN(num) && srv > 1 ? parseFloat((num / srv).toFixed(3)).toString() : r.qty;
      return { item: r.item, qty: `${divided} ${r.unit}`.trim() };
    });
    return {
      name: name.trim(),
      recipe: fullBatch.map((r) => `${r.qty} ${r.item}`).join(", "),
      ingredients: perServing,
      calories: parseFloat(macros.calories) || 0,
      protein: parseFloat(macros.protein) || 0,
      carbs: parseFloat(macros.carbs) || 0,
      fat: parseFloat(macros.fat) || 0,
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
      await supabase.from("meal_recipes").insert({ ...buildPayload(), user_id: user.id });
      setSaved(true);
    }
    setSaving(false);
  }

  const hasEstimate = !!(macros.calories || macros.protein);
  // Batch mode: always allow manual save so a failed estimate doesn't block the user.
  const showMacrosBlock = hasEstimate || mode === "batch";

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

      {ingredients.map((row, i) => (
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <input
            value={row.qty}
            onChange={(e) => updateRow(i, "qty", e.target.value)}
            placeholder="Amt"
            inputMode="decimal"
            style={{ ...inputStyle, width: 52, flexShrink: 0 }}
          />
          <select
            value={row.unit}
            onChange={(e) => updateRow(i, "unit", e.target.value)}
            style={{ ...inputStyle, width: 72, flexShrink: 0, cursor: "pointer", appearance: "none", paddingRight: 6 }}
          >
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <input
            value={row.item}
            onChange={(e) => updateRow(i, "item", e.target.value)}
            placeholder="Ingredient"
            style={{ ...inputStyle, flex: 1 }}
          />
          {ingredients.length > 1 && (
            <button
              onClick={() => setIngredients((r) => r.filter((_, idx) => idx !== i))}
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: "0 4px", flexShrink: 0 }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}

      <button onClick={() => setIngredients((r) => [...r, { item: "", qty: "", unit: "g" }])} style={{ ...ghostBtnStyle, marginBottom: 12, fontSize: 13 }}>
        <Plus size={13} /> Add ingredient
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
          {mode === "batch" ? "Yields ~servings (estimate):" : "Recipe makes (servings):"}
        </div>
        <input value={servings} onChange={(e) => setServings(e.target.value)} inputMode="decimal" style={{ ...inputStyle, width: 60 }} />
      </div>

      {error && <div style={{ color: "#ff8a6a", fontSize: 12, marginBottom: 8 }}>{error}</div>}

      <button onClick={estimate} disabled={estimating} style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center", marginBottom: 10 }}>
        {estimating ? <><Loader size={14} /> Estimating…</> : "Estimate macros"}
      </button>

      {showMacrosBlock && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {(["calories", "protein", "carbs", "fat"] as const).map((k) => (
              <div key={k} style={{ flex: 1 }}>
                <input
                  value={macros[k]}
                  onChange={(e) => setMacros((m) => ({ ...m, [k]: e.target.value }))}
                  inputMode="decimal"
                  style={{ ...inputStyle, padding: "8px 6px", fontSize: 13, textAlign: "center" }}
                />
                <div style={{ fontFamily: "var(--font-body)", fontSize: 9.5, color: "var(--muted)", textAlign: "center", marginTop: 2, textTransform: "uppercase" }}>
                  {k === "calories" ? "kcal" : k}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button onClick={apply} disabled={!name.trim()} style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center" }}>
              <Check size={14} /> {applyLabel ?? (mode === "batch" ? "Save batch" : `Apply to all ${slot} slots this cycle`)}
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
        </>
      )}
    </div>
  );
}
