import { type LucideIcon } from "lucide-react";
import { ReactNode } from "react";

export function Label({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--muted)" }}>
      <Icon size={16} />
      <span
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 12,
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        {children}
      </span>
    </div>
  );
}
