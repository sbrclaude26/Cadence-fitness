// Local escape hatch: builds the next cycle exactly like POST /api/plan, but
// from this machine with the service-role key — no serverless time limit. Use
// when a build repeatedly 504s in the app.
// Usage: npx tsx scripts/build-plan.ts [path-to-notes.txt]
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { generateAndSavePlan } from "../lib/ai/generatePlan";
import { localDateStr } from "../lib/date";

// Minimal .env.local parser (values may be quoted).
const envPath = resolve(__dirname, "../.env.local");
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  const [, key, raw] = m;
  const val = raw.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
  if (!(key in process.env)) process.env[key] = val;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey || !process.env.ANTHROPIC_API_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ANTHROPIC_API_KEY");
  process.exit(1);
}

async function main() {
  // Node 20 has no global WebSocket; supabase-js insists on one for its
  // realtime client even though this script never subscribes. Stub it.
  if (typeof globalThis.WebSocket === "undefined") {
    (globalThis as Record<string, unknown>).WebSocket = class { close() {} } as unknown;
  }
  const supabase = createClient(url!, serviceKey!, { auth: { persistSession: false } });

  // The real account — the DB also holds a QA account and an empty signup.
  const ACCOUNT_EMAIL = "sbrclaude26@gmail.com";
  const { data: usersPage, error } = await supabase.auth.admin.listUsers({ perPage: 100 });
  if (error) throw error;
  const account = usersPage.users.find((u) => u.email === ACCOUNT_EMAIL);
  if (!account) throw new Error(`No auth user with email ${ACCOUNT_EMAIL}`);
  const userId = account.id;

  const notesPath = process.argv[2] ?? resolve(__dirname, "user-notes.txt");
  const userNotes = existsSync(notesPath) ? readFileSync(notesPath, "utf8").trim() || null : null;
  const startDate = localDateStr();
  console.log("build-plan: starting", { userId, startDate, notes_chars: userNotes?.length ?? 0 });

  const t0 = Date.now();
  const result = await generateAndSavePlan({
    supabase,
    userId,
    mode: "current",
    userNotes,
    noAdjustments: false,
    startDate,
    // No deadline: local run, let a validation retry happen if needed.
  });
  const totalS = ((Date.now() - t0) / 1000).toFixed(1);

  if (!result.ok) {
    console.error(`build-plan: FAILED after ${totalS}s —`, result.status, result.error);
    process.exit(1);
  }
  // This script never requests contextOnly, so narrow to the saved-plan shape.
  if (!("plan" in result)) {
    console.error("build-plan: unexpected context-only result");
    process.exit(1);
  }
  const plan = result.plan as { id: string; cycle_number: number; cycle_start_date: string; calorie_target: number };
  console.log(`build-plan: SUCCESS in ${totalS}s`, {
    deduped: result.deduped,
    id: plan.id,
    cycle_number: plan.cycle_number,
    cycle_start_date: plan.cycle_start_date,
    calorie_target: plan.calorie_target,
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
