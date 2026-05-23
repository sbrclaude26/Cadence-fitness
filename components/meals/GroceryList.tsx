"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { checkboxStyle } from "@/components/ui/styles";
import type { Grocery } from "@/lib/types";

export function GroceryList({ groceries }: { groceries: Grocery[] }) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const cats: Record<string, Grocery[]> = {};
  groceries.forEach((g) => {
    (cats[g.category] = cats[g.category] || []).push(g);
  });

  return (
    <div>
      {Object.keys(cats).map((cat) => (
        <div key={cat} style={{ marginTop: 10 }}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 11,
              fontWeight: 800,
              color: "var(--accent)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {cat}
          </div>
          {cats[cat].map((g, i) => {
            const key = cat + i;
            const on = checked[key];
            return (
              <button
                key={key}
                onClick={() => setChecked((c) => ({ ...c, [key]: !c[key] }))}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  padding: "8px 0",
                  cursor: "pointer",
                  color: "var(--ink)",
                  borderBottom: "1px solid #1f1f23",
                  opacity: g.have ? 0.45 : 1,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={checkboxStyle(on)}>{on && <Check size={12} />}</span>
                  <span
                    style={{
                      fontFamily: "var(--font-body)",
                      fontSize: 13.5,
                      textDecoration: on ? "line-through" : "none",
                    }}
                  >
                    {g.item}
                  </span>
                </span>
                <span style={{ fontFamily: "var(--font-body)", fontSize: 12, color: "var(--muted)" }}>
                  {g.have ? "have" : g.qty}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
