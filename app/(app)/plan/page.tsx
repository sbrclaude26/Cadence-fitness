"use client";

import { useEffect, useState } from "react";
import { Sparkles, CalendarPlus } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { PlanBody } from "@/components/meals/PlanBody";
import { PlanReview } from "@/components/meals/PlanReview";
import { RecipeSuggestionsView } from "@/components/meals/RecipeSuggestionsView";
import { RecipesView } from "@/components/meals/RecipesView";
import { Empty } from "@/components/ui/Empty";
import { primaryBtnStyle, ghostBtnStyle, textareaStyle, inputStyle } from "@/components/ui/styles";
import { createClient } from "@/lib/supabase/client";
import { CYCLE_DAYS } from "@/lib/config";
import { localDateStr } from "@/lib/date";
import type { Plan, MealRecipe } from "@/lib/types";

export default function PlanPage() {
  const supabase = createClient();
  const [current, setCurrent] = useState<Plan | null>(null);
  const [queued, setQueued] = useState<Plan | null>(null);
  const [recipes, setRecipes] = useState<MealRecipe[]>([]);
  const [view, setView] = useState<"current" | "next">("current");
  const [mode, setMode] = useState<"schedule" | "prep" | "recipes">("prep");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [notesModal, setNotesModal] = useState<null | "current" | "queued">(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [startDateDraft, setStartDateDraft] = useState(localDateStr());

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    await Promise.all([loadPlans(), loadRecipes()]);
  }

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

  async function loadRecipes() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("meal_recipes").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    if (data) setRecipes(data as MealRecipe[]);
  }

  async function buildPlan(mode: "current" | "queued", opts: { userNotes?: string; noAdjustments?: boolean; startDate?: string }) {
    setGenerating(true); setError("");
    try {
      const body: { mode: "current" | "queued"; userNotes?: string; noAdjustments?: boolean; startDate?: string } = { mode };
      const trimmed = (opts.userNotes ?? "").trim();
      if (trimmed.length > 0) body.userNotes = trimmed;
      if (opts.noAdjustments) body.noAdjustments = true;
      if (opts.startDate) body.startDate = opts.startDate;
      const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      loadPlans();
      if (mode === "queued") setView("next");
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setGenerating(false); setNotesModal(null); setNotesDraft(""); }
  }

  function openNotes(mode: "current" | "queued") {
    setNotesDraft("");
    setStartDateDraft(localDateStr());
    setNotesModal(mode);
  }

  async function startNext() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (current) await supabase.from("plans").update({ status: "archived" }).eq("id", current.id);
    if (queued) {
      // Promoting a queued plan: its Day 1 begins today.
      await supabase.from("plans").update({ status: "current", generated_at: new Date().toISOString(), cycle_start_date: localDateStr() }).eq("id", queued.id);
    } else {
      await buildPlan("queued", {});
    }
    setView("current");
    loadPlans();
  }

  const showing = view === "next" && queued ? queued : current;

  const MODES: { id: "schedule" | "prep" | "recipes"; label: string }[] = [
    { id: "prep", label: "Meal Prep" },
    { id: "schedule", label: "Workouts" },
    { id: "recipes", label: "My Recipes" },
  ];

  return (
    <div style={{ paddingTop: 16 }}>
      {/* This cycle / Next cycle toggle */}
      {queued && (
        <div style={{ display: "flex", gap: 6, marginBottom: 14, background: "#101013", border: "1px solid #2a2a2e", borderRadius: 12, padding: 4 }}>
          {(["current", "next"] as const).map((id) => (
            <button key={id} onClick={() => setView(id)} style={{
              flex: 1, padding: "9px 0", borderRadius: 9, border: "none", cursor: "pointer",
              fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 13,
              background: view === id ? "var(--accent)" : "transparent",
              color: view === id ? "#140a06" : "var(--muted)",
            }}>
              {id === "current" ? "This cycle" : "Next cycle"}
            </button>
          ))}
        </div>
      )}

      {/* Mode tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14, background: "#101013", border: "1px solid #2a2a2e", borderRadius: 12, padding: 4 }}>
        {MODES.map(({ id, label }) => (
          <button key={id} onClick={() => setMode(id)} style={{
            flex: 1, padding: "9px 0", borderRadius: 9, border: "none", cursor: "pointer",
            fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 12,
            background: mode === id ? "#2a2a2e" : "transparent",
            color: mode === id ? "var(--ink)" : "var(--muted)",
          }}>
            {label}
          </button>
        ))}
      </div>

      {mode !== "recipes" && current && showing && <PlanReview plan={showing} />}

      {mode === "recipes" ? (
        <RecipesView recipes={recipes} onRefresh={loadRecipes} />
      ) : !current ? (
        <Empty icon={Sparkles} title="No plan yet" body={`Build your first ${CYCLE_DAYS}-day cycle from the Today tab.`} />
      ) : mode === "schedule" ? (
        <PlanBody plan={showing!} />
      ) : (
        <RecipeSuggestionsView plan={showing!} />
      )}

      {error && <div style={{ color: "#ff8a6a", fontSize: 13, padding: "0 2px 12px" }}>{error}</div>}

      {mode !== "recipes" && current && (
        <>
          {view === "current" && (
            <button onClick={() => openNotes("current")} disabled={generating} style={{ ...ghostBtnStyle, width: "100%", justifyContent: "center", marginBottom: 14 }}>
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
                <button onClick={() => openNotes("queued")} disabled={generating} style={ghostBtnStyle}>Re-plan next</button>
              </div>
            </Card>
          ) : (
            <Card>
              <Label icon={CalendarPlus}>Plan ahead</Label>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", margin: "6px 0 12px" }}>
                Build your next {CYCLE_DAYS} days now so you can grocery-shop before this cycle ends.
              </div>
              <button onClick={() => openNotes("queued")} disabled={generating} style={primaryBtnStyle}>
                <CalendarPlus size={15} /> {generating ? "Building…" : `Plan next ${CYCLE_DAYS} days`}
              </button>
            </Card>
          )}
        </>
      )}

      {notesModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => !generating && setNotesModal(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
            zIndex: 100, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#15151a", border: "1px solid #2a2a2e", borderRadius: 16,
              width: "100%", maxWidth: 440, padding: 18, boxSizing: "border-box",
            }}
          >
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>
              {notesModal === "current" ? "Rebuild this cycle" : `Plan next ${CYCLE_DAYS} days`}
            </div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", marginBottom: 12 }}>
              Tell the Brain what worked, what didn&apos;t, or what you want different. It still leads with your goals and the data — cravings won&apos;t override a needed cut.
            </div>
            <label style={{ display: "block", fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.04em", marginBottom: 5 }}>
              CYCLE START (DAY 1)
            </label>
            <input
              type="date"
              value={startDateDraft}
              onChange={(e) => setStartDateDraft(e.target.value)}
              disabled={generating}
              style={{ ...inputStyle, marginBottom: 12, colorScheme: "dark" }}
            />
            <textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="e.g. last cycle was great, more variety in protein, craving sweets, lifts felt easy…"
              rows={5}
              maxLength={4000}
              disabled={generating}
              style={{ ...textareaStyle, marginBottom: 12 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={() => buildPlan(notesModal, { userNotes: notesDraft, startDate: startDateDraft })}
                disabled={generating}
                style={{ ...primaryBtnStyle, justifyContent: "center" }}
              >
                <Sparkles size={15} /> {generating ? "Building…" : notesDraft.trim() ? "Build with these notes" : "Build from data alone"}
              </button>
              <button
                onClick={() => buildPlan(notesModal, { noAdjustments: true, startDate: startDateDraft })}
                disabled={generating}
                style={{ ...ghostBtnStyle, justifyContent: "center" }}
              >
                No adjustments — confirm cycle build
              </button>
              <button
                onClick={() => setNotesModal(null)}
                disabled={generating}
                style={{
                  background: "transparent", border: "none", color: "var(--muted)",
                  fontFamily: "var(--font-body)", fontSize: 13, padding: "8px 0", cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
