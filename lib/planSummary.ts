// Parse the `what_changed` field. After migration 021 this is JSONB on the
// server and arrives as an object: { cycleRecap, interpretation, strategy,
// implementationMeals, implementationWorkouts }. Pre-migration rows arrive
// as a JSON string with the same keys; older still rows used
// { meals, workouts } — those map to the implementation sections. The
// oldest rows were a single string; we surface them under cycleRecap.
import type { PlanWhatChanged } from "@/lib/types";

export interface PlanSummary {
  cycleRecap: string;
  interpretation: string;
  strategy: string;
  implementationMeals: string;
  implementationWorkouts: string;
}

const EMPTY: PlanSummary = {
  cycleRecap: "",
  interpretation: "",
  strategy: "",
  implementationMeals: "",
  implementationWorkouts: "",
};

type RawSummary = PlanWhatChanged | Record<string, unknown> | string | null | undefined;

function pickFromObject(obj: Record<string, unknown>): PlanSummary {
  const pick = (k: string) => (typeof obj[k] === "string" ? (obj[k] as string) : "");
  return {
    cycleRecap: pick("cycleRecap"),
    interpretation: pick("interpretation"),
    strategy: pick("strategy"),
    implementationMeals: pick("implementationMeals") || pick("meals"),
    implementationWorkouts: pick("implementationWorkouts") || pick("workouts"),
  };
}

export function parsePlanSummary(raw: RawSummary): PlanSummary {
  if (raw == null) return { ...EMPTY };

  if (typeof raw === "object") {
    return pickFromObject(raw as Record<string, unknown>);
  }

  const trimmed = String(raw).trim();
  if (!trimmed) return { ...EMPTY };
  if (trimmed.startsWith("{")) {
    try {
      return pickFromObject(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      // fall through to legacy treatment
    }
  }
  return { ...EMPTY, cycleRecap: trimmed };
}
