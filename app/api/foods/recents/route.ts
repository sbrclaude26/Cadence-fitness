import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchRecentFoods } from "@/lib/foodLibrary";

// GET /api/foods/recents?limit=8 — the user's frecency-ranked recent picks.
// POST /api/foods/recents { slug } — record a pick (bumps count + timestamp).

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const limitParam = parseInt(url.searchParams.get("limit") ?? "8", 10);
  const limit = isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 20) : 8;

  const { entries, error } = await fetchRecentFoods(supabase, limit);
  if (error) return NextResponse.json({ error }, { status: 500 });

  // Changes every time the user logs — never cache.
  return NextResponse.json({ entries }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let slug: unknown;
  try {
    ({ slug } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof slug !== "string" || !slug.trim()) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const { error } = await supabase.rpc("bump_food_selection", { p_food_slug: slug.trim() });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
