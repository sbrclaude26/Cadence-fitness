"use client";

import { useState } from "react";
import { Check, ScanLine, Plus, X } from "lucide-react";
import { MacroLine } from "@/components/ui/MacroLine";
import { checkboxStyle, inputStyle, primaryBtnStyle, ghostBtnStyle } from "@/components/ui/styles";
import { BarcodeScanner } from "@/components/BarcodeScanner";
import type { Meal, MealLog } from "@/lib/types";

interface Props {
  meals: Meal[];
  calorieTarget: number;
  flex: number;
  dayTotals: { calories: number; protein: number; carbs: number; fat: number };
  onLogMeal: (m: Omit<MealLog, "id" | "user_id" | "created_at">) => void;
  date: string;
}

interface FoodForm {
  name: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

const emptyForm = (): FoodForm => ({ name: "", calories: "", protein: "", carbs: "", fat: "" });

function InlineFoodLogger({
  slotLabel,
  onLog,
  onClose,
}: {
  slotLabel: string;
  onLog: (f: FoodForm) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FoodForm>(emptyForm());
  const [scanning, setScanning] = useState(false);

  const set = (k: keyof FoodForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  function handleScanned(food: { name: string; calories: number; protein: number; carbs: number; fat: number }) {
    setForm({
      name: food.name,
      calories: String(food.calories),
      protein: String(food.protein),
      carbs: String(food.carbs),
      fat: String(food.fat),
    });
    setScanning(false);
  }

  function submit() {
    if (!form.name) return;
    onLog(form);
    setForm(emptyForm());
  }

  return (
    <div style={{ background: "#101013", border: "1px solid #2a2a2e", borderRadius: 10, padding: 12, marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.05em" }}>
          LOG {slotLabel.toUpperCase()}
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0 }}>
          <X size={16} />
        </button>
      </div>

      {scanning ? (
        <BarcodeScanner onResult={handleScanned} onClose={() => setScanning(false)} />
      ) : (
        <>
          <button onClick={() => setScanning(true)} style={{ ...ghostBtnStyle, width: "100%", justifyContent: "center", marginBottom: 10 }}>
            <ScanLine size={15} /> Scan barcode
          </button>

          <input
            value={form.name}
            onChange={set("name")}
            placeholder="What did you eat?"
            style={{ ...inputStyle, marginBottom: 8 }}
          />

          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {(["calories", "protein", "carbs", "fat"] as const).map((k) => (
              <div key={k} style={{ flex: 1 }}>
                <input
                  value={form[k]}
                  onChange={set(k)}
                  inputMode="decimal"
                  placeholder="0"
                  style={{ ...inputStyle, padding: "8px 6px", fontSize: 13, textAlign: "center" }}
                />
                <div style={{ fontFamily: "var(--font-body)", fontSize: 9.5, color: "var(--muted)", textAlign: "center", marginTop: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  {k === "calories" ? "kcal" : k}
                </div>
              </div>
            ))}
          </div>

          <button onClick={submit} disabled={!form.name} style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center" }}>
            <Check size={14} /> Log it
          </button>
        </>
      )}
    </div>
  );
}

export function TodayMeals({ meals, calorieTarget, flex, dayTotals, onLogMeal, date }: Props) {
  const [logged, setLogged] = useState<Record<number, boolean>>({});
  const [altOpen, setAltOpen] = useState<Partial<Record<number | "extra", boolean>>>({});

  function logPlanned(i: number, m: Meal) {
    if (!logged[i]) {
      onLogMeal({ date, name: m.name, calories: m.calories, protein: m.protein, carbs: m.carbs, fat: m.fat, planned: true });
    }
    setLogged((s) => ({ ...s, [i]: !s[i] }));
  }

  function logAlt(slot: string, form: FoodForm) {
    onLogMeal({
      date,
      name: form.name,
      calories: parseFloat(form.calories) || 0,
      protein: parseFloat(form.protein) || 0,
      carbs: parseFloat(form.carbs) || 0,
      fat: parseFloat(form.fat) || 0,
      planned: false,
    });
    setAltOpen((s) => ({ ...s, [slot]: false }));
  }

  return (
    <div style={{ marginTop: 4 }}>
      {meals.map((m, i) => (
        <div key={i} style={{ padding: "10px 0", borderBottom: "1px solid #232327" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", opacity: logged[i] ? 0.5 : 1 }}>
            <div style={{ flex: 1, paddingRight: 8 }}>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 10.5, color: "var(--accent)", letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 700 }}>
                {m.slot}
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 600, textDecoration: logged[i] ? "line-through" : "none" }}>
                {m.name}
              </div>
              <MacroLine cal={m.calories} protein={m.protein} carbs={m.carbs} fat={m.fat} />
            </div>
            <button onClick={() => logPlanned(i, m)} style={checkboxStyle(logged[i])}>
              {logged[i] && <Check size={14} />}
            </button>
          </div>

          {!logged[i] && (
            altOpen[i] ? (
              <InlineFoodLogger
                slotLabel={m.slot}
                onLog={(form) => logAlt(m.slot, form)}
                onClose={() => setAltOpen((s) => ({ ...s, [i]: false }))}
              />
            ) : (
              <button
                onClick={() => setAltOpen((s) => ({ ...s, [i]: true }))}
                style={{ background: "none", border: "none", color: "var(--muted)", fontFamily: "var(--font-body)", fontSize: 12, cursor: "pointer", padding: "4px 0 0", textDecoration: "underline" }}
              >
                Ate something else
              </button>
            )
          )}
        </div>
      ))}

      {altOpen["extra"] ? (
        <InlineFoodLogger
          slotLabel="extra"
          onLog={(form) => logAlt("extra", form)}
          onClose={() => setAltOpen((s) => ({ ...s, extra: false }))}
        />
      ) : (
        <button
          onClick={() => setAltOpen((s) => ({ ...s, extra: true }))}
          style={{ ...ghostBtnStyle, marginTop: 10, width: "100%", justifyContent: "center" }}
        >
          <Plus size={14} /> Add food
        </button>
      )}

      {flex > 150 && (
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", paddingTop: 10 }}>
          + ~{Math.round(flex)} kcal flex (your choice) to hit target.
        </div>
      )}
      <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--ink)", paddingTop: 8, fontWeight: 600 }}>
        Day total: {Math.round(dayTotals.calories)} kcal · P{Math.round(dayTotals.protein)} C{Math.round(dayTotals.carbs)} F{Math.round(dayTotals.fat)}
      </div>
    </div>
  );
}

export function computeDayTotals(meals: Meal[]) {
  return meals.reduce(
    (t, m) => ({ calories: t.calories + m.calories, protein: t.protein + m.protein, carbs: t.carbs + m.carbs, fat: t.fat + m.fat }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}
