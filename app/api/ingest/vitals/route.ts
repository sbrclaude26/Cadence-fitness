import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { localDateStr } from "@/lib/date";

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
    const {
      date: rawDate,
      restingHR,
      avgHR,
      activeEnergyKcal,
      steps,
      sleepHours,
      sleepEfficiencyPct,
      hrvSdnnMs,
    } = body;

    // Honor a literal YYYY-MM-DD if Apple sent one (the common case) — re-parsing
    // through Date would convert to UTC and roll evening readings to the next day.
    // Server runtime is UTC on Vercel, so localDateStr() is only a best-effort
    // fallback when no usable date is supplied.
    let date = localDateStr();
    if (rawDate !== undefined && rawDate !== null && rawDate !== "") {
      if (typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        date = rawDate;
      } else {
        const parsed = new Date(rawDate);
        if (isNaN(parsed.getTime())) {
          return NextResponse.json({ error: `Unparseable date: ${rawDate}` }, { status: 400 });
        }
        date = localDateStr(parsed);
      }
    }
    // Reject dates more than 1 day in the future (clock skew tolerance).
    // A misconfigured shortcut sending "2099-01-01" should fail loud, not store silently.
    const tomorrow = localDateStr(new Date(Date.now() + 86400000));
    if (date > tomorrow) {
      return NextResponse.json({ error: `Date too far in the future: ${date}` }, { status: 400 });
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
    const slp = safeFloat(sleepHours);
    const slpEff = safeFloat(sleepEfficiencyPct);
    const hrv = safeFloat(hrvSdnnMs);

    // Don't write a row if every field is empty
    if (rhr === null && ahr === null && kcal === null && stps === null && slp === null && slpEff === null && hrv === null) {
      return NextResponse.json({ ok: true, skipped: "no valid data fields" });
    }

    const update: Record<string, unknown> = { user_id: profile.user_id, date, source: "healthkit" };
    if (rhr !== null) update.resting_hr = rhr;
    if (ahr !== null) update.avg_hr = ahr;
    if (kcal !== null) update.active_energy_kcal = kcal;
    if (stps !== null) update.steps = stps;
    if (slp !== null) update.sleep_hours = slp;
    if (slpEff !== null) update.sleep_efficiency_pct = slpEff;
    if (hrv !== null) update.hrv_sdnn_ms = hrv;

    const { error } = await supabase.from("vitals").upsert(update, { onConflict: "user_id,date" });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
