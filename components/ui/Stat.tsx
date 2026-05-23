import { type LucideIcon } from "lucide-react";

export function Stat({
  icon: Icon,
  label,
  value,
  unit,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  unit?: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        flex: 1,
        background: "var(--card)",
        border: "1px solid #232327",
        borderRadius: 16,
        padding: 14,
        marginBottom: 0,
      }}
    >
      <Icon size={15} style={{ color: accent ? "var(--accent)" : "var(--muted)" }} />
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: 22,
          marginTop: 6,
          color: accent ? "var(--accent)" : "var(--ink)",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 10, color: "var(--muted)" }}>
        {label}
        {unit ? ` · ${unit}` : ""}
      </div>
    </div>
  );
}
