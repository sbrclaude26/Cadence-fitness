import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createServiceClient();

  const { data: profile, error: fetchError } = await service
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (fetchError) {
    console.error("token fetch error:", fetchError);
    return NextResponse.json({ error: fetchError.message, userId: user.id }, { status: 500 });
  }

  if (!profile) {
    return NextResponse.json({ error: "No profile found", userId: user.id }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let token = (profile as any).vitals_ingest_token ?? null;

  if (!token) {
    const newToken = crypto.randomUUID();
    const { data: updated, error: updateError } = await service
      .from("profiles")
      .update({ vitals_ingest_token: newToken })
      .eq("user_id", user.id)
      .select("vitals_ingest_token")
      .maybeSingle();
    if (updateError) console.error("token update error:", updateError.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    token = (updated as any)?.vitals_ingest_token ?? newToken;
  }

  return NextResponse.json({ token });
}
