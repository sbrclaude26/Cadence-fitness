// Slim macro progress bar.
//
// Standard direction (calories/carbs/fat): green at 0%, gradient to yellow at
// 100%, red past 100% (over-budget is bad).
// Reverse direction (protein): red at 0%, gradient to green at 100%, stays
// green past 100% (more protein is fine).

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function hsl(h: number, s: number, l: number) {
  return `hsl(${Math.round(h)}, ${s}%, ${l}%)`;
}

function colorForPct(pct: number, reverse: boolean): string {
  // pct is in [0, ∞), 1.0 = at target
  const SAT = 65;
  const LIGHT = 55;
  if (reverse) {
    // protein: 0 → red(0°), 1.0+ → green(130°)
    if (pct >= 1) return hsl(130, SAT, LIGHT);
    if (pct <= 0) return hsl(0, SAT, LIGHT);
    return hsl(lerp(0, 130, pct), SAT, LIGHT);
  }
  // standard: 0 → green(130°), 1.0 → yellow(50°), 1.2+ → red(0°)
  if (pct <= 0) return hsl(130, SAT, LIGHT);
  if (pct < 1) return hsl(lerp(130, 50, pct), SAT, LIGHT);
  if (pct < 1.2) return hsl(lerp(50, 0, (pct - 1) / 0.2), SAT, LIGHT);
  return hsl(0, SAT, LIGHT);
}

interface Props {
  label: string;
  value: number;
  target: number;
  unit?: string;
  reverse?: boolean;
  compact?: boolean;
}

export function MacroBar({ label, value, target, unit = "", reverse = false, compact = false }: Props) {
  const pct = target > 0 ? value / target : 0;
  const fillPct = Math.min(1, pct);
  const over = pct > 1;
  const color = colorForPct(pct, reverse);
  const pctLabel = target > 0 ? Math.round(pct * 100) : 0;

  const valueFontSize = compact ? 14 : 16;
  const labelFontSize = compact ? 10 : 11;

  return (
    <div style={{ marginBottom: compact ? 8 : 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
        <span style={{ fontFamily: "var(--font-body)", fontSize: labelFontSize, color: "var(--muted)", fontWeight: 700, letterSpacing: "0.06em" }}>
          {label.toUpperCase()}
        </span>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: valueFontSize, color: "var(--ink)" }}>
          {Math.round(value)}{unit}
          <span style={{ fontSize: valueFontSize - 4, color: "var(--muted)", fontWeight: 600 }}> / {Math.round(target)}{unit}</span>
          <span style={{ fontSize: valueFontSize - 5, color: over ? color : "var(--muted)", fontWeight: 600, marginLeft: 6 }}>
            {pctLabel}%
          </span>
        </span>
      </div>
      <div style={{ position: "relative", width: "100%", height: 5, background: "#23232a", borderRadius: 4, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${fillPct * 100}%`,
            background: color,
            borderRadius: 4,
            transition: "width 0.25s ease",
          }}
        />
      </div>
    </div>
  );
}
