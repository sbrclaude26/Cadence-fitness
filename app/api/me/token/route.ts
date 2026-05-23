import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();

  const { data: profile, error: fetchError } = await service
    .from("profiles")
    .select("vitals_ingest_token")
    .eq("user_id", user.id)
    .single();

  if (fetchError) {
    console.error("token fetch error:", fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  let token = profile?.vitals_ingest_token ?? null;

  if (!token) {
    const newToken = crypto.randomUUID();
    const { data: updated, error: updateError } = await service
      .from("profiles")
      .update({ vitals_ingest_token: newToken })
      .eq("user_id", user.id)
      .select("vitals_ingest_token")
      .single();
    if (updateError) console.error("token update error:", updateError);
    token = updated?.vitals_ingest_token ?? null;
  }

  return NextResponse.json({ token });
}
