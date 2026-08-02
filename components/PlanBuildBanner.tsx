"use client";

import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { CYCLE_DAYS } from "@/lib/config";

// Shown while a cycle builds in the background. The point of the background
// build is that the athlete isn't trapped, so the copy says so outright rather
// than leaving a bare spinner that reads as "don't touch anything".
export function PlanBuildBanner({ elapsedS }: { elapsedS: number }) {
  const mins = Math.floor(elapsedS / 60);
  const secs = elapsedS % 60;
  return (
    <Card accent>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
        <Loader2
          size={17}
          style={{ color: "var(--accent)", flexShrink: 0, marginTop: 2, animation: "cadence-spin 1s linear infinite" }}
        />
        <div>
          <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: "var(--ink)" }}>
            Building your next {CYCLE_DAYS} days…
          </div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", marginTop: 4, lineHeight: 1.5 }}>
            This takes a few minutes. You can leave this screen, use other apps, or close your phone — the plan
            keeps building and will be here when you get back.
            {elapsedS > 0 && ` (${mins}m ${String(secs).padStart(2, "0")}s so far)`}
          </div>
        </div>
      </div>
    </Card>
  );
}
