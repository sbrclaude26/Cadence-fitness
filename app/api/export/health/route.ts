import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { localDateStr } from "@/lib/date";

// Outbound export for Apple Health.
//
// A PWA has no HealthKit access, so Cadence can't write to Health directly.
// The path that does work is the mirror of the inbound ingest routes: an iOS
// Shortcut fetches this endpoint and writes each row with "Log Health Sample".
// Token-authed with the same per-user token as /api/ingest/* (the token lives
// in profiles.vitals_ingest_token — legacy column name, shared by every
// Shortcut integration), because Shortcuts can't hold a browser session.
//
// Workouts are deliberately absent: Shortcuts cannot create workout samples,
// so exporting them would need a native app. Weight and nutrition are the
// writable set.

const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;

interface DayRow {
  date: string;
  weightLb: number | null;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const token = request.headers.get("X-Cadence-Ingest-Token")
    ?? request.headers.get("X-Vitals-Token")
    ?? searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

  const supabase = createServiceClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("vitals_ingest_token", token)
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  const userId = profile.user_id as string;

  // `days` bounds how far back to export. The Shortcut runs on a schedule and
  // re-sends the recent window; Health de-duplicates identical samples, and a
  // small window keeps the payload phone-friendly.
  const daysParam = parseInt(searchParams.get("days") ?? "", 10);
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, MAX_DAYS) : DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const [{ data: weights }, { data: meals }] = await Promise.all([
    supabase.from("weight_logs").select("date, value").eq("user_id", userId).gte("date", since).order("date"),
    supabase.from("meal_logs").select("date, calories, protein, carbs, fat").eq("user_id", userId).gte("date", since),
  ]);

  const byDate = new Map<string, DayRow>();
  const row = (date: string): DayRow => {
    let r = byDate.get(date);
    if (!r) {
      r = { date, weightLb: null, calories: null, proteinG: null, carbsG: null, fatG: null };
      byDate.set(date, r);
    }
    return r;
  };

  // Multiple weigh-ins on one day: take the lowest, matching how the Trends
  // chart plots a day (a single canonical number per day, least water-loaded).
  for (const w of weights ?? []) {
    const value = Number(w.value);
    if (!Number.isFinite(value)) continue;
    const r = row(w.date as string);
    r.weightLb = r.weightLb == null ? value : Math.min(r.weightLb, value);
  }

  for (const m of meals ?? []) {
    const r = row(m.date as string);
    r.calories = (r.calories ?? 0) + (Number(m.calories) || 0);
    r.proteinG = (r.proteinG ?? 0) + (Number(m.protein) || 0);
    r.carbsG = (r.carbsG ?? 0) + (Number(m.carbs) || 0);
    r.fatG = (r.fatG ?? 0) + (Number(m.fat) || 0);
  }

  const round1 = (n: number | null) => (n == null ? null : Math.round(n * 10) / 10);
  const rows = [...byDate.values()]
    .map((r) => ({
      ...r,
      weightLb: round1(r.weightLb),
      calories: r.calories == null ? null : Math.round(r.calories),
      proteinG: round1(r.proteinG),
      carbsG: round1(r.carbsG),
      fatG: round1(r.fatG),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return NextResponse.json(
    { generatedAt: localDateStr(), days: rows.length, records: rows },
    // Always fresh: the Shortcut runs on a schedule and must not be served a
    // cached window that predates today's logging.
    { headers: { "Cache-Control": "no-store" } },
  );
}
