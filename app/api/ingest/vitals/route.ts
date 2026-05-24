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
    const { date, restingHR, avgHR, activeEnergyKcal, steps } = body;

    if (!date) return NextResponse.json({ error: "date is required", received: body }, { status: 400 });

    const { error } = await supabase.from("vitals").upsert(
      {
        user_id: profile.user_id,
        date,
        resting_hr: restingHR != null ? parseInt(restingHR) : null,
        avg_hr: avgHR != null ? parseInt(avgHR) : null,
        active_energy_kcal: activeEnergyKcal != null ? parseFloat(activeEnergyKcal) : null,
        steps: steps != null ? parseInt(steps) : null,
        source: "healthkit",
      },
      { onConflict: "user_id,date" }
    );

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
