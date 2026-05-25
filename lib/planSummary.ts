// Parse the `what_changed` field, which is now a JSON-encoded
// { meals, workouts } object. Older plans stored a single string —
// in that case we surface it under `meals` so the user still sees it.
export interface PlanSummary {
  meals: string;
  workouts: string;
}

export function parsePlanSummary(raw: string | null | undefined): PlanSummary {
  if (!raw) return { meals: "", workouts: "" };
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed) as Partial<PlanSummary>;
      return {
        meals: typeof obj.meals === "string" ? obj.meals : "",
        workouts: typeof obj.workouts === "string" ? obj.workouts : "",
      };
    } catch {
      // fall through to legacy treatment
    }
  }
  return { meals: trimmed, workouts: "" };
}
