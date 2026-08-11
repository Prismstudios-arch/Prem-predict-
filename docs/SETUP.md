# Setup checklist

Tick these off in order. Steps 1–3 involve waiting on other people, so start
them first even though you are weeks from submitting.

Anything marked **[YOU]** only you can do — it needs an account or a login.

---

## Group A — start today, because they involve waiting

### A1. [YOU] Apple: sign the Paid Apps agreement (~10 min, then days of waiting)

This is the **longest lead time in the entire project**. Subscriptions cannot
be sold until it clears, and nothing about it can be rushed later.

1. Go to <https://appstoreconnect.apple.com> → **Business**
2. Sign the **Paid Applications** agreement
3. Fill in **Bank account** and **Tax forms** (US tax form required even for UK sellers)
4. Status must read **Active**, not "Pending"

Do this even before deciding the app name. It blocks everything and nothing
else depends on it.

### A2. [YOU] Decide the bundle ID (~5 min, permanent)

The **app name can change later. The bundle ID cannot** — once an App Store
Connect record exists it is permanent.

Pick something neutral so a rename costs nothing:

```
com.<yourdomain>.gaffer
```

Then set it in `app/app.json` → `expo.ios.bundleIdentifier`
(currently the placeholder `com.prempredict.app`).

### A3. [YOU] Read football-data.org's terms (~15 min)

<https://www.football-data.org/terms>

You are shipping a paid subscription app, so you need to know whether their
free tier permits commercial use.

- **Permitted** → data costs £0
- **Not permitted** → swap to API-Football (~$19/mo). One file changes:
  `worker/src/premmodel/providers/__init__.py`

---

## Group B — ~30 minutes, unblocks everything else

### B1. [YOU] Create the Supabase project (~5 min)

1. <https://supabase.com> → **New project** (free tier)
2. Region: **London (eu-west-2)**
3. Save the database password somewhere — it is shown once

### B2. Apply the database migrations (~5 min)

Supabase dashboard → **SQL Editor** → paste and **Run** each file **in order**:

```
supabase/migrations/0001_init.sql
supabase/migrations/0002_rls.sql
supabase/migrations/0003_views.sql
supabase/migrations/0004_settlement.sql
supabase/migrations/0005_multi_season.sql
```

Each should report success. If one errors, stop — later files depend on it.

### B3. ⚠️ Lock down the exposed schemas (~1 min — do not skip)

**Project Settings → API → Exposed schemas**

The list must contain **only**:

```
public, graphql_public
```

**`model` must NOT be listed.**

This one setting is what makes the premium paywall real. `model.predictions`
holds the full probability data; if that schema is exposed, any user can read
all premium content directly and the subscription is worthless.

### B4. Register the new season (~1 min)

SQL Editor:

```sql
select public.begin_season('2026-27');
```

### B5. [YOU] Get a football-data.org token (~5 min)

<https://www.football-data.org/client/register> — free, instant, emailed to you.

### B6. Create `worker/.env` (~2 min)

Copy `worker/.env.example` to `worker/.env` and fill in two values:

- `DATABASE_URL` — Supabase → **Project Settings → Database → Connection string → URI**.
  Use the **Session pooler** string, not the direct connection. Replace
  `[YOUR-PASSWORD]` with the password from B1.
- `FOOTBALL_DATA_ORG_TOKEN` — from B5.

### B7. Load the data (~5 min)

```powershell
cd worker
.venv\Scripts\python.exe -m premmodel ingest
.venv\Scripts\python.exe -m premmodel predict
.venv\Scripts\python.exe -m premmodel gameweek --week 1
```

Expected: a printed fixture list. **That is Phase 0's deliverable and the first
proof the whole chain works.**

If ingest warns about `PROVISIONAL colours`, that is expected for promoted
clubs — see `docs/SEASON_ROLLOVER.md`. It is cosmetic and not blocking.

### B8. Create `app/.env` (~2 min)

Copy `app/.env.example` to `app/.env`. Both values come from Supabase →
**Project Settings → API**:

- `EXPO_PUBLIC_SUPABASE_URL` — Project URL
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` — the **anon / public** key

⚠️ Use the **anon** key, never the **service_role** key. The anon key is
designed to be public; the service_role key bypasses all security and would be
readable by anyone who downloads the app.

### B9. Confirm the app talks to your backend (~2 min)

```powershell
cd app
npm run fixtures
```

Expected: the same fixture list, **plus** `premium gate: 0 rows to unentitled
caller [OK]`. That second line is the paywall proving itself.

---

## Group C — first build on your iPhone

### C1. [YOU] Apple Developer account

Confirm your $99/year membership is active: <https://developer.apple.com/account>

### C2. Align package versions (~5 min)

```powershell
cd app
npx expo install --fix
```

Pins everything to the current Expo SDK. **Do this before the first build, not
after** — a mismatch costs a build from your 15/month allowance.

### C3. Create the EAS project (~5 min)

```powershell
npx eas-cli@latest login
npx eas-cli@latest init
```

`init` writes a project ID into `app.json`. Commit it.

### C4. First build (~5 min to submit, 20–60 min queueing)

```powershell
npx eas-cli@latest build --profile development --platform ios
```

Say **yes** when it offers to generate credentials. When it finishes you get a
QR code — scan it on your iPhone to install.

**Budget: 15 iOS builds/month on the free tier.** JS and UI changes need **no
rebuild** — they hot-reload. Only native dependency or `app.json` changes need
a new build. Every native module you need is already installed, so this should
be a rare event.

---

## What to do when something fails

| Symptom | Cause | Fix |
|---|---|---|
| `config error: DATABASE_URL is not set` | `worker/.env` missing or unfilled | B6 |
| `no fixtures for ... run ingest first` | Fixtures not ingested yet | B7 |
| `Missing EXPO_PUBLIC_SUPABASE_URL` | `app/.env` missing | B8 |
| `premium gate: LEAKED n rows` | `model` schema is exposed | **B3 — fix immediately** |
| Ingest warns `PROVISIONAL colours` | A club is not in the colour file | Cosmetic; see SEASON_ROLLOVER.md |
| Migration fails partway | Files run out of order | Re-run from 0001 in order |

---

## Verify at any time

```powershell
cd worker; .venv\Scripts\python.exe -m pytest -q     # 119 tests
cd app;    npx tsc --noEmit                          # types
cd app;    npx vitest run                            # 216 tests
```
