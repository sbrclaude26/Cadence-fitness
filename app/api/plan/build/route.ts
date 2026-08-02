import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Status of the athlete's most recent background cycle build.
//
// The client polls this while a build runs, and also checks it on mount so a
// build started before the app was closed is picked up when they come back.
// A build older than this window is ignored — it's history, not something the
// UI should resume waiting on.
const RECENT_WINDOW_MS = 30 * 60_000;
// The generating function can't outlive its own maxDuration, so a "building"
// row older than that was killed mid-flight (a deploy, a platform timeout)
// and will never report back.
const STALE_AFTER_MS = 320_000;

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: build, error } = await supabase
    .from("plan_builds")
    .select("id, status, mode, error, started_at, finished_at, plan_id")
    .eq("user_id", user.id)
    .gte("started_at", new Date(Date.now() - RECENT_WINDOW_MS).toISOString())
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!build) return NextResponse.json({ build: null });

  const ageMs = Date.now() - new Date(build.started_at).getTime();
  if (build.status === "building" && ageMs > STALE_AFTER_MS) {
    return NextResponse.json({
      build: { ...build, status: "error", error: "The build stopped unexpectedly. Try again." },
    });
  }

  return NextResponse.json({ build, elapsedMs: ageMs });
}
