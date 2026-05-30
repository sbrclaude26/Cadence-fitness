"use client";

import { useEffect, useState } from "react";
import { Sparkles, Dumbbell, GripVertical } from "lucide-react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card } from "@/components/ui/Card";
import { Label } from "@/components/ui/Label";
import { RichText } from "@/components/ui/RichText";
import { parsePlanSummary } from "@/lib/planSummary";
import { exerciseDetailLabel } from "@/lib/exerciseLabel";
import { planStartDate } from "@/lib/planResolve";
import type { Plan, PlanDay } from "@/lib/types";

// The AI emits day labels like "Friday — Upper Push" or "Sunday — Hotel
// Upper Pull (Travel)". After a drag-reorder the original weekday is wrong
// for the new date — recompute it from cycle_start_date + position so the
// header always matches the calendar date the slot now falls on.
function weekdayFor(planStart: string, offsetDays: number): string {
  const d = new Date(planStart + "T00:00:00");
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-US", { weekday: "long" });
}

const WEEKDAY_PREFIX = /^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s*[—\-:|]\s*/i;
const DAY_N_PREFIX = /^Day\s+\d+\s*[—\-:|]\s*/i;

function labelWithWeekday(rawLabel: string | undefined, weekday: string, fallback: string): string {
  const base = (rawLabel ?? "").trim();
  if (!base) return `${weekday.toUpperCase()} — ${fallback.toUpperCase()}`;
  const stripped = base.replace(WEEKDAY_PREFIX, "").replace(DAY_N_PREFIX, "").trim();
  if (!stripped) return weekday.toUpperCase();
  return `${weekday.toUpperCase()} — ${stripped.toUpperCase()}`;
}

interface Props {
  plan: Plan;
  // When provided, day cards become drag-to-reorder. Receives the new order
  // as the original day-slot indices (0-based). Parent persists + reloads.
  onReorderDays?: (dayOrder: number[]) => Promise<void> | void;
}

export function PlanBody({ plan, onReorderDays }: Props) {
  const summary = parsePlanSummary(plan.what_changed);
  // Track day order as original-slot indices so labels travel with their
  // workout when reordered (the user is explicitly moving a workout to a
  // new date — the label is part of the workout, not the date).
  const [order, setOrder] = useState<number[]>(() => plan.days.map((_, i) => i));

  // Resync if the plan reloads (e.g. after the parent re-fetches post-save).
  useEffect(() => {
    setOrder(plan.days.map((_, i) => i));
  }, [plan.days]);

  const sortableIds = order.map((slot) => `day-${slot}`);
  const draggable = Boolean(onReorderDays);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = sortableIds.indexOf(String(active.id));
    const newIdx = sortableIds.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(order, oldIdx, newIdx);
    const prev = order;
    setOrder(next);
    if (onReorderDays) {
      Promise.resolve(onReorderDays(next)).catch((e) => {
        console.error("day reorder failed", e);
        setOrder(prev);
      });
    }
  }

  return (
    <>
      {summary.implementationWorkouts && (
        <Card accent>
          <Label icon={Sparkles}>This cycle — Workouts</Label>
          <RichText text={summary.implementationWorkouts} />
        </Card>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {order.map((slot, position) => {
            const weekday = weekdayFor(planStartDate(plan), position);
            const day = plan.days[slot];
            return (
              <SortableDayCard
                key={`day-${slot}`}
                sortableId={`day-${slot}`}
                day={day}
                headerLabel={labelWithWeekday(day.label, weekday, `Day ${position + 1}`)}
                draggable={draggable}
              />
            );
          })}
        </SortableContext>
      </DndContext>
    </>
  );
}

function SortableDayCard({
  sortableId,
  day,
  headerLabel,
  draggable,
}: {
  sortableId: string;
  day: PlanDay;
  headerLabel: string;
  draggable: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sortableId });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
    position: "relative",
  };

  return (
    <div ref={setNodeRef} style={style}>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {draggable && (
            <button
              {...attributes}
              {...listeners}
              aria-label="Drag to reorder day"
              style={{
                padding: 4,
                marginLeft: -4,
                background: "transparent",
                border: "none",
                color: "#4a4a52",
                cursor: "grab",
                touchAction: "none",
              }}
            >
              <GripVertical size={14} />
            </button>
          )}
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 800,
              fontSize: 13,
              color: "var(--accent)",
              letterSpacing: "0.05em",
            }}
          >
            {headerLabel}
          </div>
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
              {day.workout?.name}
            </div>
            {day.workout?.exercises?.map((ex, k) => (
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
                  {exerciseDetailLabel(ex)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
