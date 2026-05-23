"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { MacroLine } from "@/components/ui/MacroLine";
import { checkboxStyle } from "@/components/ui/styles";
import type { Meal, MealLog } from "@/lib/types";
import { CYCLE_DAYS } from "@/lib/config";

interface Props {
  meals: Meal[];
  calorieTarget: number;
  flex: number;
  dayTotals: { calories: number; protein: number; carbs: number; fat: number };
  onLogMeal: (m: Omit<MealLog, "id" | "user_id" | "created_at">) => void;
  date: string;
}

export function TodayMeals({ meals, calorieTarget, flex, dayTotals, onLogMeal, date }: Props) {
  const [logged, setLogged] = useState<Record<number, boolean>>({});

  return (
    <div style={{ marginTop: 4 }}>
      {meals.map((m, i) => (
        <div
          key={i}
          style={{ padding: "10px 0", borderBottom: "1px solid #232327", opacity: logged[i] ? 0.5 : 1 }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ flex: 1, paddingRight: 8 }}>
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 10.5,
                  color: "var(--accent)",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                {m.slot}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: 14,
                  fontWeight: 600,
                  textDecoration: logged[i] ? "line-through" : "none",
                }}
              >
                {m.name}
              </div>
              <MacroLine cal={m.calories} protein={m.protein} carbs={m.carbs} fat={m.fat} />
              <div
                style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", marginTop: 3 }}
              >
                {m.recipe}
              </div>
            </div>
            <button
              onClick={() => {
                if (!logged[i]) {
                  onLogMeal({
                    date,
                    name: m.name,
                    calories: m.calories,
                    protein: m.protein,
                    carbs: m.carbs,
                    fat: m.fat,
                    planned: true,
                  });
                }
                setLogged((s) => ({ ...s, [i]: !s[i] }));
              }}
              style={checkboxStyle(logged[i])}
            >
              {logged[i] && <Check size={14} />}
            </button>
          </div>
        </div>
      ))}

      {flex > 150 && (
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", paddingTop: 10 }}>
          + ~{Math.round(flex)} kcal flex (your choice) to hit target.
        </div>
      )}
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 12.5,
          color: "var(--ink)",
          paddingTop: 8,
          fontWeight: 600,
        }}
      >
        Day total: {Math.round(dayTotals.calories)} kcal · P{Math.round(dayTotals.protein)} C
        {Math.round(dayTotals.carbs)} F{Math.round(dayTotals.fat)}
      </div>
    </div>
  );
}

// Utility: compute day totals from meals
export function computeDayTotals(meals: Meal[]) {
  return meals.reduce(
    (t, m) => ({
      calories: t.calories + m.calories,
      protein: t.protein + m.protein,
      carbs: t.carbs + m.carbs,
      fat: t.fat + m.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}
