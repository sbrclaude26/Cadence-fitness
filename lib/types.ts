// ─── Domain types ────────────────────────────────────────────────────────────

export interface Profile {
  user_id: string;
  start_weight: number;
  current_weight: number;
  goal_weight: number;
  start_date: string;          // ISO date "YYYY-MM-DD"
  target_rate: number;         // lb/week
  primary_goal: string;        // free text
  goal_event_date: string | null;
  experience: "Beginner" | "Intermediate" | "Advanced";
  training_history: string;
  exclusions: string;
  equipment: string;
  workout_days: string;
  diet_prefs: string;
  pantry: string;
  disruptions: string;
  vitals_ingest_token?: string;
}

export interface MealRecipe {
  id: string;
  user_id?: string;
  name: string;
  ingredients: Ingredient[];
  recipe: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  created_at?: string;
}

export interface WeightLog {
  id: string;
  user_id?: string;
  date: string;
  value: number;
}

export interface MealLog {
  id: string;
  user_id?: string;
  date: string;
  name: string;
  slot?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  planned: boolean;
  batch_id?: string | null;
  portion_pct?: number | null;
}

export interface MealPrepBatch {
  id: string;
  user_id?: string;
  name: string;
  ingredients: Ingredient[];
  recipe: string;
  total_calories: number;
  total_protein: number;
  total_carbs: number;
  total_fat: number;
  suggested_servings?: number | null;
  consumed_pct: number;
  archived: boolean;
  source: "manual" | "ai_suggestion" | "recipe";
  source_ref?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface WorkoutLog {
  id: string;
  user_id?: string;
  date: string;
  exercise_name: string;
  sets: number;
  reps: number;
  weight: number;
  custom: boolean;
}

export interface WorkoutSession {
  id: string;
  user_id?: string;
  date: string;
  type: "strength" | "cardio" | "walk" | "run" | "other";
  name: string | null;
  duration_min: number | null;
  distance_km: number | null;
  calories: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  source: "manual" | "healthkit";
  notes: string | null;
  created_at?: string;
}

export interface Vitals {
  id: string;
  user_id?: string;
  date: string;
  resting_hr: number | null;
  avg_hr: number | null;
  active_energy_kcal: number | null;
  steps: number | null;
  source: "manual" | "healthkit";
}

// ─── Plan types ───────────────────────────────────────────────────────────────

export type ExerciseType = "weight" | "bodyweight" | "time";
export type MealSlot = "Breakfast" | "Lunch" | "Dinner" | "Snack";
export type GroceryCategory = "Produce" | "Protein" | "Dairy" | "Pantry" | "Other";
export type PlanStatus = "current" | "queued" | "archived";

export interface Ingredient {
  item: string;
  qty: string;
}

export interface Meal {
  slot: MealSlot;
  name: string;
  recipe: string;
  ingredients: Ingredient[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface RecipeSuggestion {
  name: string;
  recipe: string;
  ingredients: Ingredient[];
  // Whole-batch macros — the user portions as they wish when logging.
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  suggested_servings: number;
  suggested_slot?: MealSlot;
}

export interface Exercise {
  name: string;
  type: ExerciseType;
  sets?: number;
  reps?: number;
  suggestedWeight?: number;
  lastWeight?: number | null;
  detail?: string;
}

export interface Workout {
  name: string;
  exercises: Exercise[];
}

export interface PlanDay {
  label: string;
  workout: Workout;
}

export interface Grocery {
  item: string;
  qty: string;
  category: GroceryCategory;
  have: boolean;
}

export interface PlanMacros {
  protein: number;
  carbs: number;
  fat: number;
}

export interface Plan {
  id: string;
  user_id?: string;
  cycle_number: number;
  status: PlanStatus;
  generated_at: string;
  calorie_target: number;
  macros: PlanMacros;
  what_changed: string;
  days: PlanDay[];
  groceries: Grocery[];
  suggestions: RecipeSuggestion[];
}

// ─── AI output schema (matches zod schema in /api/plan) ───────────────────────

export interface AIPlanOutput {
  calorieTarget: number;
  macros: PlanMacros;
  whatChangedMeals: string;
  whatChangedWorkouts: string;
  days: Array<{
    label: string;
    workout: Workout;
  }>;
  groceries: Grocery[];
  suggestions: RecipeSuggestion[];
}

// Supabase row shapes for explicit casting in queries
export type ProfileRow = Profile & { vitals_ingest_token?: string };
export type WeightLogRow = WeightLog & { user_id: string; created_at: string };
export type MealLogRow = MealLog & { user_id: string; created_at: string };
export type WorkoutLogRow = WorkoutLog & { user_id: string; created_at: string };
export type VitalsRow = Vitals & { user_id: string; created_at: string };
export type PlanRow = Plan & { created_at: string };
