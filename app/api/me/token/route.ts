import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("vitals_ingest_token")
    .eq("user_id", user.id)
    .single();

  let token = profile?.vitals_ingest_token ?? null;

  if (!token) {
    const { data: updated } = await supabase
      .from("profiles")
      .update({ vitals_ingest_token: crypto.randomUUID() })
      .eq("user_id", user.id)
      .select("vitals_ingest_token")
      .single();
    token = updated?.vitals_ingest_token ?? null;
  }

  return NextResponse.json({ token });
}
