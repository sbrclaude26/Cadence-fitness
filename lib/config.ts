export const CYCLE_DAYS = 4;

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
