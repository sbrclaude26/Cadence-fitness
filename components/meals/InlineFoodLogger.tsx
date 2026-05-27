"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ScanLine, X, ChefHat, AlertTriangle, Plus } from "lucide-react";
import { inputStyle, primaryBtnStyle, ghostBtnStyle } from "@/components/ui/styles";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import { FoodPicker, type FoodPickerSelection } from "@/components/meals/FoodPicker";
import { gramsForPortion, macrosFor, sumMacros, FALLBACK_UNIT_LIST } from "@/lib/foodLibrary";
import type { FoodLibraryEntry, Ingredient, IngredientMacros } from "@/lib/types";

export interface FoodForm {
  name: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

interface BuildRow {
  item: string;
  qty: string;
  unit: string;
  food_slug: string | null;
  entry: FoodLibraryEntry | null;
  macros: IngredientMacros | null;
  ai_guess: boolean;
  ai_loading: boolean;
  ai_error: string | null;
}

const emptyForm = (): FoodForm => ({ name: "", calories: "", protein: "", carbs: "", fat: "" });
const emptyBuildRow = (): BuildRow => ({
  item: "", qty: "", unit: "g", food_slug: null, entry: null,
  macros: null, ai_guess: false, ai_loading: false, ai_error: null,
});

type LogMode = "choose" | "scan" | "manual" | "build";

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
  const [rows, setRows] = useState<BuildRow[]>([emptyBuildRow()]);
  const [logging, setLogging] = useState(false);

  const setField = (k: keyof FoodForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleScanned(food: { name: string; calories: number; protein: number; carbs: number; fat: number }) {
    setForm({ name: food.name, calories: String(food.calories), protein: String(food.protein), carbs: String(food.carbs), fat: String(food.fat) });
    setMode("manual");
  }

  function unitsFor(row: BuildRow): string[] {
    if (row.entry?.portions?.length) {
      const fromLib = row.entry.portions.map((p) => p.unit);
      const extras = ["g", "oz"].filter((u) => !fromLib.includes(u));
      return [...fromLib, ...extras];
    }
    return [...FALLBACK_UNIT_LIST];
  }

  function recompute(row: BuildRow): BuildRow {
    if (!row.entry) return row;
    const qtyNum = parseFloat(row.qty);
    if (!isFinite(qtyNum) || qtyNum <= 0) return { ...row, macros: null };
    const grams = gramsForPortion(row.entry, row.unit, qtyNum);
    if (grams === null) return { ...row, macros: null };
    return { ...row, macros: macrosFor(row.entry, row.unit, qtyNum) };
  }

  function updateRow(i: number, patch: Partial<BuildRow>) {
    setRows((rs) => rs.map((r, idx) => idx === i ? recompute({ ...r, ...patch }) : r));
  }

  function onPick(i: number, sel: FoodPickerSelection) {
    setRows((rows) => rows.map((row, idx) => {
      if (idx !== i) return row;
      if (sel.entry) {
        const defaultPortion = sel.entry.portions.find((p) => p.is_default) ?? sel.entry.portions[0];
        const nextUnit = defaultPortion?.unit ?? row.unit ?? "g";
        return recompute({
          ...row,
          item: sel.entry.name,
          food_slug: sel.entry.slug,
          entry: sel.entry,
          unit: nextUnit,
          ai_guess: false,
          ai_error: null,
        });
      }
      return {
        ...row,
        item: sel.name,
        food_slug: null,
        entry: null,
        macros: null,
        ai_guess: false,
        ai_error: null,
      };
    }));
  }

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
      setRows((rs) => rs.map((r, idx) => idx === i ? {
        ...r,
        macros: {
          calories: Math.round(json.calories || 0),
          protein: Math.round(json.protein || 0),
          carbs: Math.round(json.carbs || 0),
          fat: Math.round(json.fat || 0),
        },
        ai_guess: true,
        ai_loading: false,
        ai_error: null,
      } : r));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "AI estimate failed";
      updateRow(i, { ai_loading: false, ai_error: msg });
    }
  }

  useEffect(() => {
    rows.forEach((row, i) => {
      if (!row.entry && row.item.trim() && row.qty.trim() && !row.macros && !row.ai_loading && !row.ai_error) {
        estimateRowAi(i);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.map((r) => `${r.item}|${r.qty}|${r.unit}|${!!r.entry}|${!!r.macros}`).join("§")]);

  const totals = useMemo(() => {
    const ingredients: Ingredient[] = rows
      .filter((r) => r.item.trim() && r.macros)
      .map((r) => ({ item: r.item, qty: r.qty, unit: r.unit, macros: r.macros! }));
    return sumMacros(ingredients);
  }, [rows]);

  function submit() {
    if (logging) return;
    setLogging(true);
    if (mode === "build") {
      const validRows = rows.filter((r) => r.item.trim() && r.macros);
      const fallbackName = validRows.map((r) => r.item).join(", ") || "Custom meal";
      const entry: FoodForm = {
        name: (form.name.trim() || fallbackName),
        calories: String(Math.round(totals.calories)),
        protein: String(Math.round(totals.protein)),
        carbs: String(Math.round(totals.carbs)),
        fat: String(Math.round(totals.fat)),
      };
      onLog(entry);
    } else {
      const entry = form.name.trim() ? form : { ...form, name: "Custom meal" };
      onLog(entry);
    }
    setForm(emptyForm());
    setRows([emptyBuildRow()]);
    setMode("choose");
    setLogging(false);
  }

  const hasAnyMacros = rows.some((r) => r.macros);
  const anyAiGuess = rows.some((r) => r.ai_guess);

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
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            Pick foods from the library; per-ingredient macros come from USDA. Unknown items fall back to an AI estimate.
          </div>

          {rows.map((row, i) => (
            <div key={i} style={{ marginBottom: 8, border: "1px solid #1f1f23", borderRadius: 10, padding: 8 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FoodPicker
                    value={{ slug: row.food_slug, name: row.item, custom: !row.entry && !!row.item, entry: row.entry }}
                    onChange={(sel) => onPick(i, sel)}
                    placeholder="Search foods…"
                  />
                </div>
                {rows.length > 1 && (
                  <button
                    onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
                    style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: "0 4px", flexShrink: 0 }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <input
                  value={row.qty}
                  onChange={(e) => updateRow(i, { qty: e.target.value })}
                  placeholder="Amt"
                  inputMode="decimal"
                  style={{ ...inputStyle, width: 72, flexShrink: 0 }}
                />
                <select
                  value={row.unit}
                  onChange={(e) => updateRow(i, { unit: e.target.value })}
                  style={{ ...inputStyle, width: 96, flexShrink: 0, cursor: "pointer", appearance: "none", paddingRight: 6 }}
                >
                  {unitsFor(row).map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {row.macros ? (
                  <>
                    <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)" }}>
                      <span style={{ color: "var(--ink)", fontWeight: 600 }}>{Math.round(row.macros.calories)}</span> kcal · {" "}
                      <span style={{ color: "var(--ink)" }}>{Math.round(row.macros.protein)}P</span> / {" "}
                      <span style={{ color: "var(--ink)" }}>{Math.round(row.macros.carbs)}C</span> / {" "}
                      <span style={{ color: "var(--ink)" }}>{Math.round(row.macros.fat)}F</span>
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
                  </>
                ) : (
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)" }}>
                    {row.ai_loading ? "Estimating…" : row.ai_error ? row.ai_error : row.item ? "Set a quantity to see macros." : "Pick a food to see macros."}
                  </span>
                )}
              </div>
            </div>
          ))}

          <button onClick={() => setRows((r) => [...r, emptyBuildRow()])} style={{ ...ghostBtnStyle, marginBottom: 10 }}>
            <Plus size={13} /> Add ingredient
          </button>

          <input value={form.name} onChange={setField("name")} placeholder="Meal name (optional)" style={{ ...inputStyle, marginBottom: 8 }} />

          {/* Locked totals */}
          <div style={{ background: "#0a0a0d", border: "1px solid #2a2a2e", borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em" }}>
                MEAL TOTAL
              </div>
              {anyAiGuess && (
                <span style={{
                  fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 600, letterSpacing: "0.04em",
                  color: "#f4c178", display: "inline-flex", alignItems: "center", gap: 3,
                }}>
                  <AlertTriangle size={10} /> CONTAINS AI ESTIMATES
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["calories", "protein", "carbs", "fat"] as const).map((k) => (
                <div key={k} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 16, fontWeight: 600 }}>
                    {Math.round(totals[k])}
                  </div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 9.5, color: "var(--muted)", marginTop: 2, textTransform: "uppercase" }}>
                    {k === "calories" ? "kcal" : k}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button onClick={submit} disabled={logging || !hasAnyMacros} style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center" }}>
            <Check size={14} /> {logging ? "Logging…" : "Log it"}
          </button>
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
