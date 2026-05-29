"use client";

import { Sparkles, Dumbbell } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { RichText } from "@/components/ui/RichText";
import { parsePlanSummary } from "@/lib/planSummary";
import type { Plan } from "@/lib/types";

export function PlanBody({ plan }: { plan: Plan }) {
  const summary = parsePlanSummary(plan.what_changed);
  return (
    <>
      {summary.implementationWorkouts && (
        <Card accent>
          <Label icon={Sparkles}>This cycle — Workouts</Label>
          <RichText text={summary.implementationWorkouts} />
        </Card>
      )}

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
