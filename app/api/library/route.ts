import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { WorkoutLibraryEntry } from "@/lib/workoutLibrary";

// GET /api/library — returns the full exercise library.
// The library is non-sensitive reference data shared across all users; we still
// require an authenticated session to keep it off the public internet.

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("workout_library")
    .select("slug,name,category,level,force,mechanic,equipment,primary_muscles,secondary_muscles,description,summary")
    .order("name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const entries = (data ?? []) as WorkoutLibraryEntry[];
  return NextResponse.json(
    { entries },
    {
      headers: {
        // Library updates only on a fresh deploy/seed — safe to cache for an
        // hour on the browser to keep the picker instant after first open.
        "Cache-Control": "private, max-age=3600",
      },
    },
  );
}
