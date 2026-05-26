import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

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
    const { date: rawDate, workoutType, durationMin, distanceKm, distanceMiles, calories, avgHR, maxHR, notes } = body;

    if (!workoutType) return NextResponse.json({ error: "workoutType is required" }, { status: 400 });

    const todayUTC = new Date().toISOString().slice(0, 10);
    let date = todayUTC;
    if (rawDate) {
      const parsed = new Date(rawDate);
      date = isNaN(parsed.getTime()) ? todayUTC : parsed.toISOString().slice(0, 10);
    }

    const row: Record<string, unknown> = {
      user_id: profile.user_id,
      date,
      type: mapType(String(workoutType)),
      name: String(workoutType),
      source: "healthkit",
    };

    const duration = safeNum(durationMin);
    const distance = safeNum(distanceKm) ?? (safeNum(distanceMiles) !== null ? safeNum(distanceMiles)! * 1.60934 : null);
    const kcal = safeInt(calories);
    const avghr = safeInt(avgHR);
    const maxhr = safeInt(maxHR);

    if (duration !== null) row.duration_min = duration;
    if (distance !== null) row.distance_km = distance;
    if (kcal !== null) row.calories = kcal;
    if (avghr !== null) row.avg_hr = avghr;
    if (maxhr !== null) row.max_hr = maxhr;
    if (notes) row.notes = String(notes);

    const { error } = await supabase
      .from("workout_sessions")
      .upsert(row, { onConflict: "user_id,date,name", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
