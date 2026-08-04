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
import { usePlanBuild } from "@/lib/usePlanBuild";
import { useSnapshot } from "@/lib/snapshotCache";
import { PlanBuildBanner } from "@/components/PlanBuildBanner";
import type { Plan, MealRecipe } from "@/lib/types";

export default function PlanPage() {
  const supabase = createClient();
  // Snapshotted so the cycle write-up is on screen immediately on return.
  const [current, setCurrent] = useSnapshot<Plan | null>("plan.current", null);
  const [queued, setQueued] = useSnapshot<Plan | null>("plan.queued", null);
  const [recipes, setRecipes] = useSnapshot<MealRecipe[]>("plan.recipes", []);
  const [view, setView] = useState<"current" | "next">("current");
  const [mode, setMode] = useState<"cycle" | "schedule" | "prep" | "recipes">("cycle");
  const [error, setError] = useState("");
  const [notesModal, setNotesModal] = useState<null | "current" | "queued">(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [startDateDraft, setStartDateDraft] = useState(localDateStr());
  // Recipes are the second-largest block of generated output. Remembered
  // between builds so an athlete who never uses them isn't re-ticking it every
  // cycle.
  const [includeRecipes, setIncludeRecipes] = useSnapshot<boolean>("plan.includeRecipes", true);
  // Background build: the server keeps generating after the response, so this
  // only tracks status — including a build started before the page mounted.
  const { building, elapsedS, error: buildError, startBuild, starting } = usePlanBuild((build) => {
    loadPlans();
    if (build.status === "done" && build.mode === "queued") setView("next");
  });

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    await Promise.all([loadPlans(), loadRecipes()]);
  }

  async function loadPlans() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    // maybeSingle, not single: having no queued plan is the normal state, and
    // single() answers that with a 406 that took the whole Promise.all down —
    // which silently left the page rendering "No plan yet" over a real plan.
    const [{ data: cur }, { data: q }] = await Promise.all([
      supabase.from("plans").select("*").eq("user_id", user.id).eq("status", "current").maybeSingle(),
      supabase.from("plans").select("*").eq("user_id", user.id).eq("status", "queued").maybeSingle(),
    ]);
    setCurrent((cur as unknown as Plan) ?? null);
    setQueued((q as unknown as Plan) ?? null);
  }

  async function loadRecipes() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from("meal_recipes").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    if (data) setRecipes(data as MealRecipe[]);
  }

  async function buildPlan(mode: "current" | "queued", opts: { userNotes?: string; noAdjustments?: boolean; startDate?: string }) {
    setError("");
    const ok = await startBuild({ mode, includeRecipes, ...opts });
    if (ok) { setNotesModal(null); setNotesDraft(""); }
  }

  function openNotes(mode: "current" | "queued") {
    setNotesDraft("");
    setStartDateDraft(localDateStr());
    setNotesModal(mode);
  }

  async function startNext() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    if (!queued) {
      // Nothing to promote — kick off a build and leave the current cycle in
      // place. Archiving first would strand the athlete with no plan for the
      // several minutes the background build takes.
      await buildPlan("queued", {});
      return;
    }
    if (current) await supabase.from("plans").update({ status: "archived" }).eq("id", current.id);
    // Promoting a queued plan: its Day 1 begins today.
    await supabase.from("plans").update({ status: "current", generated_at: new Date().toISOString(), cycle_start_date: localDateStr() }).eq("id", queued.id);
    setView("current");
    loadPlans();
  }

  const showing = view === "next" && queued ? queued : current;

  const MODES: { id: "cycle" | "schedule" | "prep" | "recipes"; label: string }[] = [
    { id: "cycle", label: "Cycle Info" },
    { id: "prep", label: "Meals" },
    { id: "schedule", label: "Workouts" },
    { id: "recipes", label: "Recipes" },
  ];

  return (
    <div style={{ paddingTop: 16 }}>
      {building && <PlanBuildBanner elapsedS={elapsedS} />}

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

      {mode === "cycle" && current && showing && <PlanReview plan={showing} />}

      {mode === "recipes" ? (
        <RecipesView recipes={recipes} onRefresh={loadRecipes} />
      ) : !current ? (
        <Empty icon={Sparkles} title="No plan yet" body={`Build your first ${CYCLE_DAYS}-day cycle from the Today tab.`} />
      ) : mode === "schedule" ? (
        <PlanBody
          plan={showing!}
          onReorderDays={async (dayOrder) => {
            const res = await fetch("/api/plan/day-reorder", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ planId: showing!.id, dayOrder }),
            });
            if (!res.ok) {
              const j = await res.json().catch(() => ({}));
              throw new Error(j.error || "Reorder failed");
            }
            await loadPlans();
          }}
        />
      ) : mode === "prep" ? (
        <RecipeSuggestionsView plan={showing!} />
      ) : null}

      {(error || buildError) && <div style={{ color: "#ff8a6a", fontSize: 13, padding: "0 2px 12px" }}>{error || buildError}</div>}

      {mode === "cycle" && current && (
        <>
          {view === "current" && (
            <button onClick={() => openNotes("current")} disabled={building} style={{ ...ghostBtnStyle, width: "100%", justifyContent: "center", marginBottom: 14 }}>
              <Sparkles size={15} /> {building ? "Building…" : "Rebuild this cycle"}
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
                <button onClick={() => openNotes("queued")} disabled={building} style={ghostBtnStyle}>Re-plan next</button>
              </div>
            </Card>
          ) : (
            <Card>
              <Label icon={CalendarPlus}>Plan ahead</Label>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", margin: "6px 0 12px" }}>
                Build your next {CYCLE_DAYS} days now so you can grocery-shop before this cycle ends.
              </div>
              <button onClick={() => openNotes("queued")} disabled={building} style={primaryBtnStyle}>
                <CalendarPlus size={15} /> {building ? "Building…" : `Plan next ${CYCLE_DAYS} days`}
              </button>
            </Card>
          )}
        </>
      )}

      {notesModal && (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => !starting && setNotesModal(null)}
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
              disabled={starting}
              // iOS Safari gives date inputs an intrinsic width that ignores
              // width:100% unless the native appearance is reset.
              style={{ ...inputStyle, marginBottom: 12, colorScheme: "dark", WebkitAppearance: "none", appearance: "none", display: "block", maxWidth: "100%", minHeight: 44, textAlign: "left" }}
            />
            <label style={{
              display: "flex", alignItems: "flex-start", gap: 9, cursor: "pointer",
              background: "#101013", border: "1px solid #2a2a2e", borderRadius: 10,
              padding: "10px 12px", marginBottom: 12,
            }}>
              <input
                type="checkbox"
                checked={includeRecipes}
                onChange={(e) => setIncludeRecipes(e.target.checked)}
                disabled={starting}
                style={{ accentColor: "var(--accent)", width: 17, height: 17, marginTop: 1, flexShrink: 0 }}
              />
              <span>
                <span style={{ display: "block", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>
                  Build meal recipes
                </span>
                <span style={{ display: "block", fontFamily: "var(--font-body)", fontSize: 11.5, color: "var(--muted)", marginTop: 2, lineHeight: 1.45 }}>
                  Batch recipes and a shopping list. Skipping them makes the build faster and cheaper — your
                  calorie and macro targets are unaffected.
                </span>
              </span>
            </label>

            <textarea
              value={notesDraft}
              onChange={(e) => {
                setNotesDraft(e.target.value);
                // Auto-grow with content, capped so the buttons stay reachable.
                const el = e.currentTarget;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 320)}px`;
              }}
              placeholder="e.g. last cycle was great, more variety in protein, craving sweets, lifts felt easy…"
              rows={6}
              maxLength={10000}
              disabled={starting}
              style={{ ...textareaStyle, marginBottom: 12, maxHeight: 320, overflowY: "auto", resize: "none" }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={() => buildPlan(notesModal, { userNotes: notesDraft, startDate: startDateDraft })}
                disabled={starting}
                style={{ ...primaryBtnStyle, justifyContent: "center" }}
              >
                <Sparkles size={15} /> {starting ? "Starting…" : notesDraft.trim() ? "Build with these notes" : "Build from data alone"}
              </button>
              <button
                onClick={() => buildPlan(notesModal, { noAdjustments: true, startDate: startDateDraft })}
                disabled={starting}
                style={{ ...ghostBtnStyle, justifyContent: "center" }}
              >
                No adjustments — confirm cycle build
              </button>
              <button
                onClick={() => setNotesModal(null)}
                disabled={starting}
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
