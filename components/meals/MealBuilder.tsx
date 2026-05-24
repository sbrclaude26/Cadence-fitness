"use client";

import { useState } from "react";
import { Plus, X, Check, Loader } from "lucide-react";
import { inputStyle, primaryBtnStyle, ghostBtnStyle } from "@/components/ui/styles";
import type { Meal, MealSlot } from "@/lib/types";

interface IngredientRow { item: string; qty: string; }

interface Props {
  slot: MealSlot;
  defaultName?: string;
  onBuild: (meal: Omit<Meal, "slot">) => void;
  onCancel: () => void;
}

export function MealBuilder({ slot, defaultName = "", onBuild, onCancel }: Props) {
  const [name, setName] = useState(defaultName);
  const [ingredients, setIngredients] = useState<IngredientRow[]>([{ item: "", qty: "" }]);
  const [servings, setServings] = useState("1");
  const [macros, setMacros] = useState({ calories: "", protein: "", carbs: "", fat: "" });
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState("");

  function updateRow(i: number, key: keyof IngredientRow, val: string) {
    setIngredients((rows) => rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  }

  async function estimate() {
    const valid = ingredients.filter((r) => r.item.trim() && r.qty.trim());
    if (!valid.length) return;
    setEstimating(true);
    setError("");
    try {
      const res = await fetch("/api/macros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredients: valid, servings: parseFloat(servings) || 1 }),
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
    } finally {
      setEstimating(false);
    }
  }

  function apply() {
    if (!name.trim()) return;
    const valid = ingredients.filter((r) => r.item.trim() && r.qty.trim());
    const recipe = valid.map((r) => `${r.qty} ${r.item}`).join(", ");
    onBuild({
      name: name.trim(),
      recipe,
      ingredients: valid,
      calories: parseFloat(macros.calories) || 0,
      protein: parseFloat(macros.protein) || 0,
      carbs: parseFloat(macros.carbs) || 0,
      fat: parseFloat(macros.fat) || 0,
    });
  }

  const hasEstimate = !!(macros.calories || macros.protein);

  return (
    <div style={{ background: "#101013", border: "1px solid #2a2a2e", borderRadius: 12, padding: 14, marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.05em" }}>
          CUSTOM {slot.toUpperCase()}
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
        <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <input
            value={row.qty}
            onChange={(e) => updateRow(i, "qty", e.target.value)}
            placeholder="Qty"
            style={{ ...inputStyle, width: 72, flexShrink: 0 }}
          />
          <input
            value={row.item}
            onChange={(e) => updateRow(i, "item", e.target.value)}
            placeholder="Ingredient"
            style={{ ...inputStyle, flex: 1 }}
          />
          {ingredients.length > 1 && (
            <button
              onClick={() => setIngredients((r) => r.filter((_, idx) => idx !== i))}
              style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: "0 4px" }}
            >
              <X size={14} />
            </button>
          )}
        </div>
      ))}

      <button
        onClick={() => setIngredients((r) => [...r, { item: "", qty: "" }])}
        style={{ ...ghostBtnStyle, marginBottom: 12, fontSize: 13 }}
      >
        <Plus size={13} /> Add ingredient
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
          Servings eating:
        </div>
        <input
          value={servings}
          onChange={(e) => setServings(e.target.value)}
          inputMode="decimal"
          style={{ ...inputStyle, width: 60 }}
        />
      </div>

      {error && <div style={{ color: "#ff8a6a", fontSize: 12, marginBottom: 8 }}>{error}</div>}

      <button onClick={estimate} disabled={estimating} style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center", marginBottom: 10 }}>
        {estimating ? <><Loader size={14} /> Estimating…</> : "Estimate macros"}
      </button>

      {hasEstimate && (
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
          <button onClick={apply} disabled={!name.trim()} style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center", background: "var(--accent)", color: "#140a06" }}>
            <Check size={14} /> Apply to all {slot} slots this cycle
          </button>
        </>
      )}
    </div>
  );
}
