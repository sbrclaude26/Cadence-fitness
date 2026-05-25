import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tokenFromQuery = searchParams.get("token");
    const tokenFromHeader = request.headers.get("X-Vitals-Token");
    const token = tokenFromHeader ?? tokenFromQuery;

    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabase = createServiceClient();

    // Look up user by vitals_ingest_token
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("vitals_ingest_token", token)
      .single();

    if (!profile) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const body = await request.json();
    const { date: rawDate, restingHR, avgHR, activeEnergyKcal, steps } = body;

    // Use provided date if valid, otherwise default to today (UTC)
    const todayUTC = new Date().toISOString().slice(0, 10);
    let date = todayUTC;
    if (rawDate) {
      const parsed = new Date(rawDate);
      date = isNaN(parsed.getTime()) ? todayUTC : parsed.toISOString().slice(0, 10);
    }

    function safeInt(v: unknown): number | null {
      if (v == null || v === "") return null;
      const n = parseInt(String(v), 10);
      return isNaN(n) ? null : n;
    }
    function safeFloat(v: unknown): number | null {
      if (v == null || v === "") return null;
      const n = parseFloat(String(v));
      return isNaN(n) ? null : n;
    }

    // Only upsert fields that have actual values — preserve existing data on partial updates
    const rhr = safeInt(restingHR);
    const ahr = safeInt(avgHR);
    const kcal = safeFloat(activeEnergyKcal);
    const stps = safeInt(steps);

    // Don't write a row if every field is empty
    if (rhr === null && ahr === null && kcal === null && stps === null) {
      return NextResponse.json({ ok: true, skipped: "no valid data fields" });
    }

    const update: Record<string, unknown> = { user_id: profile.user_id, date, source: "healthkit" };
    if (rhr !== null) update.resting_hr = rhr;
    if (ahr !== null) update.avg_hr = ahr;
    if (kcal !== null) update.active_energy_kcal = kcal;
    if (stps !== null) update.steps = stps;

    const { error } = await supabase.from("vitals").upsert(update, { onConflict: "user_id,date" });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
