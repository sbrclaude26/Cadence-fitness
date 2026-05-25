"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, ChevronUp, Trash2, Plus, Archive, Pencil, X } from "lucide-react";
import { MacroLine } from "@/components/ui/MacroLine";
import { InlineFoodLogger } from "@/components/meals/InlineFoodLogger";
import { ghostBtnStyle, inputStyle, primaryBtnStyle } from "@/components/ui/styles";
import type { MealLog, MealSlot, MealRecipe, MealPrepBatch } from "@/lib/types";

const SLOTS: MealSlot[] = ["Breakfast", "Lunch", "Dinner", "Snack"];

function currentSlot(): MealSlot {
  const h = new Date().getHours();
  if (h >= 5 && h < 11) return "Breakfast";
  if (h >= 11 && h < 15) return "Lunch";
  if (h >= 15 && h < 19) return "Dinner";
  return "Snack";
}

function SwipeToDelete({ onDelete, children }: { onDelete: () => void; children: React.ReactNode }) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const THRESHOLD = 72;

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
    setDragging(true);
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!dragging) return;
    const dx = e.touches[0].clientX - startX.current;
    if (dx < 0) setOffset(Math.max(-96, dx));
  }
  function onTouchEnd() {
    setDragging(false);
    if (offset <= -THRESHOLD) onDelete();
    else setOffset(0);
  }

  return (
    <div style={{ position: "relative", overflow: "hidden", borderRadius: 8 }}>
      <div style={{
        position: "absolute", right: 0, top: 0, bottom: 0, width: 80,
        background: "#c53030", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Trash2 size={18} color="white" />
      </div>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? "none" : "transform 0.2s ease",
          position: "relative", zIndex: 1,
          background: "var(--card)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const CHIPS = [25, 50, 75, 100] as const;

function defaultChipFor(batch: MealPrepBatch): number {
  const remaining = 100 - batch.consumed_pct;
  if (batch.suggested_servings && batch.suggested_servings > 0) {
    const oneServing = 100 / batch.suggested_servings;
    // Snap to nearest preset if within 5%, else use precise serving size.
    const closest = CHIPS.reduce((best, c) =>
      Math.abs(c - oneServing) < Math.abs(best - oneServing) ? c : best, CHIPS[0]);
    if (Math.abs(closest - oneServing) <= 5) return Math.min(closest, Math.ceil(remaining));
    return Math.min(Math.round(oneServing), Math.ceil(remaining));
  }
  return 25;
}

function BatchRow({
  batch,
  onLog,
  onArchive,
}: {
  batch: MealPrepBatch;
  onLog: (portionPct: number) => void;
  onArchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  // Keep the picker value as a string so the input can be emptied during editing.
  // Parsing only happens at render time for math + at submit time.
  const [pctInput, setPctInput] = useState<string>(() => String(defaultChipFor(batch)));
  const pct = parseFloat(pctInput);
  const pctValid = !isNaN(pct) && pct > 0;
  const remaining = Math.max(0, 100 - batch.consumed_pct);
  const clamped = pctValid ? Math.min(pct, remaining) : 0;
  const exceedsRemaining = pctValid && pct > remaining;
  const portion = clamped / 100;
  const cal = Math.round(batch.total_calories * portion);
  const prot = Math.round(batch.total_protein * portion);
  const carbs = Math.round(batch.total_carbs * portion);
  const fat = Math.round(batch.total_fat * portion);
  const oneServing = batch.suggested_servings && batch.suggested_servings > 0 ? 100 / batch.suggested_servings : null;
  const isApproxOneServing = pctValid && oneServing !== null && Math.abs(pct - oneServing) <= 3;

  return (
    <div style={{ marginBottom: 8, background: "#101013", border: "1px solid #2a2a2e", borderRadius: 10, padding: "10px 12px" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}
      >
        <div style={{ flex: 1, paddingRight: 8 }}>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
            {batch.name}
          </div>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
            {Math.round(remaining)}% left · whole batch: {Math.round(batch.total_calories)} kcal · P{Math.round(batch.total_protein)}
          </div>
        </div>
        {open ? <ChevronUp size={14} style={{ color: "var(--muted)" }} /> : <ChevronDown size={14} style={{ color: "var(--accent)" }} />}
      </button>

      {open && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1e1e22" }}>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em", marginBottom: 6 }}>
            HOW MUCH?
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            {CHIPS.map((c) => (
              <button
                key={c}
                onClick={() => setPctInput(String(c))}
                style={{
                  flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid",
                  borderColor: pct === c ? "var(--accent)" : "#2a2a2e",
                  background: pct === c ? "var(--accent)" : "transparent",
                  color: pct === c ? "#140a06" : "var(--ink)",
                  fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 12, cursor: "pointer",
                }}
              >
                {c}%
              </button>
            ))}
            <input
              value={pctInput}
              onChange={(e) => {
                const v = e.target.value;
                // Allow empty + partial decimal input while typing; validate at submit.
                if (v === "" || /^\d*\.?\d*$/.test(v)) {
                  const n = parseFloat(v);
                  if (!isNaN(n) && n > 100) setPctInput("100");
                  else setPctInput(v);
                }
              }}
              inputMode="decimal"
              style={{ ...inputStyle, width: 60, textAlign: "center" }}
            />
          </div>
          {isApproxOneServing && (
            <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "var(--accent)", marginBottom: 6 }}>
              ≈ 1 serving
            </div>
          )}
          {exceedsRemaining && (
            <div style={{ fontFamily: "var(--font-body)", fontSize: 11, color: "#ff8a6a", marginBottom: 6 }}>
              Only {Math.round(remaining)}% of this batch is left — capping the log at that.
            </div>
          )}
          <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
            → {cal} kcal · P{prot} C{carbs} F{fat}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => { onLog(clamped); setOpen(false); }}
              disabled={clamped <= 0}
              style={{ ...primaryBtnStyle, flex: 1, justifyContent: "center" }}
            >
              <Check size={14} /> Log {Math.round(clamped)}%
            </button>
            <button onClick={onArchive} style={{ ...ghostBtnStyle, padding: "0 10px" }} title="Mark this batch as finished without logging">
              <Archive size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type MealEdit = {
  date: string;
  slot?: MealSlot | "";
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

interface Props {
  batches: MealPrepBatch[];
  savedRecipes: MealRecipe[];
  loggedMeals: MealLog[];
  calorieTarget: number;
  onLogBatch: (batchId: string, portionPct: number, slot: MealSlot) => void;
  onLogMeal: (m: Omit<MealLog, "id" | "user_id" | "created_at">) => void;
  onDeleteMeal: (id: string) => void;
  onUpdateMeal?: (id: string, patch: MealEdit) => void;
  onArchiveBatch: (batchId: string) => void;
  date: string;
}

function EditMealForm({ meal, onSave, onCancel }: { meal: MealLog; onSave: (patch: MealEdit) => void; onCancel: () => void }) {
  const [d, setD] = useState(meal.date);
  const [s, setS] = useState<MealSlot | "">((meal.slot as MealSlot | undefined) ?? "");
  const [n, setN] = useState(meal.name);
  const [c, setC] = useState(String(meal.calories ?? ""));
  const [p, setP] = useState(String(meal.protein ?? ""));
  const [cb, setCb] = useState(String(meal.carbs ?? ""));
  const [f, setF] = useState(String(meal.fat ?? ""));
  return (
    <div style={{ padding: "10px 4px", background: "#101013", border: "1px solid #2a2a2e", borderRadius: 10, marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, padding: "0 8px" }}>
        <input type="date" value={d} onChange={(e) => setD(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
        <select value={s} onChange={(e) => setS(e.target.value as MealSlot | "")} style={{ ...inputStyle, maxWidth: 130 }}>
          <option value="">No slot</option>
          {SLOTS.map((sl) => <option key={sl} value={sl}>{sl}</option>)}
        </select>
      </div>
      <div style={{ padding: "0 8px", marginBottom: 8 }}>
        <input value={n} onChange={(e) => setN(e.target.value)} placeholder="Name" style={inputStyle} />
      </div>
      <div style={{ display: "flex", gap: 6, padding: "0 8px", marginBottom: 10 }}>
        <input value={c} onChange={(e) => setC(e.target.value)} placeholder="kcal" inputMode="numeric" style={{ ...inputStyle, textAlign: "center" }} />
        <input value={p} onChange={(e) => setP(e.target.value)} placeholder="P g" inputMode="decimal" style={{ ...inputStyle, textAlign: "center" }} />
        <input value={cb} onChange={(e) => setCb(e.target.value)} placeholder="C g" inputMode="decimal" style={{ ...inputStyle, textAlign: "center" }} />
        <input value={f} onChange={(e) => setF(e.target.value)} placeholder="F g" inputMode="decimal" style={{ ...inputStyle, textAlign: "center" }} />
      </div>
      <div style={{ display: "flex", gap: 6, padding: "0 8px" }}>
        <button
          onClick={() => onSave({
            date: d,
            slot: s || "",
            name: n,
            calories: parseFloat(c) || 0,
            protein: parseFloat(p) || 0,
            carbs: parseFloat(cb) || 0,
            fat: parseFloat(f) || 0,
          })}
          style={{ ...primaryBtnStyle, flex: 1, justifyContent: "center" }}
        >
          <Check size={14} /> Save
        </button>
        <button onClick={onCancel} style={{ ...ghostBtnStyle, padding: "0 12px" }}>
          <X size={13} />
        </button>
      </div>
    </div>
  );
}

export function FlexMealLogger({ batches, savedRecipes, loggedMeals, calorieTarget, onLogBatch, onLogMeal, onDeleteMeal, onUpdateMeal, onArchiveBatch, date }: Props) {
  const router = useRouter();
  const [slot, setSlot] = useState<MealSlot>(currentSlot());
  const [showRecipes, setShowRecipes] = useState(false);
  const [altOpen, setAltOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const totalCal = loggedMeals.reduce((s, m) => s + (m.calories || 0), 0);
  const totalProt = loggedMeals.reduce((s, m) => s + (m.protein || 0), 0);
  const totalCarbs = loggedMeals.reduce((s, m) => s + (m.carbs || 0), 0);
  const totalFat = loggedMeals.reduce((s, m) => s + (m.fat || 0), 0);

  const groupedLogs = SLOTS.map((s) => ({
    slot: s,
    meals: loggedMeals.filter((m) => m.slot === s),
  })).filter((g) => g.meals.length > 0);
  const unslottedLogs = loggedMeals.filter((m) => !m.slot);

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginTop: 12, marginBottom: 16, background: "#101013", border: "1px solid #2a2a2e", borderRadius: 12, padding: 4 }}>
        {SLOTS.map((s) => (
          <button key={s} onClick={() => { setSlot(s); setAltOpen(false); }} style={{
            flex: 1, padding: "8px 0", borderRadius: 9, border: "none", cursor: "pointer",
            fontFamily: "var(--font-body)", fontWeight: 700, fontSize: 11.5,
            background: slot === s ? "var(--accent)" : "transparent",
            color: slot === s ? "#140a06" : "var(--muted)",
          }}>
            {s}
          </button>
        ))}
      </div>

      {loggedMeals.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em", marginBottom: 8 }}>
            LOGGED — tap pencil to edit · swipe left to remove
          </div>
          {groupedLogs.map((group) => (
            <div key={group.slot} style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 700, color: "var(--accent)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4, paddingLeft: 4 }}>
                {group.slot}
              </div>
              {group.meals.map((m) => editingId === m.id && onUpdateMeal ? (
                <EditMealForm
                  key={m.id}
                  meal={m}
                  onSave={(patch) => { onUpdateMeal(m.id, patch); setEditingId(null); }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <SwipeToDelete key={m.id} onDelete={() => onDeleteMeal(m.id)}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 4px", borderBottom: "1px solid #1e1e22" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600 }}>
                        {m.name}
                        {m.portion_pct ? <span style={{ color: "var(--muted)", fontWeight: 400 }}> · {Math.round(m.portion_pct)}%</span> : null}
                      </div>
                      <MacroLine cal={m.calories} protein={m.protein} carbs={m.carbs} fat={m.fat} />
                    </div>
                    {onUpdateMeal && (
                      <button onClick={() => setEditingId(m.id)} aria-label="Edit" style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: 6, marginLeft: 4 }}>
                        <Pencil size={14} />
                      </button>
                    )}
                    <Check size={14} style={{ color: "#7fd494", flexShrink: 0, marginLeft: 4 }} />
                  </div>
                </SwipeToDelete>
              ))}
            </div>
          ))}
          {unslottedLogs.map((m) => editingId === m.id && onUpdateMeal ? (
            <EditMealForm
              key={m.id}
              meal={m}
              onSave={(patch) => { onUpdateMeal(m.id, patch); setEditingId(null); }}
              onCancel={() => setEditingId(null)}
            />
          ) : (
            <SwipeToDelete key={m.id} onDelete={() => onDeleteMeal(m.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 4px", borderBottom: "1px solid #1e1e22" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 600 }}>{m.name}</div>
                  <MacroLine cal={m.calories} protein={m.protein} carbs={m.carbs} fat={m.fat} />
                </div>
                {onUpdateMeal && (
                  <button onClick={() => setEditingId(m.id)} aria-label="Edit" style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: 6, marginLeft: 4 }}>
                    <Pencil size={14} />
                  </button>
                )}
                <Check size={14} style={{ color: "#7fd494", flexShrink: 0, marginLeft: 4 }} />
              </div>
            </SwipeToDelete>
          ))}
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.06em" }}>
            YOUR BATCHES
          </div>
          <button onClick={() => router.push("/prep")} style={{ ...ghostBtnStyle, padding: "4px 10px", fontSize: 12 }}>
            <Plus size={12} /> Prep a batch
          </button>
        </div>
        {batches.length === 0 ? (
          <div style={{ fontFamily: "var(--font-body)", fontSize: 13, color: "var(--muted)", padding: "8px 0" }}>
            No active batches. Cook something and tap &quot;Prep a batch&quot; to track it here.
          </div>
        ) : (
          batches.map((b) => (
            <BatchRow
              key={b.id}
              batch={b}
              onLog={(pct) => onLogBatch(b.id, pct, slot)}
              onArchive={() => onArchiveBatch(b.id)}
            />
          ))
        )}
      </div>

      {savedRecipes.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <button onClick={() => setShowRecipes(v => !v)} style={{ ...ghostBtnStyle, marginBottom: showRecipes ? 8 : 0, fontSize: 12 }}>
            {showRecipes ? <><ChevronUp size={13} /> Hide my recipes</> : <><ChevronDown size={13} /> My recipes ({savedRecipes.length})</>}
          </button>
          {showRecipes && savedRecipes.map((r) => (
            <button key={r.id} onClick={() => {
              onLogMeal({ date, slot, name: r.name, calories: r.calories, protein: r.protein, carbs: r.carbs, fat: r.fat, planned: false });
            }} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              width: "100%", padding: "10px 12px", marginBottom: 6,
              background: "#101013",
              border: "1px solid #2a2a2e",
              borderRadius: 10, cursor: "pointer", textAlign: "left",
            }}>
              <div style={{ flex: 1, paddingRight: 8 }}>
                <div style={{ fontFamily: "var(--font-body)", fontSize: 13.5, fontWeight: 600, color: "var(--ink)", marginBottom: 2 }}>{r.name}</div>
                <MacroLine cal={r.calories} protein={r.protein} carbs={r.carbs} fat={r.fat} />
              </div>
              <div style={{ fontFamily: "var(--font-display)", fontWeight: 800, fontSize: 16, color: "var(--accent)", flexShrink: 0 }}>+</div>
            </button>
          ))}
        </div>
      )}

      {altOpen ? (
        <InlineFoodLogger
          slotLabel={slot}
          onLog={(form) => {
            onLogMeal({ date, slot, name: form.name, calories: parseFloat(form.calories) || 0, protein: parseFloat(form.protein) || 0, carbs: parseFloat(form.carbs) || 0, fat: parseFloat(form.fat) || 0, planned: false });
            setAltOpen(false);
          }}
          onClose={() => setAltOpen(false)}
        />
      ) : (
        <div style={{ paddingTop: 4 }}>
          <button onClick={() => setAltOpen(true)} style={{ background: "none", border: "none", color: "var(--muted)", fontFamily: "var(--font-body)", fontSize: 12.5, cursor: "pointer", padding: "4px 0", textDecoration: "underline" }}>
            Ate something else
          </button>
        </div>
      )}

      {loggedMeals.length > 0 && (
        <div style={{ fontFamily: "var(--font-body)", fontSize: 12.5, color: "var(--ink)", paddingTop: 12, marginTop: 8, borderTop: "1px solid #232327", fontWeight: 600 }}>
          Today: {Math.round(totalCal)} / {calorieTarget} kcal · P{Math.round(totalProt)} C{Math.round(totalCarbs)} F{Math.round(totalFat)}
        </div>
      )}
    </div>
  );
}
