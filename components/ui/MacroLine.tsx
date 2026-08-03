export function MacroLine({
  cal,
  protein,
  carbs,
  fat,
  fiber,
  fiberPartial,
}: {
  cal: number;
  protein: number;
  carbs: number;
  fat: number;
  /**
   * Undefined = this surface doesn't show fiber at all. Null = tracked but
   * unknown for this food (the source never reported it), rendered as "—" so
   * an unknown is never mistaken for a real 0 g.
   */
  fiber?: number | null;
  /** True when some ingredients had no fiber data — the value is a floor. */
  fiberPartial?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)" }}>
        {Math.round(cal)} kcal
      </span>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "#7fd494" }}>
        P {Math.round(protein)}g
      </span>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "#6ab7e0" }}>
        C {Math.round(carbs)}g
      </span>
      <span style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "#e0b56a" }}>
        F {Math.round(fat)}g
      </span>
      {fiber !== undefined && (
        <span style={{ fontFamily: "var(--font-body)", fontSize: 11.5, color: "#b79ae0" }}>
          Fib {fiber == null ? "—" : `${fiberPartial ? "≥" : ""}${Math.round(fiber)}g`}
        </span>
      )}
    </div>
  );
}
