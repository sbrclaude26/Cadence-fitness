export function MacroLine({
  cal,
  protein,
  carbs,
  fat,
}: {
  cal: number;
  protein: number;
  carbs: number;
  fat: number;
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
    </div>
  );
}
