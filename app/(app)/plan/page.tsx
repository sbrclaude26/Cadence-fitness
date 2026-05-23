"use client";

import { useEffect, useState } from "react";
import { Sparkles, CalendarPlus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { PlanBody } from "@/components/meals/PlanBody";
import { Empty } from "@/components/ui/Empty";
import { primaryBtnStyle, ghostBtnStyle } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";
import { CYCLE_DAYS } from "@/lib/config";
import type { Plan } from "@/lib/types";

export default function PlanPage() {
  const supabase = createClient();
  const [current, setCurrent] = useState<Plan | null>(null);
  const [queued, setQueued] = useState<Plan | null>(null);
  const [view, setView] = useState<"current" | "next">("current");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { loadPlans(); }, []);

  async function loadPlans() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const [{ data: cur }, { data: q }] = await Promise.all([
      supabase.from("plans").select("*").eq("user_id", user.id).eq("status", "current").single(),
      supabase.from("plans").select("*").eq("user_id", user.id).eq("status", "queued").single(),
    ]);
    if (cur) setCurrent(cur as unknown as Plan);
    if (q) setQueued(q as unknown as Plan);
  }

  async function rebuild() {
    setGenerating(true); setError("");
    try {
      const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "current" }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      loadPlans();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setGenerating(false); }
  }

  async function planNext() {
    setGenerating(true); setError("");
    try {
      const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "queued" }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      loadPlans();
      setView("next");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setGenerating(false); }
  }

  async function startNext() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (current) await supabase.from("plans").update({ status: "archived" }).eq("id", current.id);
    if (queued) {
      await supabase.from("plans").update({ status: "current", generated_at: new Date().toISOString() }).eq("id", queued.id);
    } else {
      await planNext();
    }
    setView("current");
    loadPlans();
  }

  if (!current) {
    return (
      <div style={{ paddingTop: 16 }}>
        <Empty
          icon={Sparkles}
          title="No plan yet"
          body={`Build your first ${CYCLE_DAYS}-day cycle from the Today tab.`}
        />
      </div>
    );
  }

  const showing = view === "next" && queued ? queued : current;

  return (
    <div style={{ paddingTop: 16 }}>
      {queued && (
        <div
          style={{
            display: "flex",
            gap: 6,
            marginBottom: 14,
            background: "#101013",
            border: "1px solid #2a2a2e",
            borderRadius: 12,
            padding: 4,
          }}
        >
          {(["current", "next"] as const).map((id) => (
            <button
              key={id}
              onClick={() => setView(id)}
              style={{
                flex: 1,
                padding: "9px 0",
                borderRadius: 9,
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--font-body)",
                fontWeight: 700,
                fontSize: 13,
                background: view === id ? "var(--accent)" : "transparent",
                color: view === id ? "#140a06" : "var(--muted)",
              }}
            >
              {id === "current" ? "This cycle" : "Next cycle"}
            </button>
          ))}
        </div>
      )}

      <PlanBody plan={showing} />

      {error && <div style={{ color: "#ff8a6a", fontSize: 13, padding: "0 2px 12px" }}>{error}</div>}

      {view === "current" && (
        <button
          onClick={rebuild}
          disabled={generating}
          style={{ ...ghostBtnStyle, width: "100%", justifyContent: "center", marginBottom: 14 }}
        >
          <Sparkles size={15} /> {generating ? "Rebuilding…" : "Rebuild this cycle"}
        </button>
      )}

      {queued ? (
        <Card accent>
          <Label icon={CalendarPlus}>Next cycle — queued</Label>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", margin: "6px 0 10px" }}>
            Preview it with the toggle above. Shop ahead from its grocery list, then start it whenever.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={startNext} style={primaryBtnStyle}><CalendarPlus size={15} /> Start it now</button>
            <button onClick={planNext} disabled={generating} style={ghostBtnStyle}>Re-plan next</button>
          </div>
        </Card>
      ) : (
        <Card>
          <Label icon={CalendarPlus}>Plan ahead</Label>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", margin: "6px 0 12px" }}>
            Build your next {CYCLE_DAYS} days now so you can grocery-shop before this cycle ends.
          </div>
          <button onClick={planNext} disabled={generating} style={primaryBtnStyle}>
            <CalendarPlus size={15} /> {generating ? "Building…" : `Plan next ${CYCLE_DAYS} days`}
          </button>
        </Card>
      )}
    </div>
  );
}
