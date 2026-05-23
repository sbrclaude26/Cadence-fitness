import { CSSProperties, ReactNode } from "react";

const baseStyle: CSSProperties = {
  background: "var(--card)",
  border: "1px solid #232327",
  borderRadius: 16,
  padding: 16,
  marginBottom: 14,
};

export function Card({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return (
    <div style={{ ...baseStyle, ...(accent ? { borderColor: "var(--accent)" } : {}) }}>
      {children}
    </div>
  );
}
