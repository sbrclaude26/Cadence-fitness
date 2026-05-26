import { NextResponse } from "next/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { AI_FAST_MODEL } from "@/lib/config";

const MacrosSchema = z.object({
  calories: z.number().finite().nonnegative(),
  protein: z.number().finite().nonnegative(),
  carbs: z.number().finite().nonnegative(),
  fat: z.number().finite().nonnegative(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ingredients, servings } = await request.json();
  if (!ingredients?.length) return NextResponse.json({ error: "No ingredients" }, { status: 400 });

  const list = ingredients.map((ing: { item: string; qty: string }) => `- ${ing.qty} ${ing.item}`).join("\n");
  const srv = parseFloat(servings) || 1;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await anthropic.messages.create({
    model: AI_FAST_MODEL,
    max_tokens: 256,
    temperature: 0,
    messages: [{
      role: "user",
      content: `Estimate the nutritional content per serving of this meal. The ingredients listed are for the whole recipe which makes ${srv} serving${srv !== 1 ? "s" : ""}. Return macros for ONE serving (divide total by ${srv}).\n\nIngredients (whole recipe):\n${list}\n\nReturn ONLY a JSON object with these exact keys, no other text:\n{"calories": <number>, "protein": <number>, "carbs": <number>, "fat": <number>}`,
    }],
  });

  const text = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return NextResponse.json({ error: "Could not parse macros" }, { status: 422 });

  try {
    const parsed = MacrosSchema.safeParse(JSON.parse(match[0]));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid macros shape" }, { status: 422 });
    }
    return NextResponse.json(parsed.data);
  } catch {
    return NextResponse.json({ error: "Invalid response" }, { status: 422 });
  }
}
