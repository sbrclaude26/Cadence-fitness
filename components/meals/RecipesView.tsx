"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, ChefHat } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { MacroLine } from "@/components/ui/MacroLine";
import { MealBuilder } from "@/components/meals/MealBuilder";
import { ghostBtnStyle, primaryBtnStyle } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";
import { PREFILL_KEY, type PrepPrefill } from "@/lib/prepHandoff";
import type { MealRecipe } from "@/lib/types";

interface Props {
  recipes: MealRecipe[];
  onRefresh: () => void;
}

export function RecipesView({ recipes, onRefresh }: Props) {
  const supabase = createClient();
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null); // recipe id or "new"
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  function prepThisRecipe(r: MealRecipe) {
    // Saved recipes are stored per-serving; treat one batch of this recipe as 1 serving by default.
    // The user can adjust quantities + servings in /prep before saving.
    const payload: PrepPrefill = {
      name: r.name,
      ingredients: r.ingredients ?? [],
      recipe: r.recipe ?? "",
      calories: r.calories,
      protein: r.protein,
      carbs: r.carbs,
      fat: r.fat,
      suggested_servings: 1,
      source: "recipe",
      source_ref: r.id,
    };
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify(payload));
    router.push("/prep");
  }

  async function saveRecipe(id: string | null, built: Omit<MealRecipe, "id" | "user_id" | "created_at">) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (id) {
      await supabase.from("meal_recipes").update(built).eq("id", id).eq("user_id", user.id);
    } else {
      await supabase.from("meal_recipes").insert({ ...built, user_id: user.id });
    }
    setEditing(null);
    onRefresh();
  }

  async function deleteRecipe(id: string) {
    await supabase.from("meal_recipes").delete().eq("id", id);
    setConfirmDelete(null);
    onRefresh();
  }

  return (
    <>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 15 }}>My Recipes</div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
              Saved across all cycles. Tap to log from Today.
            </div>
          </div>
          {editing !== "new" && (
            <button onClick={() => setEditing("new")} style={{ ...primaryBtnStyle, padding: "8px 14px", fontSize: 13 }}>
              <Plus size={14} /> New
            </button>
          )}
        </div>

        {editing === "new" && (
          <div style={{ marginTop: 12 }}>
            <MealBuilder
              slot="Lunch"
              onBuild={(built) => saveRecipe(null, { ...built, recipe: built.recipe ?? "" })}
              onCancel={() => setEditing(null)}
              showSaveToRecipes={false}
            />
          </div>
        )}
      </Card>

      {recipes.length === 0 && editing !== "new" && (
        <Card>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "16px 0", gap: 10 }}>
            <ChefHat size={28} style={{ color: "var(--muted)" }} />
            <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", textAlign: "center" }}>
              No saved recipes yet. Hit "New" to add one, or save a meal from the Meal Prep guide.
            </div>
          </div>
        </Card>
      )}

      {recipes.map((r) => (
        <Card key={r.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{r.name}</div>
              <MacroLine cal={r.calories} protein={r.protein} carbs={r.carbs} fat={r.fat} />
            </div>
            {editing !== r.id && (
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button onClick={() => prepThisRecipe(r)} style={{ ...primaryBtnStyle, padding: "4px 10px", fontSize: 12 }}>
                  <ChefHat size={12} /> I prepared this
                </button>
                <button onClick={() => setEditing(r.id)} style={{ ...ghostBtnStyle, padding: "4px 10px", fontSize: 12 }}>
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => setConfirmDelete(r.id)}
                  style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", padding: "4px 6px" }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            )}
          </div>

          {confirmDelete === r.id && (
            <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "#ff8a6a", flex: 1 }}>Delete this recipe?</div>
              <button onClick={() => deleteRecipe(r.id)} style={{ ...ghostBtnStyle, fontSize: 12, color: "#ff8a6a", borderColor: "#ff8a6a" }}>Delete</button>
              <button onClick={() => setConfirmDelete(null)} style={{ ...ghostBtnStyle, fontSize: 12 }}>Cancel</button>
            </div>
          )}

          {r.ingredients?.length > 0 && editing !== r.id && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em", marginBottom: 5 }}>INGREDIENTS</div>
              {r.ingredients.map((ing, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--font-body)", fontSize: 13, marginBottom: 3 }}>
                  <span>{ing.item}</span>
                  <span style={{ color: "var(--muted)" }}>{ing.qty}</span>
                </div>
              ))}
            </div>
          )}

          {r.recipe && editing !== r.id && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #2a2a2e" }}>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em", marginBottom: 5 }}>RECIPE</div>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 13, lineHeight: 1.6, color: "var(--muted)" }}>{r.recipe}</div>
            </div>
          )}

          {editing === r.id && (
            <div style={{ marginTop: 12 }}>
              <MealBuilder
                slot="Lunch"
                defaultName={r.name}
                defaultIngredients={r.ingredients}
                defaultMacros={{ calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat }}
                onBuild={(built) => saveRecipe(r.id, { ...built, recipe: built.recipe ?? "" })}
                onCancel={() => setEditing(null)}
                showSaveToRecipes={false}
              />
            </div>
          )}
        </Card>
      ))}
    </>
  );
}
