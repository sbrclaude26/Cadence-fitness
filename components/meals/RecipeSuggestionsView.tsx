"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChefHat, ShoppingBasket, BookmarkPlus, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { MacroLine } from "@/components/ui/MacroLine";
import { RichText } from "@/components/ui/RichText";
import { GroceryList } from "@/components/meals/GroceryList";
import { ghostBtnStyle, primaryBtnStyle } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";
import { PREFILL_KEY, type PrepPrefill } from "@/lib/prepHandoff";
import { parsePlanSummary } from "@/lib/planSummary";
import type { Plan, RecipeSuggestion, Meal } from "@/lib/types";

// Plans created before the suggestions column existed kept recipes inside
// days[].meals as per-serving entries. PlanDay no longer types `meals`, but
// the JSON still holds it for archived rows — read defensively.
function legacySuggestionsFromDays(plan: Plan): RecipeSuggestion[] {
  const buckets = new Map<string, { meal: Meal; count: number }>();
  for (const d of (plan.days ?? []) as Array<{ meals?: Meal[] }>) {
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
  const supabase = createClient();
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());
  const fresh: RecipeSuggestion[] = plan.suggestions ?? [];
  const isLegacy = fresh.length === 0;
  const suggestions: RecipeSuggestion[] = isLegacy ? legacySuggestionsFromDays(plan) : fresh;
  const summary = parsePlanSummary(plan.what_changed);

  async function saveToRecipes(s: RecipeSuggestion) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // Recipes table stores per-serving macros; divide whole-batch values by suggested_servings.
    // suggested_slot stays on the in-memory suggestion (drives the "Suits Lunch" pill) — recipes
    // themselves are slot-agnostic templates (no slot column in meal_recipes).
    const srv = s.suggested_servings && s.suggested_servings > 0 ? s.suggested_servings : 1;
    const { error } = await supabase.from("meal_recipes").insert({
      user_id: user.id,
      name: s.name,
      recipe: s.recipe,
      ingredients: s.ingredients,
      calories: Math.round(s.calories / srv),
      protein: Math.round(s.protein / srv),
      carbs: Math.round(s.carbs / srv),
      fat: Math.round(s.fat / srv),
    });
    if (error) {
      console.error("save-to-recipes failed", error);
      return;
    }
    setSavedKeys((prev) => new Set(prev).add(s.name));
  }

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
      {summary.implementationMeals && (
        <Card accent>
          <Label icon={Sparkles}>This cycle — Meal prep</Label>
          <RichText text={summary.implementationMeals} />
          <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>CALORIES</div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20, color: "var(--accent)" }}>
                {plan.calorie_target}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>PROTEIN</div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20 }}>
                {plan.macros.protein}g
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>CARBS</div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20 }}>
                {plan.macros.carbs}g
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>FAT</div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20 }}>
                {plan.macros.fat}g
              </div>
            </div>
          </div>
        </Card>
      )}

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

            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => prepareThis(s)} style={{ ...primaryBtnStyle, flex: 1, justifyContent: "center" }}>
                <ChefHat size={14} /> I prepared this
              </button>
              <button
                onClick={() => saveToRecipes(s)}
                disabled={savedKeys.has(s.name)}
                style={{ ...ghostBtnStyle, padding: "0 12px", justifyContent: "center", color: savedKeys.has(s.name) ? "#7fd494" : "var(--muted)" }}
                title="Save to My Recipes for future cycles"
              >
                <BookmarkPlus size={14} /> {savedKeys.has(s.name) ? "Saved" : "Save"}
              </button>
            </div>
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
