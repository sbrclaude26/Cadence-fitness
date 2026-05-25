"use client";

import { Sparkles, ShoppingCart, Dumbbell } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { GroceryList } from "@/components/meals/GroceryList";
import type { Plan } from "@/lib/types";

export function PlanBody({ plan }: { plan: Plan }) {
  return (
    <>
      <Card accent>
        <Label icon={Sparkles}>What changed this cycle</Label>
        <div
          style={{ fontFamily: "var(--font-body)", fontSize: 14, lineHeight: 1.6, marginTop: 6, whiteSpace: "pre-wrap" }}
        >
          {plan.what_changed}
        </div>
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

      {plan.groceries?.length > 0 && (
        <Card>
          <Label icon={ShoppingCart}>Groceries — whole cycle</Label>
          <div
            style={{
              fontFamily: "var(--font-body)",
              fontSize: 11.5,
              color: "var(--muted)",
              margin: "4px 0 2px",
            }}
          >
            Tap to check off. Greyed items you likely have.
          </div>
          <GroceryList groceries={plan.groceries} />
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
                  fontSize: 14,
                }}
              >
                {d.workout?.name}
              </div>
              {d.workout?.exercises?.map((ex, k) => (
                <div
                  key={k}
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: 12.5,
                    color: "var(--muted)",
                    marginTop: 3,
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
