"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChefHat, Archive } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { MacroLine } from "@/components/ui/MacroLine";
import { MealBuilder } from "@/components/meals/MealBuilder";
import { ghostBtnStyle, primaryBtnStyle } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";
import type { MealPrepBatch, Ingredient } from "@/lib/types";
import { PREFILL_KEY, type PrepPrefill } from "@/lib/prepHandoff";

export default function PrepPage() {
  const supabase = createClient();
  const router = useRouter();
  // Read prefill synchronously in the initializer so MealBuilder mounts with the right defaults.
  // If we read it in a useEffect instead, MealBuilder's internal useState seeds with undefined first
  // and never resyncs when prefill arrives later — the form ends up blank.
  const [prefill] = useState<PrepPrefill | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = sessionStorage.getItem(PREFILL_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as PrepPrefill;
      sessionStorage.removeItem(PREFILL_KEY);
      return parsed;
    } catch {
      return null;
    }
  });
  const [batches, setBatches] = useState<MealPrepBatch[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadBatches = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from("meal_prep_batches")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (data) setBatches(data as MealPrepBatch[]);
  }, [supabase]);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  async function saveBatch(built: { name: string; recipe: string; ingredients: Ingredient[]; calories: number; protein: number; carbs: number; fat: number; servings?: number }) {
    setSaving(true);
    setError("");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }
    const { error: insErr } = await supabase.from("meal_prep_batches").insert({
      user_id: user.id,
      name: built.name,
      ingredients: built.ingredients,
      recipe: built.recipe,
      total_calories: built.calories,
      total_protein: built.protein,
      total_carbs: built.carbs,
      total_fat: built.fat,
      suggested_servings: built.servings ?? null,
      source: prefill?.source ?? "manual",
      source_ref: prefill?.source_ref ?? null,
    });
    setSaving(false);
    if (insErr) { setError(insErr.message); return; }
    router.push("/today");
  }

  async function archiveBatch(id: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("meal_prep_batches")
      .update({ archived: true, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id);
    loadBatches();
  }

  async function restoreBatch(id: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase
      .from("meal_prep_batches")
      .update({ archived: false, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id);
    loadBatches();
  }

  const visible = batches.filter((b) => (showArchived ? b.archived : !b.archived));

  return (
    <div style={{ paddingTop: 16 }}>
      <Card accent>
        <Label icon={ChefHat}>{prefill ? "Prepare batch" : "New batch"}</Label>
        <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>
          {prefill
            ? "Tweak any quantities (e.g., 2 lb → 2.5 lb steak), re-estimate macros, then save as a batch you'll portion through the week."
            : "List everything you're cooking as a single batch. Macros are computed for the whole batch — you'll log percentages when you eat."}
        </div>
        <div style={{ marginTop: 12 }}>
          <MealBuilder
            mode="batch"
            defaultName={prefill?.name}
            defaultIngredients={prefill?.ingredients}
            defaultMacros={prefill ? { calories: prefill.calories, protein: prefill.protein, carbs: prefill.carbs, fat: prefill.fat } : undefined}
            defaultServings={prefill?.suggested_servings}
            applyLabel={saving ? "Saving…" : "Save batch"}
            onBuild={(built) => saveBatch(built)}
            onCancel={() => router.back()}
          />
        </div>
        {error && <div style={{ color: "#ff8a6a", fontSize: 12, marginTop: 8 }}>{error}</div>}
      </Card>

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Label icon={Archive}>{showArchived ? "Archived batches" : "Your batches"}</Label>
          <button onClick={() => setShowArchived(v => !v)} style={{ ...ghostBtnStyle, fontSize: 12, padding: "4px 10px" }}>
            {showArchived ? "Show active" : "Show archived"}
          </button>
        </div>
        {visible.length === 0 ? (
          <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", marginTop: 10 }}>
            {showArchived ? "No archived batches yet." : "No active batches. Build one above."}
          </div>
        ) : (
          visible.map((b) => (
            <div key={b.id} style={{ paddingTop: 10, marginTop: 10, borderTop: "1px solid #2a2a2e" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 14 }}>{b.name}</div>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
                    {Math.round(100 - b.consumed_pct)}% remaining · whole batch:
                  </div>
                  <MacroLine cal={b.total_calories} protein={b.total_protein} carbs={b.total_carbs} fat={b.total_fat} />
                </div>
                {showArchived ? (
                  <button onClick={() => restoreBatch(b.id)} style={{ ...ghostBtnStyle, fontSize: 12, padding: "4px 10px" }}>Restore</button>
                ) : (
                  <button onClick={() => archiveBatch(b.id)} style={{ ...ghostBtnStyle, fontSize: 12, padding: "4px 10px" }}>Mark finished</button>
                )}
              </div>
            </div>
          ))
        )}
      </Card>

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <button onClick={() => router.back()} style={{ ...ghostBtnStyle, flex: 1, justifyContent: "center" }}>
          ← Back
        </button>
        <a href="/today" style={{ ...ghostBtnStyle, flex: 1, justifyContent: "center", display: "flex", textDecoration: "none" }}>
          Go to Today
        </a>
      </div>
    </div>
  );
}

