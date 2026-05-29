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

export type WeightBasis = "total" | "per_side";

export interface WorkoutSet {
  id: string;
  user_id?: string;
  workout_log_id: string;
  set_index: number;
  reps: number;
  weight: number;
  weight_basis: WeightBasis;
  rpe: number | null;
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
  library_slug?: string | null;
  position_in_session?: number | null;
  notes?: string | null;
  sets_detail?: WorkoutSet[];
  apple_workout_id?: string | null;
}

// User-logged cardio + holds (planks, etc). Apple Watch dumps live in AppleWorkout.
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
  notes: string | null;
  avg_speed_mph?: number | null;
  avg_incline_pct?: number | null;
  planned_exercise_name?: string | null;
  library_slug?: string | null;
  position_in_session?: number | null;
  apple_workout_id?: string | null;
  created_at?: string;
}

// Raw Apple Watch session ingested via the workouts webhook.
export interface AppleWorkout {
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
  sleep_hours: number | null;
  sleep_efficiency_pct: number | null;
  hrv_sdnn_ms: number | null;
  source: "manual" | "healthkit";
}

// ─── Plan types ───────────────────────────────────────────────────────────────

export type ExerciseType = "weight" | "bodyweight" | "time";
export type MealSlot = "Breakfast" | "Lunch" | "Dinner" | "Snack";
export type GroceryCategory = "Produce" | "Protein" | "Dairy" | "Pantry" | "Other";
export type PlanStatus = "current" | "queued" | "archived";

// Macros for a single ingredient. Calories in kcal; protein/carbs/fat in grams.
export interface IngredientMacros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

// An ingredient on a meal/recipe/batch. Legacy rows stored `qty` as a stringy
// "200 g" — we keep the old shape backward-compatible (qty stays a string)
// while adding optional structured fields populated by the food library picker.
// When `food_slug` is set, `macros` is the live computation from the library
// (per_100g × grams_per_unit × qty / 100) or a user override for this meal
// only. When `food_slug` is absent, `macros` may come from /api/macros and
// `ai_guess` is true.
export interface Ingredient {
  item: string;
  qty: string;                  // legacy: "200 g" — for new rows, just the numeric portion as string
  unit?: string;                // "g" | "oz" | "tbsp" | "tsp" | "cup" | "slice" | "piece" | "scoop" | "ml"
  food_slug?: string | null;
  macros?: IngredientMacros;
  ai_guess?: boolean;
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

export interface CardioTarget {
  hr_min?: number;
  hr_max?: number;
  speed_min?: number;
  speed_max?: number;
  incline_min?: number;
  incline_max?: number;
  duration_min?: number;
}

export interface Exercise {
  name: string;
  type: ExerciseType;
  sets?: number;
  reps?: number;
  suggestedWeight?: number;
  suggestedWeightBasis?: WeightBasis;
  weight_basis_default?: WeightBasis;
  lastWeight?: number | null;
  lastWeightBasis?: WeightBasis | null;
  detail?: string;
  cardio_target?: CardioTarget;
  // Library linkage: set when the Brain picked a canonical movement.
  // library_slug is null and is_custom is true when the Brain had to invent
  // an exercise that doesn't exist in workout_library. `description` is
  // joined in from workout_library at read time so the picker and the
  // today/log views can show a "What is this?" panel.
  library_slug?: string | null;
  is_custom?: boolean;
  description?: string | null;
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

// The 5-section summary stored in plans.what_changed (JSONB). Legacy rows
// may use { meals, workouts } — planSummary.ts handles both shapes.
export interface PlanWhatChanged {
  cycleRecap?: string;
  interpretation?: string;
  strategy?: string;
  implementationMeals?: string;
  implementationWorkouts?: string;
  meals?: string;
  workouts?: string;
}

export interface Plan {
  id: string;
  user_id?: string;
  cycle_number: number;
  status: PlanStatus;
  generated_at: string;
  // Immutable local date (YYYY-MM-DD) the plan's Day 1 maps to. Goal + day-of-
  // cycle resolution keys off this, not generated_at. Null on legacy rows →
  // callers fall back to the generated_at local date (see lib/planResolve.ts).
  cycle_start_date?: string | null;
  calorie_target: number;
  macros: PlanMacros;
  // JSONB on the server (5-section summary object) — older rows may still
  // surface as a JSON string until migration 021 is applied. Treat both.
  what_changed: PlanWhatChanged | string | null;
  days: PlanDay[];
  groceries: Grocery[];
  suggestions: RecipeSuggestion[];
  user_notes?: string | null;
  no_adjustments?: boolean;
}

// ─── AI output schema (matches zod schema in /api/plan) ───────────────────────

export interface AIPlanImplementation {
  meals: string;
  workouts: string;
}

export interface AIPlanOutput {
  calorieTarget: number;
  macros: PlanMacros;
  cycleRecap: string;
  interpretation: string;
  strategy: string;
  implementation: AIPlanImplementation;
  days: Array<{
    label: string;
    workout: Workout;
  }>;
  groceries: Grocery[];
  suggestions: RecipeSuggestion[];
}

// ─── Food library ─────────────────────────────────────────────────────────────

export type FoodCategory =
  | "protein"
  | "dairy"
  | "grain"
  | "fat"
  | "veg"
  | "fruit"
  | "snack"
  | "condiment"
  | "beverage"
  | "other";

export interface FoodPortion {
  unit: string;                 // "g" | "oz" | "tbsp" | "cup" | "slice" | "piece" | "scoop" | "ml"
  grams_per_unit: number;
  description?: string | null;
  is_default?: boolean;
}

export interface FoodLibraryEntry {
  slug: string;
  name: string;
  brand: string | null;
  category: FoodCategory | string;
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fat_per_100g: number;
  source: string;               // "usda_foundation" | "usda_sr_legacy" | "usda_fndds" | "off" | "curated"
  source_ref: string | null;
  aliases: string[];
  portions: FoodPortion[];
}

// Supabase row shapes for explicit casting in queries
export type ProfileRow = Profile & { vitals_ingest_token?: string };
export type WeightLogRow = WeightLog & { user_id: string; created_at: string };
export type MealLogRow = MealLog & { user_id: string; created_at: string };
export type WorkoutLogRow = WorkoutLog & { user_id: string; created_at: string };
export type VitalsRow = Vitals & { user_id: string; created_at: string };
export type PlanRow = Plan & { created_at: string };
