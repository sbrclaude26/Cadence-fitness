import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { AI_MODEL } from "@/lib/config";

// Upload a DEXA report, extract its numbers, keep both.
//
// The PDF goes to private Storage so a scan can be re-parsed later if
// extraction improves; the extracted figures go to dexa_scans, which is what
// the plan builder reads. Reports differ by clinic, so every field is optional
// and anything unreadable is reported back rather than guessed.

export const maxDuration = 120;

const MAX_BYTES = 15 * 1024 * 1024;

const ScanSchema = z.object({
  scan_date: z.string().nullable().describe("Scan date printed on the report, as YYYY-MM-DD. Null if not shown. This is the date of the SCAN, never today's date."),
  body_fat_pct: z.number().nullable().describe("Whole-body fat percentage. Null if not reported."),
  fat_mass_lb: z.number().nullable().describe("Total fat mass in POUNDS. Convert if the report is metric."),
  lean_mass_lb: z.number().nullable().describe("Total lean/soft-tissue mass in POUNDS. Convert if metric. Do not include bone mineral content here if reported separately."),
  total_mass_lb: z.number().nullable().describe("Total body mass in POUNDS."),
  bone_mineral_lb: z.number().nullable().describe("Bone mineral content in POUNDS, if reported."),
  visceral_fat_lb: z.number().nullable().describe("Visceral adipose tissue in POUNDS, if reported. Convert grams to pounds."),
  resting_metabolic_rate: z.number().int().nullable().describe("Estimated RMR in kcal/day, if the report gives one."),
  regional: z.record(z.string(), z.object({
    lean_lb: z.number().nullable(),
    fat_lb: z.number().nullable(),
    fat_pct: z.number().nullable(),
  })).describe("Per-region breakdown keyed by the report's own region names, lower-cased (e.g. 'arms', 'legs', 'trunk', 'android', 'gynoid'). Empty object if the report has no regional table."),
  extraction_notes: z.string().nullable().describe("Anything you could not read, or that looked ambiguous. Null when the whole report parsed cleanly. Be specific — the athlete sees this."),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  if (file.type !== "application/pdf") return NextResponse.json({ error: "Upload the DEXA report as a PDF." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That PDF is larger than 15 MB." }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const base64 = bytes.toString("base64");

  // ── Extract ───────────────────────────────────────────────────────────────
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const raw = z.toJSONSchema(ScanSchema) as { properties?: unknown; required?: string[] };

  let parsed: z.infer<typeof ScanSchema>;
  try {
    const response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 2000,
      tools: [{
        name: "dexa_scan",
        description: "Report the body-composition figures printed on this DEXA scan.",
        input_schema: { type: "object" as const, properties: raw.properties as Record<string, unknown>, required: raw.required ?? [] },
      }],
      tool_choice: { type: "tool", name: "dexa_scan" },
      messages: [{
        role: "user",
        content: [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
          {
            type: "text",
            text: "Extract the body-composition figures from this DEXA report. Report ONLY what is printed — never estimate, infer, or fill a gap from typical values; a null is correct and useful, a guess is not. Convert metric values to pounds. If the document is not a DEXA/body-composition report, set every field null and say so in extraction_notes.",
          },
        ],
      }],
    });

    const toolUse = response.content.find((b) => b.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") {
      return NextResponse.json({ error: "Couldn't read that report. Try a different export of the PDF." }, { status: 422 });
    }
    const result = ScanSchema.safeParse(toolUse.input);
    if (!result.success) {
      console.error("dexa: schema validation failed", result.error.message.slice(0, 400));
      return NextResponse.json({ error: "Couldn't read that report reliably." }, { status: 422 });
    }
    parsed = result.data;
  } catch (e) {
    console.error("dexa: extraction failed", e);
    return NextResponse.json({ error: "Couldn't read that PDF." }, { status: 500 });
  }

  // The athlete's chosen date wins over the one printed on the report — they
  // can see both, and a wrong date corrupts every trend drawn through it.
  const requestedDate = String(form?.get("scanDate") ?? "").trim();
  const scanDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) ? requestedDate : parsed.scan_date;
  if (!scanDate || !/^\d{4}-\d{2}-\d{2}$/.test(scanDate)) {
    return NextResponse.json({
      error: "Couldn't find a scan date in that report — pick the date and upload again.",
      parsed,
    }, { status: 422 });
  }

  // ── Store the file, then the numbers ─────────────────────────────────────
  // Path is namespaced by user id: the storage policies authorise on it.
  const filePath = `${user.id}/${scanDate}-${Date.now()}.pdf`;
  const { error: uploadError } = await supabase.storage
    .from("dexa")
    .upload(filePath, bytes, { contentType: "application/pdf", upsert: true });
  if (uploadError) {
    console.error("dexa: upload failed", uploadError.message);
    return NextResponse.json({ error: `Couldn't save the file: ${uploadError.message}` }, { status: 500 });
  }

  const { data: saved, error: dbError } = await supabase
    .from("dexa_scans")
    .upsert({
      user_id: user.id,
      scan_date: scanDate,
      file_path: filePath,
      file_name: file.name,
      body_fat_pct: parsed.body_fat_pct,
      fat_mass_lb: parsed.fat_mass_lb,
      lean_mass_lb: parsed.lean_mass_lb,
      total_mass_lb: parsed.total_mass_lb,
      bone_mineral_lb: parsed.bone_mineral_lb,
      visceral_fat_lb: parsed.visceral_fat_lb,
      resting_metabolic_rate: parsed.resting_metabolic_rate,
      regional: parsed.regional ?? {},
      extraction_notes: parsed.extraction_notes,
    }, { onConflict: "user_id,scan_date" })
    .select()
    .single();

  if (dbError) {
    console.error("dexa: save failed", dbError.message);
    return NextResponse.json({ error: `Couldn't save the scan: ${dbError.message}` }, { status: 500 });
  }

  return NextResponse.json({ scan: saved, reportDate: parsed.scan_date });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data: scan } = await supabase
    .from("dexa_scans")
    .select("file_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!scan) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (scan.file_path) await supabase.storage.from("dexa").remove([scan.file_path]);
  const { error } = await supabase.from("dexa_scans").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
