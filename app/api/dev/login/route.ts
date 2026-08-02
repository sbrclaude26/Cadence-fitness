import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Dev-only session bootstrap so local verification can sign in without a
// password: mints a one-time magic-link token via the admin API and verifies
// it server-side, which sets the normal auth cookies. Hard 404 in production.
const DEV_ACCOUNT_EMAIL = "sbrclaude26@gmail.com";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not found", { status: 404 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return new NextResponse("Missing Supabase env", { status: 500 });
  }

  const linkRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "magiclink", email: DEV_ACCOUNT_EMAIL }),
  });
  const link = await linkRes.json();
  if (!linkRes.ok || !link.hashed_token) {
    return new NextResponse(`generate_link failed: ${JSON.stringify(link).slice(0, 200)}`, { status: 500 });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: link.hashed_token, type: "magiclink" });
  if (error) {
    return new NextResponse(`verifyOtp failed: ${error.message}`, { status: 500 });
  }

  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/today`);
}
