# Prem Predict

A statistical model predicts every top-flight match. You predict too. Every
gameweek you find out who was smarter.

**The full brief is [CLAUDE.md](CLAUDE.md).** Read it before changing anything —
it carries the [HARD] constraints, and several are legal or App Store gates
rather than preferences.

---

## Layout

```
CLAUDE.md              the spec. source of truth.
supabase/migrations/   schema, RLS, and the free/premium view boundary
worker/                Python: ingest, model fit, predictions, settlement
app/                   Expo / React Native client
web/                   privacy policy + terms (required before submission)
.github/workflows/     CI
```

## Setup

### Prerequisites

- Python ≥3.12, Node ≥20
- A Supabase project (free tier)
- A [football-data.org](https://www.football-data.org/client/register) token (free)
- Apple Developer Program membership — required for any device build

### 1. Database

Apply the migrations **in order** from the Supabase SQL editor, or with the CLI:

```bash
supabase link --project-ref YOUR-REF
supabase db push
```

Then, in **Project Settings → API → Exposed schemas**, confirm the list is
`public, graphql_public` only. **`model` must NOT be exposed.** That single
setting is what makes §9.2's premium boundary real — the gated views in
`0003_views.sql` are the only door to `model.predictions`.

### 2. Worker

```bash
cd worker
python -m venv .venv
.venv/Scripts/activate          # Windows;  source .venv/bin/activate elsewhere
pip install -e ".[dev]"
cp .env.example .env            # fill in DATABASE_URL + FOOTBALL_DATA_ORG_TOKEN

python -m premmodel backfill    # historical training set -> data/*.parquet
python -m premmodel ingest      # teams + fixtures -> Postgres
python -m premmodel gameweek --week 1
pytest -q
```

> If your editor flags missing packages, point its Python interpreter at
> `worker/.venv`. The venv is correct; the global interpreter is not.

### 3. App

```bash
cd app
npm install
cp .env.example .env            # Supabase URL + anon key ONLY
npm run typecheck
npm run fixtures                # Phase 0 deliverable
```

Package versions in `package.json` were pinned against Expo SDK 52. Run
`npx expo install --fix` once to align them with whatever SDK is current — do
this **before** your first EAS build, not after.

## Build workflow (no Mac required)

All iOS compilation happens on EAS. You never need macOS.

```bash
npx eas-cli@latest login
npx eas-cli@latest init            # writes extra.eas.projectId into app.json
npx eas-cli@latest build --profile development --platform ios
```

**The EAS free tier is 15 iOS builds/month.** Two rules follow:

1. **JS changes never need a rebuild.** Once a development build contains your
   native modules, all UI work hot-reloads.
2. **Every native dependency is already in `package.json`** — RevenueCat,
   Sign in with Apple, notifications, secure-store, SQLite, SVG, Reanimated.
   That is deliberate. Adding a forgotten one later costs a build *plus* a
   20–60 minute low-priority queue wait.

Expo Go works for pure-UI work only. The moment RevenueCat or Sign in with
Apple lands you need a development build. See CLAUDE.md §3.2.

## Before submitting

```bash
cd app
npx expo export --platform ios
npm run check-bundle-secrets      # §12 checklist item
```

Then work through the §12 checklist in CLAUDE.md in full.

## Security model in one paragraph

The client holds no business logic and no secrets beyond the Supabase anon key,
which is designed to be public. Everything is enforced in Postgres:
`user_predictions` is writable only before `now() < kickoff_utc`, evaluated by
the *database's* clock, so a tampered device clock changes nothing; column-level
grants mean a client physically cannot write `points_awarded`, `entitlement` or
`submitted_at_server`; and `model.predictions` sits outside the PostgREST-exposed
schema so premium fields are *absent* from an unentitled response rather than
hidden in the UI. Read `supabase/migrations/0002_rls.sql` before touching auth.
