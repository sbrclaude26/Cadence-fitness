import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { PlanDay } from "@/lib/types";

// PATCH /api/plan/day-reorder
// Body: { planId: string, dayOrder: number[] }   // 0-based day indices in new order
//
// Reorders the days[] array within a plan so the user can swap which workout
// falls on which date (Saturday's cardio onto Sunday, etc.). days[i] is what
// Today/Log render for the date i days after cycle_start_date, so swapping
// array slots is what "move this day onto that date" actually means.
//
// Day labels (e.g. "Sunday — Hotel Upper Pull") travel with the workout, so
// after a swap the user sees the original label on the new date — by design,
// since they explicitly chose to do that workout on that date.
export async function PATCH(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const planId: unknown = body?.planId;
    const dayOrder: unknown = body?.dayOrder;

    if (typeof planId !== "string" || planId.length === 0) {
      return NextResponse.json({ error: "Invalid planId" }, { status: 400 });
    }
    if (!Array.isArray(dayOrder) || !dayOrder.every((n) => Number.isInteger(n) && n >= 0)) {
      return NextResponse.json({ error: "Invalid dayOrder" }, { status: 400 });
    }

    const { data: plan, error: planErr } = await supabase
      .from("plans")
      .select("id, status, days")
      .eq("id", planId)
      .eq("user_id", user.id)
      .single();
    if (planErr || !plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    if (plan.status === "archived") {
      return NextResponse.json({ error: "Cannot reorder an archived plan" }, { status: 400 });
    }

    const days = plan.days as unknown as PlanDay[];
    const order = dayOrder as number[];

    // Must be a permutation of the existing day indices — no add/drop, no
    // out-of-range, no duplicates.
    if (order.length !== days.length) {
      return NextResponse.json({ error: "dayOrder length mismatch" }, { status: 400 });
    }
    const seen = new Set<number>();
    for (const i of order) {
      if (i >= days.length) return NextResponse.json({ error: "dayOrder index out of range" }, { status: 400 });
      if (seen.has(i)) return NextResponse.json({ error: "dayOrder has duplicates" }, { status: 400 });
      seen.add(i);
    }

    const reordered: PlanDay[] = order.map((i) => days[i]);

    const { error: updateErr } = await supabase
      .from("plans")
      .update({ days: reordered as unknown as object })
      .eq("id", plan.id)
      .eq("user_id", user.id);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
