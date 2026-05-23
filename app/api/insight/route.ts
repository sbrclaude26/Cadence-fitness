import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { AI_MODEL } from "@/lib/config";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { question } = await request.json();
    if (!question?.trim()) return NextResponse.json({ error: "No question provided" }, { status: 400 });

    const [{ data: profile }, { data: weights }, { data: plan }] = await Promise.all([
      supabase.from("profiles").select("*").eq("user_id", user.id).single(),
      supabase.from("weight_logs").select("*").eq("user_id", user.id).order("date", { ascending: false }).limit(10),
      supabase.from("plans").select("calorie_target,macros,what_changed").eq("user_id", user.id).eq("status", "current").single(),
    ]);

    const context = JSON.stringify({ profile, weightTrend: weights, currentPlan: plan });
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 512,
      system: "You are Cadence, a personal fitness coach. Answer the athlete's question concisely using their data. Be direct and encouraging. 2–4 sentences max.",
      messages: [{ role: "user", content: `Context: ${context}\n\nQuestion: ${question}` }],
    });

    const text = response.content.find((b) => b.type === "text");
    return NextResponse.json({ answer: text?.type === "text" ? text.text : "" });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
