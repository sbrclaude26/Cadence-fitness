"use client";

import { useRouter } from "next/navigation";
import { ChefHat, ShoppingBasket } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { MacroLine } from "@/components/ui/MacroLine";
import { GroceryList } from "@/components/meals/GroceryList";
import { primaryBtnStyle } from "@/components/ui/styles";
import { PREFILL_KEY, type PrepPrefill } from "@/lib/prepHandoff";
import type { Plan, RecipeSuggestion } from "@/lib/types";

export function RecipeSuggestionsView({ plan }: { plan: Plan }) {
  const router = useRouter();
  const suggestions: RecipeSuggestion[] = plan.suggestions ?? [];

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
          Recipe Suggestions
        </div>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>
          Pick whichever batches you want to cook. Tap &quot;I prepared this&quot; to tweak quantities and save as a batch you&apos;ll portion through the week.
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
