import type { Ingredient } from "@/lib/types";

export const PREFILL_KEY = "cadence:prep-prefill";

export interface PrepPrefill {
  name: string;
  ingredients: Ingredient[];
  recipe: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  suggested_servings: number;
  source: "ai_suggestion" | "recipe";
  source_ref?: string | null;
}
