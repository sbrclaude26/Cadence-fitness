"use client";

import { useState } from "react";
import { Check, ScanLine, Plus, X, ChefHat, Loader } from "lucide-react";
import { inputStyle, primaryBtnStyle, ghostBtnStyle } from "@/components/ui/styles";
import { BarcodeScanner } from "@/components/BarcodeScanner";

export interface FoodForm {
  name: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

interface IngredientRow { item: string; qty: string; }

type LogMode = "choose" | "scan" | "manual" | "build";

const emptyForm = (): FoodForm => ({ name: "", calories: "", protein: "", carbs: "", fat: "" });

export function InlineFoodLogger({
  slotLabel,
  onLog,
  onClose,
}: {
  slotLabel: string;
  onLog: (f: FoodForm) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<LogMode>("choose");
  const [form, setForm] = useState<FoodForm>(emptyForm());
  const [ingredients, setIngredients] = useState<IngredientRow[]>([{ item: "", qty: "" }]);
  const [servings, setServings] = useState("1");
  const [estimating, setEstimating] = useState(false);
  const [estimateError, setEstimateError] = useState("");

  const setField = (k: keyof FoodForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleScanned(food: { name: string; calories: number; protein: number; carbs: number; fat: number }) {
    setForm({ name: food.name, calories: String(food.calories), protein: String(food.protein), carbs: String(food.carbs), fat: String(food.fat) });
    setMode("manual");
  }

  function updateIngredient(i: number, key: keyof IngredientRow, val: string) {
    setIngredients((rows) => rows.map((r, idx) => idx === i ? { ...r, [key]: val } : r));
  }

  async function estimateMacros() {
    const valid = ingredients.filter((r) => r.item.trim() && r.qty.trim());
    if (!valid.length) return;
    setEstimating(true); setEstimateError("");
    try {
      const res = await fetch("/api/macros", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ingredients: valid, servings: parseFloat(servings) || 1 }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setForm((f) => ({ ...f, calories: String(Math.round(json.calories || 0)), protein: String(Math.round(json.protein || 0)), carbs: String(Math.round(json.carbs || 0)), fat: String(Math.round(json.fat || 0)) }));
    } catch (e) {
      setEstimateError(e instanceof Error ? e.message : "Error estimating macros");
    } finally { setEstimating(false); }
  }

  function submit() {
    if (!form.name) return;
    onLog(form); setForm(emptyForm()); setMode("choose");
  }

  return (
    <div style={{ background: "#101013", border: "1px solid #2a2a2e", borderRadius: 10, padding: 12, marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.05em" }}>
          LOG {slotLabel.toUpperCase()}
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}><X size={16} /></button>
      </div>

      {mode === "choose" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={() => setMode("scan")} style={{ ...ghostBtnStyle, justifyContent: "center" }}><ScanLine size={15} /> Scan barcode</button>
          <button onClick={() => setMode("build")} style={{ ...ghostBtnStyle, justifyContent: "center" }}><ChefHat size={15} /> Build from ingredients</button>
          <button onClick={() => setMode("manual")} style={{ background: "none", border: "none", color: "var(--muted)", fontFamily: "var(--font-body)", fontSize: 12, cursor: "pointer", textDecoration: "underline", padding: "4px 0" }}>Enter macros manually</button>
        </div>
      )}

      {mode === "scan" && <BarcodeScanner onResult={handleScanned} onClose={() => setMode("choose")} />}

      {mode === "build" && (
        <>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>List your ingredients — Claude will estimate the macros.</div>
          {ingredients.map((row, i) => (
            <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
              <input value={row.qty} onChange={(e) => updateIngredient(i, "qty", e.target.value)} placeholder="Amount" style={{ ...inputStyle, width: 80, flexShrink: 0 }} />
              <input value={row.item} onChange={(e) => updateIngredient(i, "item", e.target.value)} placeholder="Ingredient" style={{ ...inputStyle, flex: 1 }} />
              {ingredients.length > 1 && <button onClick={() => setIngredients((r) => r.filter((_, idx) => idx !== i))} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: "0 4px" }}><X size={14} /></button>}
            </div>
          ))}
          <button onClick={() => setIngredients((r) => [...r, { item: "", qty: "" }])} style={{ ...ghostBtnStyle, marginBottom: 10 }}><Plus size={13} /> Add ingredient</button>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>Servings eating:</div>
            <input value={servings} onChange={(e) => setServings(e.target.value)} inputMode="decimal" style={{ ...inputStyle, width: 60 }} />
          </div>
          {estimateError && <div style={{ color: "#ff8a6a", fontSize: 12, marginBottom: 8 }}>{estimateError}</div>}
          <button onClick={estimateMacros} disabled={estimating} style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center", marginBottom: 8 }}>
            {estimating ? <><Loader size={14} /> Estimating…</> : "Estimate macros"}
          </button>
          {(form.calories || form.protein) && (
            <>
              <input value={form.name} onChange={setField("name")} placeholder="Meal name (optional)" style={{ ...inputStyle, marginBottom: 8 }} />
              <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                {(["calories", "protein", "carbs", "fat"] as const).map((k) => (
                  <div key={k} style={{ flex: 1 }}>
                    <input value={form[k]} onChange={setField(k)} inputMode="decimal" style={{ ...inputStyle, padding: "8px 6px", fontSize: 13, textAlign: "center" }} />
                    <div style={{ fontFamily: "var(--font-body)", fontSize: 9.5, color: "var(--muted)", textAlign: "center", marginTop: 2, textTransform: "uppercase" }}>{k === "calories" ? "kcal" : k}</div>
                  </div>
                ))}
              </div>
              <button onClick={submit} style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center" }}><Check size={14} /> Log it</button>
            </>
          )}
        </>
      )}

      {mode === "manual" && (
        <>
          <input value={form.name} onChange={setField("name")} placeholder="What did you eat?" style={{ ...inputStyle, marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {(["calories", "protein", "carbs", "fat"] as const).map((k) => (
              <div key={k} style={{ flex: 1 }}>
                <input value={form[k]} onChange={setField(k)} inputMode="decimal" placeholder="0" style={{ ...inputStyle, padding: "8px 6px", fontSize: 13, textAlign: "center" }} />
                <div style={{ fontFamily: "var(--font-body)", fontSize: 9.5, color: "var(--muted)", textAlign: "center", marginTop: 2, textTransform: "uppercase" }}>{k === "calories" ? "kcal" : k}</div>
              </div>
            ))}
          </div>
          <button onClick={submit} disabled={!form.name} style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center" }}><Check size={14} /> Log it</button>
        </>
      )}
    </div>
  );
}
