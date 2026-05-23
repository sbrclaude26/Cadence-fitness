import { ReactNode } from "react";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div
        style={{
          fontFamily: "var(--font-body)",
          fontSize: 12,
          color: "var(--muted)",
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
