"use client";

import { ClipboardList, Lightbulb, Compass } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { RichText } from "@/components/ui/RichText";
import { parsePlanSummary } from "@/lib/planSummary";
import type { Plan } from "@/lib/types";

// Surfaces the brain's analytical sections — how the last cycle went
// (cycleRecap), the read on progress (interpretation), and the focus for this
// cycle (strategy). These were previously generated and stored but never shown;
// only the per-tab implementation sections were rendered, so the plan appeared
// to "jump straight to what it's doing". Each section renders only when present
// (the first cycle has no recap).
export function PlanReview({ plan }: { plan: Plan }) {
  const summary = parsePlanSummary(plan.what_changed);
  const hasAny = summary.cycleRecap || summary.interpretation || summary.strategy;
  if (!hasAny) return null;

  return (
    <>
      {summary.cycleRecap && (
        <Card>
          <Label icon={ClipboardList}>How last cycle went</Label>
          <RichText text={summary.cycleRecap} />
        </Card>
      )}
      {summary.interpretation && (
        <Card>
          <Label icon={Lightbulb}>What it means</Label>
          <RichText text={summary.interpretation} />
        </Card>
      )}
      {summary.strategy && (
        <Card>
          <Label icon={Compass}>This cycle&apos;s focus</Label>
          <RichText text={summary.strategy} />
        </Card>
      )}
    </>
  );
}
