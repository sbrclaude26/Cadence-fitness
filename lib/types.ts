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
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  planned: boolean;
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

export interface Meal {
  slot: MealSlot;
  name: string;
  recipe: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
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
  meals: Meal[];
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
}

// ─── AI output schema (matches zod schema in /api/plan) ───────────────────────

export interface AIPlanOutput {
  calorieTarget: number;
  macros: PlanMacros;
  whatChanged: string;
  days: Array<{
    label: string;
    meals: Meal[];
    workout: Workout;
  }>;
  groceries: Grocery[];
}

// Supabase row shapes for explicit casting in queries
export type ProfileRow = Profile & { vitals_ingest_token?: string };
export type WeightLogRow = WeightLog & { user_id: string; created_at: string };
export type MealLogRow = MealLog & { user_id: string; created_at: string };
export type WorkoutLogRow = WorkoutLog & { user_id: string; created_at: string };
export type VitalsRow = Vitals & { user_id: string; created_at: string };
export type PlanRow = Plan & { created_at: string };
