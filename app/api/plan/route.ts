import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { localDateStr } from "@/lib/date";
import { generateAndSavePlan } from "@/lib/ai/generatePlan";

// Plan generation is one large multi-minute Claude call plus a reconciliation
// pass — 300s is the Vercel Hobby ceiling. Without this export the function
// runs at the project default and the gateway 504s mid-generation (the
// Anthropic call still completes and bills). Keep the generation deadline
// below this so the build fails loudly instead of being killed silently.
export const maxDuration = 300;
const GENERATION_DEADLINE_MS = 290_000;

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const mode: "current" | "queued" = body.mode ?? "current";
    const rawUserNotes = typeof body.userNotes === "string" ? body.userNotes.trim() : "";
    const userNotes = rawUserNotes.length > 0 ? rawUserNotes.slice(0, 8000) : null;
    const noAdjustments = body.noAdjustments === true;
    // Day-1 date the user picked for this cycle. Validate YYYY-MM-DD; default to
    // today (local). Stored as plans.cycle_start_date and used for all goal +
    // day-of-cycle resolution (see lib/planResolve.ts).
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(body.startDate ?? "")
      ? (body.startDate as string)
      : localDateStr();

    const result = await generateAndSavePlan({
      supabase,
      userId: user.id,
      mode,
      userNotes,
      noAdjustments,
      startDate,
      deadlineMs: GENERATION_DEADLINE_MS,
    });

    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result.deduped ? { plan: result.plan, deduped: true } : { plan: result.plan });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
