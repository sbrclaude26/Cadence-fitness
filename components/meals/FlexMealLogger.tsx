"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { MacroLine } from "@/components/ui/MacroLine";
import { InlineFoodLogger } from "@/components/meals/InlineFoodLogger";
import { ghostBtnStyle } from "@/components/ui/styles";
import type { Meal, MealLog, MealSlot } from "@/lib/types";

const SLOTS: MealSlot[] = ["Breakfast", "Lunch", "Dinner", "Snack"];

function currentSlot(): MealSlot {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return "Breakfast";
  if (h >= 11 && h < 15) return "Lunch";
  if (h >= 15 && h < 19) return "Dinner";
  return "Snack";
}

interface Props {
  prepMeals: Meal[];
  loggedMeals: MealLog[];
  calorieTarget: number;
  onLogMeal: (m: Omit<MealLog, "id" | "user_id" | "created_at">) => void;
  date: string;
}

export function FlexMealLogger({ prepMeals, loggedMeals, calorieTarget, onLogMeal, date }: Props) {
  const [slot, setSlot] = useState<MealSlot>(currentSlot());
  const [showAll, setShowAll] = useState(false);
  const [altOpen, setAltOpen] = useState(false);
  const [justLogged, setJustLogged] = useState<string | null>(null);

  const slotMeals = prepMeals.filter((m) => m.slot === slot);
  const otherMeals = prepMeals.filter((m) => m.slot !== slot);
  const visibleMeals = showAll ? prepMeals : slotMeals;

  const totalCal = loggedMeals.reduce((s, m) => s + (m.calories || 0), 0);
  const totalProt = loggedMeals.reduce((s, m) => s + (m.protein || 0), 0);
  const totalCarbs = loggedMeals.reduce((s, m) => s + (m.carbs || 0), 0);
  const totalFat = loggedMeals.reduce((s, m) => s + (m.fat || 0), 0);

  function logPrep(meal: Meal) {
    onLogMeal({ date, name: meal.name, calories: meal.calories, protein: meal.protein, carbs: meal.carbs, fat: meal.fat, planned: true });
    setJustLogged(meal.name);
    setTimeout(() => setJustLogged(null), 1500);
  }

  return (
    <div>
      {/* Slot tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, background: "#101013", border: "1px solid #2a2a2e", borderRadius: 12, padding: 4 }}>
        {SLOTS.map((s) => (
          <button key={s} onClick={() => { setSlot(s); setShowAll(false); setAltOpen(false); }} style={{
            flex: 1, padding: "8px 0", borderRadius: 9, border: "none", cursor: "pointer",
            fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 11.5,
            background: slot === s ? "var(--accent)" : "transparent",
            color: slot === s ? "#140a06" : "var(--muted)",
          }}>
            {s}
          </button>
        ))}
      </div>

      {/* Logged meals today */}
      {loggedMeals.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {loggedMeals.map((m) => (
            <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #1e1e22" }}>
              <div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600 }}>{m.name}</div>
                <MacroLine cal={m.calories} protein={m.protein} carbs={m.carbs} fat={m.fat} />
              </div>
              <Check size={14} style={{ color: "#7fd494", flexShrink: 0 }} />
            </div>
          ))}
        </div>
      )}

      {/* Prep meal picker */}
      {visibleMeals.length > 0 ? (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em", marginBottom: 8 }}>
            {showAll ? "ALL MEAL PREP" : `${slot.toUpperCase()} MEAL PREP`}
          </div>
          {visibleMeals.map((meal) => (
            <button
              key={meal.name}
              onClick={() => logPrep(meal)}
              style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                width: "100%", padding: "10px 12px", marginBottom: 6,
                background: justLogged === meal.name ? "#1a2e1a" : "#101013",
                border: `1px solid ${justLogged === meal.name ? "#7fd494" : "#2a2a2e"}`,
                borderRadius: 10, cursor: "pointer", textAlign: "left", transition: "border-color 0.2s",
              }}
            >
              <div style={{ flex: 1, paddingRight: 8 }}>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 13.5, fontWeight: 600, color: "var(--ink)", marginBottom: 2 }}>
                  {meal.name}
                </div>
                <MacroLine cal={meal.calories} protein={meal.protein} carbs={meal.carbs} fat={meal.fat} />
              </div>
              {justLogged === meal.name
                ? <Check size={16} style={{ color: "#7fd494", flexShrink: 0 }} />
                : <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 13, color: "var(--accent)", flexShrink: 0 }}>+</div>
              }
            </button>
          ))}
        </div>
      ) : (
        <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", marginBottom: 10 }}>
          No {slot.toLowerCase()} meals in your prep. Pick from another slot or log something else.
        </div>
      )}

      {/* Show all / show less toggle */}
      {otherMeals.length > 0 && (
        <button onClick={() => setShowAll((v) => !v)} style={{ ...ghostBtnStyle, marginBottom: 10, fontSize: 12 }}>
          {showAll ? <><ChevronUp size={13} /> Show {slot} only</> : <><ChevronDown size={13} /> Show all prep meals</>}
        </button>
      )}

      {/* Ate something else */}
      {altOpen ? (
        <InlineFoodLogger
          slotLabel={slot}
          onLog={(form) => {
            onLogMeal({ date, name: form.name, calories: parseFloat(form.calories) || 0, protein: parseFloat(form.protein) || 0, carbs: parseFloat(form.carbs) || 0, fat: parseFloat(form.fat) || 0, planned: false });
            setAltOpen(false);
          }}
          onClose={() => setAltOpen(false)}
        />
      ) : (
        <button onClick={() => setAltOpen(true)} style={{ background: "none", border: "none", color: "var(--muted)", fontFamily: "var(--font-body)", fontSize: 12.5, cursor: "pointer", padding: "4px 0", textDecoration: "underline" }}>
          Ate something else
        </button>
      )}

      {/* Day total */}
      {loggedMeals.length > 0 && (
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--ink)", paddingTop: 12, marginTop: 8, borderTop: "1px solid #232327", fontWeight: 600 }}>
          Today: {Math.round(totalCal)} / {calorieTarget} kcal · P{Math.round(totalProt)} C{Math.round(totalCarbs)} F{Math.round(totalFat)}
        </div>
      )}
    </div>
  );
}
