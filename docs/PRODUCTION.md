# Production Readiness — Kriya Clinic Portal

A practical checklist to take this from dev → production. Ordered by what unblocks the most.
**Legend:** 🧑‍💻 = code (Claude can do) · 🔑 = needs an account/key (you) · 🏢 = business/compliance decision.

> Status snapshot: app builds + 337 tests pass on `main`. The only *code* stubs are the messaging
> dispatcher and the Mux client (see §4). Everything else is real code that needs **config/keys**, not
> rewriting.

---

## 1 · CI (this PR) 🧑‍💻 ✅
`.github/workflows/ci.yml` runs **typecheck · lint · test · build** on every PR + push to `main`.
DB-gated tests auto-skip (they need a live DB); an optional `db-tests` job can be enabled with a
`DATABASE_URL` repo secret.

**After merging this PR — protect `main`** (GitHub → Settings → Branches → Add rule for `main`):
- ☑ Require a pull request before merging
- ☑ Require status checks to pass → select **`verify (typecheck · lint · test · build)`**
- ☑ Require branches to be up to date before merging

## 2 · Environment variables 🔑
Create a real `.env.local` (never commit it; it's gitignored). All keys live in `.env.example`:

| Var | Purpose | Prod source |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Supabase | the **prod** Supabase project (§3) |
| `DATABASE_URL` | Drizzle/Postgres | prod Supabase **session pooler** (5432), password URL-encoded, `?sslmode=require` |
| `ACCESS_/REFRESH_/INVITE_TOKEN_SECRET` | JWT signing | **rotate** — generate fresh 32+ char secrets (`openssl rand -hex 32`). The dev ones in `.env.example` are placeholders. |
| `*_TOKEN_TTL_SECONDS` | token lifetimes | keep defaults or tune |
| `GROQ_API_KEY` | prescription LLM | console.groq.com |
| `TELEGRAM_BOT_TOKEN` | nudges + appointment reminders + prescription send | @BotFather → /newbot (see §4) |
| `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` | member "Connect Telegram" link | the bot @username, no @ |
| `TELEGRAM_WEBHOOK_SECRET` | verify Telegram webhook calls | generate: `openssl rand -hex 32` |
| `N8N_WEBHOOK_SECRET` | inactivity/reminder cron auth | see §4 |

## 3 · Production database 🔑
1. Create a **separate** Supabase project for prod (don't reuse the dev `kriya-portal-amir`).
2. `DATABASE_URL=<prod session pooler>` then `npm run db:migrate` (drizzle-kit push → all tables).
3. Apply `src/server/db/rls.sql` (defense-in-depth — see §6).
4. **Do NOT run `npm run seed` in prod** (it inserts the dev test clinic/users). Provision the first real
   clinic via the Ops console (`/ops/clinics/new`) instead.
5. Enable **automated backups** (Supabase dashboard) + a restore test.

## 4 · Fill the stubs (features that currently no-op) 🔑🧑‍💻
Each is isolated and safe while unset (returns a stub, never throws). To go live, fill the keys:
- **Messaging (Telegram)** — `src/modules/nudges/dispatch.ts` is fully implemented. Affects 2c Nudges,
  2d appointment reminders, and prescription send (Option A — Telegram path). Steps:
  1. Set `TELEGRAM_BOT_TOKEN` + `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` (create bot via @BotFather → /newbot).
  2. After deploy: `node scripts/set-telegram-webhook.mjs https://<prod-url>` (registers the webhook once).
  3. Members self-connect via the "Connect Telegram" button on their Nudges tab.
- **Care video (Supabase Storage)** — `src/server/lib/supabase-storage.ts` is fully implemented (no Mux).
  One-time: `node scripts/create-storage-bucket.mjs` (needs `SUPABASE_SERVICE_ROLE_KEY`; creates the
  private `care-videos` bucket). No extra keys; uses the existing Supabase vars.
- **Automation (N8N / Vercel Cron)** — nothing schedules `POST /api/v1/nudges/auto-scan` and
  `POST /api/v1/appointments/reminders-scan` yet. Wire an **N8N workflow or a Vercel Cron** to call them
  (T-24h/T-2h reminders + 48h inactivity). Gate with `N8N_WEBHOOK_SECRET`.
- **Groq** — already real; just set `GROQ_API_KEY`.

## 5 · Deploy (Vercel) 🔑🧑‍💻
1. Import the GitHub repo into Vercel; framework auto-detects Next.js.
2. Add **all §2 env vars** under Project → Settings → Environment Variables (Production + Preview, with a
   separate dev DB for Preview ideally).
3. MediaPipe model/wasm load from **CDN** at runtime (`public/mediapipe` is empty placeholders) → the scan
   page needs internet. For reliability/offline, self-host the assets and point the pose engine at them.
4. Set the production domain; verify `/clinic/login` + `/ops/login` + a scan over HTTPS (camera needs a
   secure context).

## 6 · Security & compliance (this is health data — required before real patients) 🏢🧑‍💻
- **RLS**: app currently trusts the service-role connection + in-app role/tenant checks. For PHI, also
  enforce Postgres **Row-Level Security** (apply `rls.sql`, verify cross-tenant denial at the DB layer).
- **Rate limiting**: auth routes (`/api/v1/auth/*`) and the **Telegram webhook** (`/api/v1/webhooks/telegram`)
  should be rate-limited; the Telegram webhook validates `TELEGRAM_WEBHOOK_SECRET` when set.
- **Secrets**: rotate all token secrets (§2); never commit `.env.local`; rotate the **GitHub PAT used for
  the merge**.
- **Monitoring**: add error tracking (Sentry) + structured logs + uptime checks.
- **Compliance** 🏢: consent capture (built), data-retention policy, privacy policy, and (region-dependent)
  HIPAA/GDPR/India-DPDP review. Get a real security review before go-live.

## 7 · Remaining QA 🧑‍💻🔑
- **Camera scan**: real-webcam end-to-end test (pending) — login → consented member → Run Scan → Deep →
  allow camera → scores post → Results.
- End-to-end role walkthrough (ops / clinic_admin / clinician) on the deployed URL.
- Load/perf: confirm DB indexes + Supabase pooler sizing under concurrent use.

---

### Suggested order
**1 CI (done) → protect main → 3 prod DB + 2 secrets → 5 deploy → 4 fill stubs (as accounts arrive) →
6 security review → 7 QA → go live.**
