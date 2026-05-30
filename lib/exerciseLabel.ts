import type { CardioTarget, Exercise, WeightBasis } from "@/lib/types";

function defaultBasis(ex: Exercise): WeightBasis {
  return ex.weight_basis_default ?? "total";
}

// One human-readable line for the structured 'cardio_target' on a time-based
// exercise. Used by Today, Plan, and Log so all three tabs render the same
// prescription text.
export function cardioTargetText(t: CardioTarget): string {
  const bits: string[] = [];
  if (t.intervals) {
    const { sets, work_seconds, rest_seconds } = t.intervals;
    const work = work_seconds >= 60 && work_seconds % 60 === 0 ? `${work_seconds / 60} min` : `${work_seconds}s`;
    const rest = rest_seconds >= 60 && rest_seconds % 60 === 0 ? `${rest_seconds / 60} min` : `${rest_seconds}s`;
    bits.push(`${sets}× ${work} work / ${rest} rest`);
  }
  if (t.hr_min != null || t.hr_max != null) {
    bits.push(`HR ${t.hr_min ?? "?"}–${t.hr_max ?? "?"}`);
  }
  if (t.speed_min != null || t.speed_max != null) {
    const same = t.speed_min === t.speed_max;
    bits.push(same ? `${t.speed_min} mph` : `${t.speed_min ?? "?"}–${t.speed_max ?? "?"} mph`);
  }
  if (t.incline_min != null || t.incline_max != null) {
    const same = t.incline_min === t.incline_max;
    bits.push(same ? `${t.incline_min}% incline` : `${t.incline_min ?? "?"}–${t.incline_max ?? "?"}% incline`);
  }
  if (t.duration_min != null && !t.intervals) {
    bits.push(`${t.duration_min} min`);
  }
  return bits.join(" · ");
}

// The detail string shown next to an exercise name on Plan/Today/Log. For
// time-based exercises, prefers the structured cardio_target (always
// explicit — speed, incline, duration, interval sets/work/rest) and appends
// the human 'detail' tag (e.g. "warm-up", "zone 2 finisher") when present.
// For weight/bodyweight exercises, mirrors the existing prescription line.
export function exerciseDetailLabel(ex: Exercise): string {
  if (ex.type === "time") {
    const structured = ex.cardio_target ? cardioTargetText(ex.cardio_target) : "";
    const human = ex.detail?.trim() ?? "";
    if (structured && human) return `${structured} — ${human}`;
    return structured || human;
  }
  if (ex.type === "bodyweight") {
    return `${ex.sets}×${ex.reps}`;
  }
  // weight
  const basis = ex.suggestedWeightBasis ?? ex.lastWeightBasis ?? defaultBasis(ex);
  const basisLbl = basis === "per_side" ? "lb/side" : "lb";
  const weightPart = ex.suggestedWeight != null ? ` @ ${ex.suggestedWeight} ${basisLbl}` : "";
  return `${ex.sets}×${ex.reps}${weightPart}`;
}
