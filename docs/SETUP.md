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

### A2. [YOU] Reserve the name and register the domain (~20 min)

**Bundle ID is decided:** `com.reckonfootball.app`, already set in
`app/app.json`. It was changed while no App Store Connect record existed, which
is the only window in which that is free. **Do not change it again after
creating the app record — it is permanent from that moment.**

Two things still outstanding:

1. **Reserve "Reckon" in App Store Connect.** That is the only place that can
   confirm the name is available, and it tells you at reservation time. Have a
   fallback ready — *Reckon FC*, *Verdict XI*.
2. **Register `reckonfootball.app`.** §9.3 [HARD] requires Privacy Policy and
   Terms at stable URLs before submission, and `src/app/paywall.tsx` already
   links to them. Host them free on GitHub Pages or Cloudflare Pages.

⚠️ A web search found no football-prediction app called Reckon, but that is
**not trademark clearance**. Reckon Ltd (Australian accounting software) holds
marks in software classes. Worth a proper search before you spend on branding.

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

**First time:** Supabase dashboard → **SQL Editor** → paste the whole of
`supabase/combined_setup.sql` → **Run**.

That file is every migration concatenated, wrapped in one transaction, so a
failure anywhere applies nothing rather than leaving you with half a schema.
It is generated — regenerate it with `python supabase/build_combined.py`
whenever a migration is added, and `pytest worker/tests/test_combined_setup.py`
fails if you forget.

> This step used to list the files by hand and stopped at `0005`, so anyone
> following it got a database with no crowd views, no confidence labels, and —
> worst — without `0008`, whose column grant is the only thing that lets a
> prediction be saved at all. Hence the generated file.

**Already have a database?** Run only the migrations you have not applied yet,
in order, from `supabase/migrations/`. Applying one twice is safe for most of
them but not all, so check rather than re-running everything:

```sql
-- Which of the newer ones are already in?
select
  to_regclass('public.crowd_vs_model')            is not null as has_0006,
  exists (select 1 from information_schema.columns
          where table_name = 'user_predictions'
            and column_name = 'is_call_of_the_week')          as has_0009;
```

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

## Group D — make premium actually unlock (~15 min)

**Read this if you have bought the subscription in sandbox and the score matrix
is still locked.** That is not a paywall bug. It is this group not being done.

The chain that unlocks premium *data* has four links, and the app is only the
first one:

```
purchase  →  RevenueCat  →  webhook  →  public.users.entitlement = 'premium'
                                              ↓
                            public.is_entitled() returns true
                                              ↓
                    predictions_premium returns rows instead of NOTHING
```

§9.2 [HARD] is why it works this way: premium data is **absent** from the
response for an unentitled user, not hidden in the UI. So until
`public.users.entitlement` flips, the heatmap has no data to draw and correctly
shows the paywall — no matter what StoreKit or RevenueCat think.

### D1. Deploy the two Edge Functions (~5 min)

Run from the **repo root**, not from `app/` — the CLI looks for
`supabase/config.toml` beside you.

```powershell
npx supabase@latest login
npx supabase@latest functions deploy revenuecat-webhook --project-ref wqrpvvrbgaotcozdyvoi
npx supabase@latest functions deploy sync-entitlement   --project-ref wqrpvvrbgaotcozdyvoi
```

`--project-ref` avoids `supabase link`, which would ask for the database
password for no benefit here.

`supabase/config.toml` sets `verify_jwt = false` on the webhook. That is not
optional: the gateway checks for a Supabase JWT before your function runs, and
RevenueCat sends its own shared secret instead. With verification on, the
webhook answers 401 forever, logs nothing, and the entitlement never lands.

### D2. Set their secrets (~5 min)

Invent any long random string for the webhook secret — it just has to match on
both sides.

```powershell
npx supabase@latest secrets set REVENUECAT_WEBHOOK_SECRET="<a long random string you invent>" --project-ref wqrpvvrbgaotcozdyvoi
npx supabase@latest secrets set REVENUECAT_SECRET_KEY="<RevenueCat -> API keys -> Secret key, starts sk_>" --project-ref wqrpvvrbgaotcozdyvoi
```

⚠️ The **secret** key (`sk_…`) is not the public SDK key (`appl_…`) that is in
`eas.json`. The secret key can read and modify your RevenueCat account. It goes
here and nowhere else — never in `.env`, never in the app, never in chat.

### D3. Point RevenueCat at the webhook (~3 min)

RevenueCat → your project → **Integrations → Webhooks → + New**

| Field | Value |
|---|---|
| URL | `https://wqrpvvrbgaotcozdyvoi.supabase.co/functions/v1/revenuecat-webhook` |
| Authorization header | `Bearer <the same random string from D2>` |
| Environment | **Sandbox and Production** — sandbox is how you test |

### D4. Check the entitlement, not just the offering (~2 min)

Two different things in RevenueCat share the name you chose:

- the **Offering** `premium` — which products the paywall displays
- the **Entitlement** `premium` — what a purchase grants

The app checks the **Entitlement**, and its identifier must be exactly
`premium` (it is matched against `PREMIUM_ENTITLEMENT` in
`app/src/core/entitlements.ts`). Confirm under **Entitlements** that `premium`
exists and that **both** products are attached to it. An Offering with no
Entitlement sells fine and unlocks nothing.

### D5. Test it

Buy with a sandbox Apple ID. The app calls `sync-entitlement` before dismissing
the paywall, so premium should be live by the time you are back on the match
screen — even if the webhook is slow. Then check in Supabase:

```sql
select entitlement, entitlement_expires_at from public.users where id = auth.uid();
select event_type, entitlement, created_at from public.entitlement_events
order by created_at desc limit 5;
```

`MANUAL_SYNC` rows are `sync-entitlement`; the rest are the webhook. Seeing
only `MANUAL_SYNC` means D3 is wrong and the webhook is not arriving.

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
