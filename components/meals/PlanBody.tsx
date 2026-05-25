"use client";

import { Fragment } from "react";
import { Sparkles, Dumbbell } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import type { Plan } from "@/lib/types";

function renderInline(text: string) {
  // Split on **bold** segments. Odd indices are bold.
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} style={{ color: "var(--ink)", fontWeight: 700 }}>
        {part}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  );
}

function WhatChanged({ text }: { text: string }) {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div style={{ marginTop: 6 }}>
      {paragraphs.map((p, i) => (
        <p
          key={i}
          style={{
            fontFamily: "var(--font-body)",
            fontSize: 15,
            lineHeight: 1.65,
            margin: i === 0 ? "0 0 12px" : "0 0 12px",
            color: "#d8d6cf",
          }}
        >
          {renderInline(p)}
        </p>
      ))}
    </div>
  );
}

export function PlanBody({ plan }: { plan: Plan }) {
  return (
    <>
      <Card accent>
        <Label icon={Sparkles}>What changed this cycle</Label>
        <WhatChanged text={plan.what_changed} />
        <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>CALORIES</div>
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontWeight: 800,
                fontSize: 20,
                color: "var(--accent)",
              }}
            >
              {plan.calorie_target}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>PROTEIN</div>
            <div
              style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20 }}
            >
              {plan.macros.protein}g
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>CARBS</div>
            <div
              style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20 }}
            >
              {plan.macros.carbs}g
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>FAT</div>
            <div
              style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 20 }}
            >
              {plan.macros.fat}g
            </div>
          </div>
        </div>
      </Card>

      {plan.days.map((d, i) => (
        <Card key={i}>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: 13,
              color: "var(--accent)",
              letterSpacing: "0.05em",
            }}
          >
            {(d.label || `DAY ${i + 1}`).toUpperCase()}
          </div>

          <div
            style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-start" }}
          >
            <Dumbbell
              size={16}
              style={{ color: "var(--muted)", marginTop: 2, flexShrink: 0 }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontFamily: "var(--font-body)",
                  fontWeight: 600,
                  fontSize: 15,
                }}
              >
                {d.workout?.name}
              </div>
              {d.workout?.exercises?.map((ex, k) => (
                <div
                  key={k}
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 13.5,
                    color: "var(--muted)",
                    marginTop: 4,
                  }}
                >
                  {ex.name} —{" "}
                  <span style={{ color: "var(--ink)" }}>
                    {ex.type === "time"
                      ? ex.detail
                      : ex.type === "bodyweight"
                      ? `${ex.sets}×${ex.reps}`
                      : `${ex.sets}×${ex.reps} @ ${ex.suggestedWeight} lb`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      ))}
    </>
  );
}
