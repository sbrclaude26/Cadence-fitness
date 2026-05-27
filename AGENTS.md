<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This repo runs **Next.js 16** with breaking changes from earlier versions. APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

Key gotcha: middleware is renamed. The file is `proxy.ts` at the repo root and exports a `proxy` function (not `middleware`). See [proxy.ts](proxy.ts).
<!-- END:nextjs-agent-rules -->

# Cadence — agent quickstart

Cadence is a mobile-first PWA fitness coach. Users log meals + workouts; Claude generates a new meal/workout plan every 4 days. See [README.md](README.md) for the full picture — this file is the short version of what's likely to bite you.

## Stack at a glance

- Next.js 16 (App Router, Turbopack) · React 19 · TypeScript
- Supabase (Postgres + Auth + RLS) — browser client in [lib/supabase/client.ts](lib/supabase/client.ts), server in [lib/supabase/server.ts](lib/supabase/server.ts)
- Anthropic Claude (`claude-sonnet-4-6`) — model id in [lib/config.ts](lib/config.ts)
- Recharts for trend charts
- PWA: [public/manifest.webmanifest](public/manifest.webmanifest) + [public/sw.js](public/sw.js)

## Where things live

- **Tabs in the bottom bar**: Today, Plan, Log, Trends, Goals (defined in [components/AppShell.tsx](components/AppShell.tsx)). `app/(app)/prep/page.tsx` is a deep route reached from "Prep a batch" — not in the tabbar.
- **Auth**: `app/login/page.tsx` (email+password + OTP), `app/auth/{callback,signout}/route.ts`
- **API routes**: `app/api/{plan,macros,me/token,ingest/{vitals,workouts}}/route.ts`
- **Migrations**: `supabase/migrations/0NN_*.sql` (ordered, run in sequence; currently 014). Not auto-applied to prod — see Deploy section.
- **Shared types**: [lib/types.ts](lib/types.ts) — keep in sync with migrations
- **Tunables**: [lib/config.ts](lib/config.ts) — cycle length, AI knobs, nutrition ratios

## Hard-won conventions

1. **Dates are local, not UTC.** Use `localDateStr()` from [lib/date.ts](lib/date.ts) anywhere you need "today's date" as `YYYY-MM-DD`. Never `new Date().toISOString().slice(0, 10)` — that's UTC and silently rolls past midnight in negative-offset zones, which makes the Today tab show an empty new day in the evening. This was a real prod bug; the helper is the fix.

2. **Bump the service worker cache on UI changes.** [public/sw.js](public/sw.js) has `const CACHE = "cadence-vN"`. Increment N whenever you ship a change that should invalidate the installed PWA's shell.

3. **No magic links.** Auth is email/password + 6-digit OTP for sign-up confirmation and password reset. Magic links were removed because tapping the email link on iOS opens Safari (separate cookie jar from the installed PWA) and orphaned home-screen icons. Don't reintroduce `signInWithOtp`-as-magic-link.

4. **One canonical meal logger.** [components/meals/FlexMealLogger.tsx](components/meals/FlexMealLogger.tsx) is used on both Today and Log. The Log page passes `?date=` via `useSearchParams` so deep-links from the Trends day-detail modal land on the right day. Don't fork it.

5. **AI cycle summary is dual-section JSON in a TEXT column.** Stored as `JSON.stringify({ meals, workouts })` in `plans.what_changed`. Use [lib/planSummary.ts](lib/planSummary.ts) to read it — it falls back to treating legacy plain-string rows as the meals section.

6. **Proxy refreshes the session on every request.** [proxy.ts](proxy.ts) calls `supabase.auth.getUser()` to keep the access token warm so the PWA stays signed in for months. The matcher excludes `_next/static`, `_next/image`, `favicon.ico`, `sw.js`, `manifest.webmanifest`, and `icons/`. Ingest endpoints (`/api/ingest/*`) skip the session refresh because they're token-authed.

7. **Ingest endpoints use a per-user token, not a session.** Token lives in `profiles.vitals_ingest_token` (legacy column name — the same token is used by the workouts ingest too). Vitals route reads `X-Vitals-Token`; workouts route accepts either `X-Cadence-Ingest-Token` (new) or `X-Vitals-Token` (legacy). The `/api/me/token` route rotates the token.

8. **Recipes vs batches are different concepts.** `meal_recipes` = reusable templates (e.g. saved "my usual breakfast"). `meal_prep_batches` = a once-cooked instance with remaining-percent tracking. Both have their own section in `FlexMealLogger`. Don't merge them.

9. **Don't hardcode model ids in routes.** Use `AI_MODEL` (plan + insight-like reasoning) or `AI_FAST_MODEL` (cheap one-shot lookups like the macros endpoint) from [lib/config.ts](lib/config.ts). Hardcoded ids silently break when retired.

10. **MacroBar color math.** Standard direction (calories/carbs/fat): green at 0% → yellow at 100% → red past ~120% (over is bad). Reverse direction (protein only): red at 0% → green at 100% and stays green (more is fine). HSL interpolation lives in [components/ui/MacroBar.tsx](components/ui/MacroBar.tsx) and the chart in [app/(app)/trends/page.tsx](app/%28app%29/trends/page.tsx) — keep them consistent.

11. **RLS everywhere.** Every table has policies scoped to `auth.uid()`. New tables need them too — copy the pattern from existing migrations.

## Build & verify

```bash
npm install
npm run dev          # local at http://localhost:3000
npx tsc --noEmit     # typecheck
npx next build       # full build (catches use-client / dynamic issues)
```

There is no test suite. Verification is: typecheck clean, build clean, manual smoke in a browser. For UI changes, run dev and exercise the feature.

## Deploy

Vercel auto-deploys on push to `main`. **But the database isn't part of that pipeline** — if your change touched migrations, you have to apply them to prod Supabase by hand *before or alongside* the push, or the deployed code will hit missing columns and either 500 or silently no-op. The migration-applied-locally-but-not-in-prod gap has burned us multiple times; the symptom is "save button does nothing" with no visible error. The Supabase project URL is in `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`).

Run through this checklist every deploy, in order:

1. **Typecheck + build clean.** `npx tsc --noEmit && npx next build`. If either fails, fix before pushing — Vercel will fail the same way.
2. **Bump the SW cache.** Increment `CACHE = "cadence-vN"` in [public/sw.js](public/sw.js) for any user-visible change. Installed PWAs keep serving the old shell until N changes.
3. **Verify the changed feature in dev.** `npm run dev`, exercise the actual flow in a browser — typecheck doesn't catch feature regressions.
4. **Apply new migrations to prod Supabase.** If you added a `supabase/migrations/0NN_*.sql` file, open the Supabase SQL editor for this project (URL: `${NEXT_PUBLIC_SUPABASE_URL}/project/_/sql/new`, or via the dashboard → SQL Editor → New query), paste the migration contents, and Run. Migrations use `if not exists` / idempotent guards so re-running is safe. Don't push before this is done.
5. **Commit + push to `main`.** Vercel picks it up automatically and deploys in ~1 min.
6. **Smoke the deployed change.** Open the live app, hard-refresh (or remove + re-add the home-screen PWA) so the new SW takes over, then exercise the changed flow end-to-end. For DB-touching changes specifically: confirm the row actually lands in the table — silent insert failures are the failure mode that won't show up any other way.

**Env vars** (`ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) live in the Vercel project settings — not in the repo.

**On silent save failures**, the first thing to check is whether the corresponding migration is applied to prod. Surface DB errors to the user via `alert()` on insert paths in client components; don't `await` an insert without inspecting `error`.

## Things you'll be tempted to do — don't

- Don't add a `middleware.ts` — Next 16 won't pick it up. Edit [proxy.ts](proxy.ts).
- Don't add UTC date conversions. Always go through `localDateStr()`.
- Don't create a second meal-logger component. Extend `FlexMealLogger`.
- Don't bring back magic-link auth.
- Don't skip the SW cache bump after a user-visible change.
