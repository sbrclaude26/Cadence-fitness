import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchFoodLibrary } from "@/lib/foodLibrary";

// GET /api/foods/search?q=chicken&limit=20
// Thin wrapper over `searchFoodLibrary` in lib/foodLibrary.ts — the same
// scorer is shared with the cycle-planner route's ingredient resolver, so
// the user's picker and Claude's library matcher rank rows identically.
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limitParam = parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit = isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 20;

  const { entries, error } = await searchFoodLibrary(supabase, q, limit);
  if (error) return NextResponse.json({ error }, { status: 500 });

  return NextResponse.json(
    { entries },
    {
      headers: {
        // Library content changes only on reseed; cache for an hour on the
        // browser so repeat queries are instant.
        "Cache-Control": "private, max-age=3600",
      },
    },
  );
}
