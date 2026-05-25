"use client";

import { useRouter } from "next/navigation";
import { ChefHat, ShoppingBasket } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { MacroLine } from "@/components/ui/MacroLine";
import { GroceryList } from "@/components/meals/GroceryList";
import { primaryBtnStyle } from "@/components/ui/styles";
import { PREFILL_KEY, type PrepPrefill } from "@/lib/prepHandoff";
import type { Plan, RecipeSuggestion, Meal } from "@/lib/types";

// Plans created before the suggestions column existed kept recipes inside
// days[].meals as per-serving entries. Dedup by name, count occurrences as
// the implied batch size, and scale per-serving macros up to whole-batch.
function legacySuggestionsFromDays(plan: Plan): RecipeSuggestion[] {
  const buckets = new Map<string, { meal: Meal; count: number }>();
  for (const d of plan.days ?? []) {
    for (const m of (d.meals ?? []) as Meal[]) {
      if (!m?.name) continue;
      const key = m.name.trim().toLowerCase();
      const existing = buckets.get(key);
      if (existing) existing.count += 1;
      else buckets.set(key, { meal: m, count: 1 });
    }
  }
  return Array.from(buckets.values()).map(({ meal, count }) => ({
    name: meal.name,
    recipe: meal.recipe ?? "",
    ingredients: meal.ingredients ?? [],
    calories: Math.round((meal.calories ?? 0) * count),
    protein: Math.round((meal.protein ?? 0) * count),
    carbs: Math.round((meal.carbs ?? 0) * count),
    fat: Math.round((meal.fat ?? 0) * count),
    suggested_servings: count,
    suggested_slot: meal.slot,
  }));
}

export function RecipeSuggestionsView({ plan }: { plan: Plan }) {
  const router = useRouter();
  const fresh: RecipeSuggestion[] = plan.suggestions ?? [];
  const isLegacy = fresh.length === 0;
  const suggestions: RecipeSuggestion[] = isLegacy ? legacySuggestionsFromDays(plan) : fresh;

  function prepareThis(s: RecipeSuggestion) {
    const payload: PrepPrefill = {
      name: s.name,
      ingredients: s.ingredients,
      recipe: s.recipe,
      calories: s.calories,
      protein: s.protein,
      carbs: s.carbs,
      fat: s.fat,
      suggested_servings: s.suggested_servings,
      source: "ai_suggestion",
      source_ref: s.name,
    };
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify(payload));
    router.push("/prep");
  }

  if (suggestions.length === 0) {
    return (
      <Card>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)" }}>
          No recipe suggestions on this plan yet. Regenerate the cycle to get a fresh batch.
        </div>
      </Card>
    );
  }

  return (
    <>
      <Card accent>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
          {isLegacy ? "Recipes from this cycle" : "Recipe Suggestions"}
        </div>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
          {isLegacy
            ? "These were planned as per-day meals. Macros below are scaled to a whole batch (count of occurrences across the cycle). Tap \u201CI prepared this\u201D to convert one into a trackable batch."
            : "Pick whichever batches you want to cook. Tap \u201CI prepared this\u201D to tweak quantities and save as a batch you\u2019ll portion through the week."}
        </div>
      </Card>

      {suggestions.map((s) => {
        const perServingCal = s.suggested_servings > 0 ? Math.round(s.calories / s.suggested_servings) : null;
        return (
          <Card key={s.name}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 14 }}>{s.name}</div>
                {s.suggested_slot && (
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 10.5, color: "var(--muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginTop: 2 }}>
                    Suits {s.suggested_slot}
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginTop: 6 }}>
              <MacroLine cal={s.calories} protein={s.protein} carbs={s.carbs} fat={s.fat} />
              {perServingCal !== null && (
                <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                  Recommended ~{s.suggested_servings} servings (≈ {perServingCal} kcal each)
                </div>
              )}
            </div>

            {s.ingredients?.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em", marginBottom: 5 }}>
                  INGREDIENTS (whole batch)
                </div>
                {s.ingredients.map((ing, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-body)", fontSize: 13, marginBottom: 3 }}>
                    <span>{ing.item}</span>
                    <span style={{ color: "var(--muted)" }}>{ing.qty}</span>
                  </div>
                ))}
              </div>
            )}

            {s.recipe && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #2a2a2e" }}>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em", marginBottom: 5 }}>RECIPE</div>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 13, lineHeight: 1.6, color: "var(--muted)", whiteSpace: "pre-wrap" }}>
                  {s.recipe}
                </div>
              </div>
            )}

            <button onClick={() => prepareThis(s)} style={{ ...primaryBtnStyle, width: "100%", justifyContent: "center", marginTop: 12 }}>
              <ChefHat size={14} /> I prepared this
            </button>
          </Card>
        );
      })}

      {plan.groceries?.length > 0 && (
        <Card>
          <Label icon={ShoppingBasket}>Cycle shopping list</Label>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", margin: "4px 0 10px" }}>
            Combined ingredients across all suggestions.
          </div>
          <GroceryList groceries={plan.groceries} />
        </Card>
      )}
    </>
  );
}
