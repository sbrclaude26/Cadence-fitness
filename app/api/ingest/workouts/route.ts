import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { localDateStr } from "@/lib/date";

const TYPE_MAP: Record<string, string> = {
  walking: "walk",
  running: "run",
  cycling: "cardio",
  "high intensity interval training": "cardio",
  hiit: "cardio",
  elliptical: "cardio",
  "stair climbing": "cardio",
  rowing: "cardio",
  "functional strength training": "strength",
  "traditional strength training": "strength",
  "core training": "strength",
  "cross training": "cardio",
};

function mapType(raw: string): "strength" | "cardio" | "walk" | "run" | "other" {
  const key = raw.toLowerCase().trim();
  const mapped = TYPE_MAP[key];
  if (mapped) return mapped as "strength" | "cardio" | "walk" | "run" | "other";
  if (key.includes("run")) return "run";
  if (key.includes("walk")) return "walk";
  if (key.includes("strength") || key.includes("weight") || key.includes("lift")) return "strength";
  if (key.includes("cardio") || key.includes("cycle") || key.includes("swim")) return "cardio";
  return "other";
}

function safeNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function safeInt(v: unknown): number | null {
  const n = safeNum(v);
  return n === null ? null : Math.round(n);
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    // Accept the new generic header, the legacy header (for existing iOS Shortcuts), or a query token.
    const token =
      request.headers.get("X-Cadence-Ingest-Token") ??
      request.headers.get("X-Vitals-Token") ??
      searchParams.get("token");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 401 });

    const supabase = createServiceClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id")
      .eq("vitals_ingest_token", token)
      .single();

    if (!profile) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

    const body = await request.json();
    const { date: rawDate, workoutType, durationMin, durationSec, distanceKm, distanceMiles, calories, avgHR, maxHR, notes, externalId } = body;

    if (!workoutType) return NextResponse.json({ error: "workoutType is required" }, { status: 400 });

    // Honor a literal YYYY-MM-DD if Apple sent one (the common case) — re-parsing
    // through Date would convert to UTC and roll evening workouts to the next day.
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
    const tomorrow = localDateStr(new Date(Date.now() + 86400000));
    if (date > tomorrow) {
      return NextResponse.json({ error: `Date too far in the future: ${date}` }, { status: 400 });
    }

    const row: Record<string, unknown> = {
      user_id: profile.user_id,
      date,
      type: mapType(String(workoutType)),
      name: String(workoutType),
    };

    // Prefer durationSec (HealthKit returns Duration in seconds); fall back to
    // durationMin. If a "minutes" value is implausibly large, treat as seconds.
    let duration = safeNum(durationSec);
    if (duration !== null) duration = duration / 60;
    if (duration === null) {
      const dm = safeNum(durationMin);
      if (dm !== null) duration = dm > 360 ? dm / 60 : dm;
    }
    const distance = safeNum(distanceKm) ?? (safeNum(distanceMiles) !== null ? safeNum(distanceMiles)! * 1.60934 : null);
    const kcal = safeInt(calories);
    const avghr = safeInt(avgHR);
    const maxhr = safeInt(maxHR);
    const extId = externalId ? String(externalId).trim() : null;

    if (duration !== null) row.duration_min = Math.round(duration * 100) / 100;
    if (distance !== null) row.distance_km = distance;
    if (kcal !== null) row.calories = kcal;
    if (avghr !== null) row.avg_hr = avghr;
    if (maxhr !== null) row.max_hr = maxhr;
    if (notes) row.notes = String(notes);
    if (extId) row.external_id = extId;

    // Dedup on external_id when present (re-syncing the same HealthKit workout
    // shouldn't double-insert). Without it, accept the row as-is so two distinct
    // walks on the same date both land.
    const query = extId
      ? supabase.from("apple_workouts").upsert(row, { onConflict: "user_id,external_id", ignoreDuplicates: true })
      : supabase.from("apple_workouts").insert(row);
    const { error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
