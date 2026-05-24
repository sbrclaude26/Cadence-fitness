"use client";

import { UtensilsCrossed, ShoppingBasket } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { MacroLine } from "@/components/ui/MacroLine";
import type { Plan, Ingredient } from "@/lib/types";

interface PrepMeal {
  name: string;
  recipe: string;
  ingredients: Ingredient[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  occurrences: { dayLabel: string; slot: string }[];
}

function parseQty(qty: string): { num: number; unit: string } | null {
  const match = qty.trim().match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!match) return null;
  return { num: parseFloat(match[1]), unit: match[2].trim().toLowerCase() };
}

function scaleIngredients(ingredients: Ingredient[], servings: number): { item: string; qty: string }[] {
  return ingredients.map(({ item, qty }) => {
    if (servings === 1) return { item, qty };
    const parsed = parseQty(qty);
    if (!parsed) return { item, qty: `${qty} ×${servings}` };
    const scaled = parsed.num * servings;
    const display = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
    return { item, qty: `${display}${parsed.unit ? " " + parsed.unit : ""} total` };
  });
}

function consolidateIngredients(meals: PrepMeal[]): { item: string; qty: string }[] {
  const map = new Map<string, { num: number; unit: string } | null>();

  for (const meal of meals) {
    const servings = meal.occurrences.length;
    for (const { item, qty } of meal.ingredients) {
      const key = item.toLowerCase().trim();
      const parsed = parseQty(qty);
      const existing = map.get(key);

      if (existing === undefined) {
        if (!parsed) { map.set(key, null); continue; }
        map.set(key, { num: parsed.num * servings, unit: parsed.unit });
      } else if (existing === null || !parsed || parsed.unit !== existing.unit) {
        map.set(key, null);
      } else {
        map.set(key, { num: existing.num + parsed.num * servings, unit: existing.unit });
      }
    }
  }

  const result: { item: string; qty: string }[] = [];
  for (const meal of meals) {
    for (const { item } of meal.ingredients) {
      const key = item.toLowerCase().trim();
      if (!result.find((r) => r.item.toLowerCase() === key)) {
        const val = map.get(key);
        if (val === null || val === undefined) {
          result.push({ item, qty: "as needed" });
        } else {
          const num = Number.isInteger(val.num) ? String(val.num) : val.num.toFixed(1);
          result.push({ item, qty: `${num}${val.unit ? " " + val.unit : ""}` });
        }
      }
    }
  }
  return result;
}

export function MealPrepView({ plan }: { plan: Plan }) {
  // Group meals by name
  const mealMap = new Map<string, PrepMeal>();

  plan.days.forEach((day, i) => {
    day.meals.forEach((meal) => {
      const existing = mealMap.get(meal.name);
      if (existing) {
        existing.occurrences.push({ dayLabel: day.label || `Day ${i + 1}`, slot: meal.slot });
      } else {
        mealMap.set(meal.name, {
          name: meal.name,
          recipe: meal.recipe,
          ingredients: meal.ingredients ?? [],
          calories: meal.calories,
          protein: meal.protein,
          carbs: meal.carbs,
          fat: meal.fat,
          occurrences: [{ dayLabel: day.label || `Day ${i + 1}`, slot: meal.slot }],
        });
      }
    });
  });

  const meals = Array.from(mealMap.values());
  const consolidated = consolidateIngredients(meals);

  return (
    <>
      <Card accent>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
          Meal Prep Guide
        </div>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
          Prep everything below in one session. Repeated meals are combined so you cook the full batch at once.
        </div>
      </Card>

      {meals.map((meal) => {
        const servings = meal.occurrences.length;
        const scaled = scaleIngredients(meal.ingredients, servings);
        return (
          <Card key={meal.name}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 14, flex: 1 }}>
                {meal.name}
                {servings > 1 && (
                  <span style={{ fontFamily: "var(--font-display)", fontSize: 11, color: "var(--accent)", fontWeight: 800, marginLeft: 6 }}>
                    ×{servings}
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "6px 0 8px" }}>
              {meal.occurrences.map((o, i) => (
                <div key={i} style={{
                  fontFamily: "var(--font-body)", fontSize: 10.5, fontWeight: 600,
                  background: "#1e1e22", borderRadius: 6, padding: "3px 8px",
                  color: "var(--muted)", letterSpacing: "0.03em",
                }}>
                  {o.dayLabel.toUpperCase()} · {o.slot.toUpperCase()}
                </div>
              ))}
            </div>

            <MacroLine cal={meal.calories * servings} protein={meal.protein * servings} carbs={meal.carbs * servings} fat={meal.fat * servings} />
            {servings > 1 && (
              <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
                {meal.calories} kcal · {meal.protein}g protein per serving
              </div>
            )}

            {scaled.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em", marginBottom: 5 }}>
                  INGREDIENTS{servings > 1 ? ` (×${servings} servings)` : ""}
                </div>
                {scaled.map((ing, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-body)", fontSize: 13, marginBottom: 3 }}>
                    <span>{ing.item}</span>
                    <span style={{ color: "var(--muted)" }}>{ing.qty}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #2a2a2e" }}>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em", marginBottom: 5 }}>
                RECIPE
              </div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 13, lineHeight: 1.6, color: "var(--muted)" }}>
                {meal.recipe}
              </div>
            </div>
          </Card>
        );
      })}

      {consolidated.length > 0 && (
        <Card>
          <Label icon={ShoppingBasket}>Full cycle shopping — consolidated</Label>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", margin: "4px 0 10px" }}>
            Total quantities needed across all {plan.days.length} days.
          </div>
          {consolidated.map((ing, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-body)", fontSize: 13, marginBottom: 5 }}>
              <span>{ing.item}</span>
              <span style={{ color: "var(--accent)", fontWeight: 600 }}>{ing.qty}</span>
            </div>
          ))}
        </Card>
      )}

      {meals.some((m) => !m.ingredients.length) && (
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", textAlign: "center", padding: "0 16px 16px" }}>
          Regenerate your plan to get ingredient lists for all meals.
        </div>
      )}
    </>
  );
}
