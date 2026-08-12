# Command reference

Copy-paste. All paths absolute so it does not matter where your terminal is.

---

## Run the app on your phone

```powershell
cd "c:\Users\Jonny\Desktop\Prem predict\app"
npx expo start --dev-client
```

Leave it running. On your phone open **Reckon**, pull down to refresh, tap the
server that appears.

While it runs, in that terminal:

| Key | Does |
|---|---|
| `r` | reload the app |
| `j` | open debugger |
| `Ctrl+C` | stop |

If the phone cannot see the server, add `--tunnel` (slower, but works through
router isolation and mobile hotspots).

**Code changes do not need a rebuild.** Save a file, it reloads. Only native
dependency or `app.json` changes need `eas build` again.

---

## See the premium UI (heatmap, exact probabilities)

Entitlement is server-owned (§9.2 [HARD]) — the client cannot grant it, and in
production only the RevenueCat webhook writes it. This is the dev escape hatch:

```powershell
cd "c:\Users\Jonny\Desktop\Prem predict\worker"
.venv\Scripts\python.exe -m premmodel grant-premium
```

Then reload the app (`r` in the Expo terminal).

To go back to seeing what a free user sees:

```powershell
.venv\Scripts\python.exe -m premmodel grant-premium --revoke
```

**"No user accounts exist yet"** means anonymous sign-in is still off. Enable it
at Supabase → **Authentication → Sign In / Providers → Anonymous sign-ins**,
launch the app once, then re-run.

---

## Data jobs

```powershell
cd "c:\Users\Jonny\Desktop\Prem predict\worker"

# Teams + fixtures from the provider
.venv\Scripts\python.exe -m premmodel ingest

# Fit the model and write predictions for the next 14 days
.venv\Scripts\python.exe -m premmodel predict

# Poll results, settle predictions, roll up points and streaks
.venv\Scripts\python.exe -m premmodel settle

# Print a gameweek straight from the database
.venv\Scripts\python.exe -m premmodel gameweek --week 1

# Refresh the historical training set (every completed season)
.venv\Scripts\python.exe -m premmodel backfill

# Walk-forward backtest. Exit code IS the §5.5 gate verdict.
.venv\Scripts\python.exe -m premmodel backtest --reliability
```

---

## Checks

```powershell
# Python: 134 tests + lint
cd "c:\Users\Jonny\Desktop\Prem predict\worker"
.venv\Scripts\python.exe -m pytest -q
.venv\Scripts\python.exe -m ruff check src tests

# TypeScript: types + 231 tests
cd "c:\Users\Jonny\Desktop\Prem predict\app"
npx tsc --noEmit
npx vitest run

# Does it actually bundle? Catches route and import errors without a build.
npx expo export --platform ios

# §12 submission check: no secrets in the shipped bundle
npm run check-bundle-secrets

# Config sanity before spending an EAS build
npx expo-doctor@latest

# Live end-to-end: fixtures, both prediction tiers, and the paywall gate
npm run fixtures
```

---

## Builds

**Free tier is 15 iOS builds/month.** You only need one when native deps or
`app.json` change.

```powershell
cd "c:\Users\Jonny\Desktop\Prem predict\app"

# Install on your own device
npx eas-cli@latest build --profile development --platform ios

# TestFlight / App Store
npx eas-cli@latest build --profile production --platform ios
npx eas-cli@latest submit --platform ios

# Push a JS-only change to installed builds without a rebuild or review
npx eas-cli@latest update --branch production
```

---

## Git

```powershell
cd "c:\Users\Jonny\Desktop\Prem predict"
git status
git add -A
git commit -m "your message"
git push
```

Repo: <https://github.com/jonnywilsonnn2012-maker/Prem-predict->
