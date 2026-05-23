# Cadence — Adaptive Fitness Coach

A mobile-first, installable PWA that plans your meals and workouts in 4-day cycles and uses the Anthropic API to interpret your logged data and continuously adjust the plan.

---

## Setup & Deploy

### 1. Prerequisites

- **Node.js LTS** (≥ 20) — download from nodejs.org
- **Vercel account** — vercel.com (free)
- **Supabase project** — supabase.com (free tier works)
- **Anthropic API key** — console.anthropic.com

---

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Find your Supabase values at: **Project Settings → API**.

---

### 3. Apply the Supabase migration

Open the Supabase dashboard → **SQL Editor** → paste the contents of:

```
supabase/migrations/001_initial.sql
```

Click **Run**. This creates all tables with RLS policies.

Alternatively, with the Supabase CLI:
```bash
supabase db push
```

---

### 4. Run locally

```bash
npm install
npm run dev
```

App runs at **http://localhost:3000**.

**Test on your phone over local network:**
1. Find your Mac's local IP: `System Settings → Wi-Fi → Details`
2. Open `http://192.168.x.x:3000` in Safari on your iPhone
3. Make sure your phone is on the same Wi-Fi network

---

### 5. Deploy to Vercel

```bash
git add -A && git commit -m "initial build"
git push origin main
```

Then:
1. Go to **vercel.com/new**
2. Import your GitHub repository (`Cadence-fitness`)
3. Add all environment variables from `.env.local`
4. Click **Deploy**

Vercel auto-deploys on every push to `main`.

---

### 6. Install as PWA on iPhone

1. Open your Vercel URL in **Safari** on iPhone
2. Tap the **Share** button (box with arrow)
3. Tap **Add to Home Screen**
4. Tap **Add**

Cadence now runs in standalone mode — no browser chrome.

---

### 7. Apple Health vitals via Shortcut

**Option A — Health Auto Export app (easiest)**
1. Install "Health Auto Export" from the App Store
2. Add a REST automation pointing to your Cadence vitals URL
3. Map fields: Resting Heart Rate → `restingHR`, Active Energy → `activeEnergyKcal`, Steps → `steps`

**Option B — Apple Shortcut**

Create a shortcut with an **HTTP Request** action:
- URL: `https://your-app.vercel.app/api/ingest/vitals`
- Method: POST
- Headers: `X-Vitals-Token: YOUR_TOKEN`
  *(find in Supabase → Table Editor → profiles → vitals_ingest_token)*
- Body (JSON):

```json
{
  "date": "2024-01-15",
  "restingHR": 58,
  "avgHR": 72,
  "activeEnergyKcal": 520,
  "steps": 8200
}
```

Set the Shortcut to run **daily at 9pm** via Automation → Personal Automation → Time of Day.

---

## Project structure

```
app/
  (app)/          — authenticated tab pages (today, plan, log, trends, goals)
  api/
    plan/         — POST: AI plan generation
    insight/      — POST: AI Q&A
    ingest/vitals/— POST: Apple Health webhook
  login/          — Magic-link sign-in
  auth/callback/  — OAuth callback
components/
  ui/             — Card, Label, MacroLine, MiniInput, Stat, Empty, Field
  meals/          — TodayMeals, PlanBody, GroceryList
  workout/        — WorkoutChecklist
  BarcodeScanner.tsx
  AppShell.tsx
lib/
  config.ts       — CYCLE_DAYS and all tunable constants
  types.ts        — shared TypeScript types
  supabase/       — browser + server clients
  ai/             — coachPrompt.ts (system prompt + context builder)
supabase/
  migrations/     — SQL schema
public/
  manifest.webmanifest
  sw.js           — service worker (offline shell)
  icons/          — PWA icons (replace SVG placeholders with real PNGs)
```

---

## Iterating

- AI coaching rules → `lib/ai/coachPrompt.ts`
- Cycle length / nutrition constants → `lib/config.ts`
- New tab → `app/(app)/new-tab/page.tsx` + add entry in `components/AppShell.tsx`
- Schema change → Supabase SQL Editor + `lib/types.ts`
