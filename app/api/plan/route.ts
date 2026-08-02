import { NextResponse, after } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
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

// Background builds keep generating after the response is sent, so the phone
// isn't held on a spinner and closing the app no longer loses the result. The
// work still runs inside this function's maxDuration. It uses a service-role
// client because the request's cookie-bound session is gone by then.
function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

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

    // ── Background path ─────────────────────────────────────────────────────
    // Record the build, return immediately, and generate after the response is
    // sent. The client polls GET /api/plan/build instead of holding the
    // connection open for the whole multi-minute generation.
    if (body.background === true) {
      const admin = serviceClient();
      if (!admin) return NextResponse.json({ error: "Background builds are not configured" }, { status: 500 });

      // One in-flight build at a time — a second tap joins the existing build
      // rather than paying for a duplicate generation.
      const { data: inFlight } = await supabase
        .from("plan_builds")
        .select("id")
        .eq("user_id", user.id)
        .eq("status", "building")
        .gte("started_at", new Date(Date.now() - maxDuration * 1000).toISOString())
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (inFlight) return NextResponse.json({ buildId: inFlight.id, alreadyRunning: true }, { status: 202 });

      const { data: build, error: buildErr } = await admin
        .from("plan_builds")
        .insert({
          user_id: user.id,
          status: "building",
          mode,
          start_date: startDate,
          user_notes: userNotes,
          no_adjustments: noAdjustments,
        })
        .select("id")
        .single();
      if (buildErr || !build) {
        return NextResponse.json({ error: buildErr?.message ?? "Could not start the build" }, { status: 500 });
      }

      after(async () => {
        const finish = (patch: Record<string, unknown>) =>
          admin.from("plan_builds")
            .update({ ...patch, finished_at: new Date().toISOString() })
            .eq("id", build.id);
        try {
          const result = await generateAndSavePlan({
            supabase: admin,
            userId: user.id,
            mode,
            userNotes,
            noAdjustments,
            startDate,
            deadlineMs: GENERATION_DEADLINE_MS,
          });
          if (result.ok) {
            await finish({ status: "done", plan_id: (result.plan as { id?: string } | null)?.id ?? null });
          } else {
            await finish({ status: "error", error: result.error });
          }
        } catch (e) {
          console.error("background plan build failed", e);
          await finish({ status: "error", error: e instanceof Error ? e.message : "Build failed" });
        }
      });

      return NextResponse.json({ buildId: build.id }, { status: 202 });
    }

    // ── Synchronous path (local scripts, non-browser callers) ───────────────
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
