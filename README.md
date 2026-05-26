# Cadence — Adaptive Fitness Coach

A mobile-first, installable PWA that plans your meals and workouts in 4-day cycles and uses the Anthropic API to interpret your logged data and continuously adjust the plan.

Production: https://cadence-fitness.vercel.app (deployed from `main` on push)

---

## Stack

- **Next.js 16** with the App Router (Turbopack). Note: this version renames `middleware` → `proxy` (see [proxy.ts](proxy.ts)).
- **React 19**
- **Supabase** — Postgres + Auth (email/password + 6-digit OTP) + Row-Level Security
- **Anthropic Claude** (`claude-sonnet-4-6`) for plan generation and Q&A
- **Recharts** for trend visualizations
- **PWA**: manifest + service worker shell cache, installable on iOS/Android home screen

---

## Setup

### 1. Prerequisites

- Node.js LTS (≥ 20)
- Vercel account (deploys from GitHub `main`)
- Supabase project (free tier is fine)
- Anthropic API key (console.anthropic.com)

### 2. Environment variables

Copy `.env.example` to `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

Find Supabase values at **Project Settings → API**.

### 3. Apply Supabase migrations

Run each file in `supabase/migrations/` against your project in order via the SQL Editor, or use the Supabase CLI:

```bash
supabase db push
```

The migrations create:

- `001_initial.sql` — profiles, plans, meal_logs, weight_logs, workout_logs, vitals
- `002_meal_recipes.sql` — user-saved recipes
- `003_workout_sessions.sql` — per-exercise per-set strength tracking
- `004_workout_sessions_dedup.sql` — uniqueness guarantees on sessions
- `005_meal_prep_batches.sql` — batch cooking tracker
- `006_meal_logs_batch_link.sql` — link meal_logs to source batch
- `007_log_from_batch_rpc.sql` — atomic "log a portion of batch X" RPC
- `008_plans_suggestions.sql` — recipe suggestions tied to plans
- `009_workout_sessions_dedup_v2.sql` — fixes a dedup mismatch (the prior index keyed on rounded duration; the upsert passed raw duration, so duplicates leaked through)

All tables enable RLS scoped to `auth.uid()`.

### 4. Supabase Auth dashboard config (manual)

- **Auth → Providers → Email**: keep "Confirm email" on
- **Auth → Email Templates**:
  - **Confirm signup**: replace `{{ .ConfirmationURL }}` with `{{ .Token }}` so users get a 6-digit code, not a magic link
  - **Reset password**: same swap
- **Auth → Sessions**: inactivity timeout → 60 days so the PWA stays signed in

The magic-link flow was removed because tapping the email link on iOS opens Safari (separate cookie jar from the installed PWA), which orphaned home-screen icons. Sign-up and password reset now complete entirely inside the PWA via OTP code.

### 5. Run locally

```bash
npm install
npm run dev   # http://localhost:3000
```

Test on your phone over LAN: find your Mac's IP in System Settings → Wi-Fi → Details, then open `http://192.168.x.x:3000` in mobile Safari.

### 6. Deploy

Push to `main`. Vercel auto-deploys. Set the four env vars in the Vercel project.

### 7. Install as PWA on iPhone

1. Open the deployed URL in mobile Safari
2. Share → Add to Home Screen → Add

The app runs standalone (no browser chrome). Sign in with email/password (sign-up and password reset use a 6-digit OTP — see step 4); the session then persists up to the Supabase inactivity timeout (60 days by default) thanks to refresh tokens kept warm by [proxy.ts](proxy.ts).

### 8. Apple Health vitals via Shortcut

**Option A — Health Auto Export app** (easiest): REST automation pointing at your Cadence vitals URL.

**Option B — Apple Shortcut** with an HTTP Request action:

- URL: `https://your-app.vercel.app/api/ingest/vitals`
- Method: POST
- Header: `X-Vitals-Token: YOUR_TOKEN` (find in `profiles.vitals_ingest_token`). The workouts endpoint also accepts `X-Cadence-Ingest-Token` for the same token; either works.
- Body:

```json
{
  "date": "2024-01-15",
  "restingHR": 58,
  "avgHR": 72,
  "activeEnergyKcal": 520,
  "steps": 8200
}
```

Same shape for workouts at `/api/ingest/workouts` (see route handler for fields).

---

## Project structure

```
proxy.ts             — Next.js 16 middleware (renamed from middleware.ts); refreshes Supabase session, gates routes
app/
  layout.tsx         — root layout; mounts AuthStateSync + ServiceWorkerRegistrar
  page.tsx           — / → redirects to /today
  globals.css        — design tokens (--ink, --muted, --accent, --card, --font-body, --font-display)
  login/             — email/password + 6-digit OTP sign-in/sign-up/reset flow
  auth/
    callback/        — Supabase OAuth callback (kept for future provider hookups)
    signout/         — POST → supabase.auth.signOut() → /login
  (app)/             — authenticated routes, share AppShell with bottom tabbar
    layout.tsx
    today/           — daily dashboard: intake bars, meal logger, workout checklist
    plan/            — cycle plan view (meals / workouts tabs, AI summary)
    log/             — same FlexMealLogger but date-pickable (?date= deep link)
    trends/          — weight, vitals, workout volume, and macro-history bar chart
    goals/           — profile + targets editor
    prep/            — meal-prep batch builder
  api/
    plan/            — POST: AI plan generation (Anthropic + Zod schema)
    macros/          — POST: lookup macros for a free-text food via Claude (uses AI_FAST_MODEL)
    me/token/        — GET/POST: rotate user's vitals/workouts ingest token
    ingest/
      vitals/        — POST: Apple Health webhook (token auth)
      workouts/      — POST: Apple Health workout webhook (token auth)
components/
  AppShell.tsx       — header + bottom tabbar (Today, Plan, Log, Trends, Goals)
  AuthStateSync.tsx  — listens to onAuthStateChange, calls router.refresh()
  ServiceWorkerRegistrar.tsx
  BarcodeScanner.tsx
  ui/                — Card, Label, MacroLine, MacroBar, MiniInput, Stat, Empty, Field, RichText, styles
  meals/
    FlexMealLogger   — the canonical meal-logging UI (used on Today + Log)
    InlineFoodLogger — "Ate something else": barcode scan (BarcodeScanner) or free-text + AI macros lookup
    MealBuilder      — multi-ingredient builder used during meal prep
    PlanBody         — renders plan meals/workouts + AI cycle summary
    RecipeSuggestionsView, RecipesView, GroceryList
  workout/
    WorkoutChecklist — per-set tracker that writes to workout_sessions
lib/
  config.ts          — CYCLE_DAYS, AI model + temperature, nutrition ratios, overload knobs
  types.ts           — shared TypeScript types matching the DB
  date.ts            — localDateStr(): YYYY-MM-DD in the user's timezone (NOT UTC)
  planSummary.ts     — parse the dual-section AI cycle summary (meals/workouts)
  prepHandoff.ts     — passes a draft batch between /today and /prep
  units.ts
  supabase/
    client.ts        — browser client (PKCE, persistSession, autoRefreshToken)
    server.ts        — server client used by route handlers
  ai/
    coachPrompt.ts   — system prompt + context builder for plan generation
supabase/migrations/  — ordered SQL migrations (001 … 009)
public/
  manifest.webmanifest
  sw.js              — service worker; bump CACHE on shipping a UI change
  icons/
```

---

## Conventions (read before editing)

- **Next.js 16**: this is not the Next you know from training data. The file is `proxy.ts`, not `middleware.ts`. Read the relevant guide under `node_modules/next/dist/docs/` when in doubt.
- **Dates**: always use `localDateStr()` from [lib/date.ts](lib/date.ts) for "today's date". Never `new Date().toISOString().slice(0, 10)` — that's UTC and rolls past midnight for negative-offset users (this caused a real production bug; the fix is the helper).
- **Service worker cache**: bump the `CACHE` constant in [public/sw.js](public/sw.js) when shipping a UI change that should invalidate the installed PWA's shell. Increment the `cadence-vN` version number.
- **Auth**: email + password is the primary path; 6-digit OTP for signup confirmation and password reset. Magic links are intentionally removed (broke iOS PWAs). The Supabase browser client uses `flowType: 'pkce'`.
- **Session refresh**: [proxy.ts](proxy.ts) calls `supabase.auth.getUser()` on every request to keep the access token fresh; `AuthStateSync` propagates client-side refresh events.
- **AI plan summary**: stored as `JSON.stringify({ meals, workouts })` in the legacy `what_changed` TEXT column. Parse via `parsePlanSummary` in [lib/planSummary.ts](lib/planSummary.ts) (handles the legacy plain-string case too).
- **Meal logging**: the single canonical component is `FlexMealLogger`. Today and Log both mount it — Log just threads in `?date=` so the modal "Edit" on Trends can deep-link to a specific day.
- **Tunables**: cycle length, AI model ids (`AI_MODEL`, `AI_FAST_MODEL`), temperature, protein ratio, stall thresholds — all in [lib/config.ts](lib/config.ts). Never hardcode model ids in route handlers.
- **Recipes vs batches**: `meal_recipes` holds **reusable templates** (saved from past meals, picked from a list); `meal_prep_batches` holds **once-cooked instances** the user is currently eating down. Both surface in the meal logger as separate sections.

## Iterating

- **AI coaching rules** → [lib/ai/coachPrompt.ts](lib/ai/coachPrompt.ts)
- **New tab** → `app/(app)/<name>/page.tsx` + add entry in [components/AppShell.tsx](components/AppShell.tsx)
- **Schema change** → new `supabase/migrations/00N_*.sql` + update [lib/types.ts](lib/types.ts)
- **New ingest source** → mirror the pattern in [app/api/ingest/vitals/route.ts](app/api/ingest/vitals/route.ts) (token auth via `profiles.vitals_ingest_token`)
