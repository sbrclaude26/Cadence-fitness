import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PlanDay } from "@/lib/types";

// PATCH /api/plan/reorder
// Body: { dayIndex: number, slotOrder: number[] }   // 0-based plan-slot indices in new order
//
// Reorders exercises within `days[dayIndex].workout.exercises` of the user's
// current plan. Drag-and-drop on the Today page calls this so the brain sees
// the order the athlete actually trained in. We key by slot index (not
// exercise name) so two slots with the same name (e.g. a warm-up walk + a
// zone-2 walk) reorder correctly without collapsing into one.
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const dayIndex = Number(body?.dayIndex);
    const slotOrder: unknown = body?.slotOrder;

    if (!Number.isInteger(dayIndex) || dayIndex < 0) {
      return NextResponse.json({ error: "Invalid dayIndex" }, { status: 400 });
    }
    if (!Array.isArray(slotOrder) || !slotOrder.every((n) => Number.isInteger(n) && n >= 0)) {
      return NextResponse.json({ error: "Invalid slotOrder" }, { status: 400 });
    }

    const { data: plan, error: planErr } = await supabase
      .from("plans")
      .select("id, days")
      .eq("user_id", user.id)
      .eq("status", "current")
      .single();
    if (planErr || !plan) return NextResponse.json({ error: "No current plan" }, { status: 404 });

    const days = plan.days as unknown as PlanDay[];
    if (dayIndex >= days.length) {
      return NextResponse.json({ error: "dayIndex out of range" }, { status: 400 });
    }

    const day = days[dayIndex];
    const current = day.workout?.exercises ?? [];

    const reordered = (slotOrder as number[])
      .map((idx) => current[idx])
      .filter((ex): ex is NonNullable<typeof ex> => Boolean(ex));

    // Preserve any slots the client didn't enumerate, in their original order.
    const enumerated = new Set(slotOrder as number[]);
    for (let i = 0; i < current.length; i++) {
      if (!enumerated.has(i)) reordered.push(current[i]);
    }

    const nextDays: PlanDay[] = days.map((d, i) =>
      i === dayIndex ? { ...d, workout: { ...d.workout, exercises: reordered } } : d
    );

    const { error: updateErr } = await supabase
      .from("plans")
      .update({ days: nextDays as unknown as object })
      .eq("id", plan.id)
      .eq("user_id", user.id);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
