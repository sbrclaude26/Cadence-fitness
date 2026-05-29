export const CYCLE_DAYS = 7;

// Uniform recent-activity window injected into the cycle-planning brain
// (strength logs, manual cardio, watch sessions, vitals, meal logs).
// Matches the "28d" Trends window closely so the brain's volume numbers are
// in the same ballpark the user sees in-app.
export const RECENT_ACTIVITY_DAYS = 30;

// AI generation
export const AI_MODEL = "claude-sonnet-4-6";
// Smaller/faster model used for narrow utility calls (e.g. one-shot macro lookup).
export const AI_FAST_MODEL = "claude-haiku-4-5";
export const AI_TEMPERATURE = 0.5;
export const MAX_TOKENS_BASE = 6000;
export const MAX_TOKENS_PER_DAY = 1500;

// Nutrition defaults (AI uses these as anchor/floor only)
export const PROTEIN_RATIO = 0.9;       // g per lb bodyweight
export const FAT_CALORIES_PCT = 0.25;   // 25% of calories from fat
export const MEAL_TARGET_PCT = 0.9;     // plan meals to ~90% of calorie target

// Progressive overload
export const STALL_CYCLES = 2;          // cycles without progress = stall
export const ACCESSORY_ROTATION_CYCLES = 3; // rotate accessories every N cycles

// Sensitivity damping
export const SENSITIVITY_FULL_CYCLES = 3; // cycles before full confidence

// Apple Watch active-calorie haircut. Independent studies (Stanford 2017 etc.)
// show consumer wearables overestimate non-resting kcal by ~25-30%. We apply a
// flat factor before surfacing the averaged active burn to the planner brain so
// the calorie target isn't built on inflated assumptions.
export const APPLE_WATCH_ACTIVE_KCAL_FACTOR = 0.7;
