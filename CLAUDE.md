# BUILD SPEC — Premier League Prediction App (iOS)

Master brief for Claude Code.

## 0. HOW TO USE THIS DOCUMENT

You are building a production iOS app that ships to the App Store before Friday 21 August 2026, 20:00 BST (Arsenal v Coventry, opening fixture of the 2026/27 Premier League season).

Work phase by phase. After each phase, stop, summarise what you built, and wait for approval before moving on. Do not scaffold the entire app in one pass — it produces unreviewable slop.

Non-negotiables are marked **[HARD]**. If a request conflicts with a [HARD] rule, refuse and explain.

## 1. PRODUCT DEFINITION

### 1.1 One-liner

A statistical model predicts every Premier League match. You predict too. Every gameweek you find out who was smarter.

### 1.2 Why this framing matters

This is not a tipster app. It is a prediction game with a serious model behind it. That distinction:

- Keeps it out of App Store Guideline 5.3 (gambling) entirely → 4+/12+ rating, worldwide availability, no age gate, no licensing.
- Gives it a retention loop. Pure "here are the predictions" apps have zero reason to open twice.
- Makes the model's accuracy the marketing asset instead of a liability.

### 1.3 Target user

UK/global football fan, 18–40, opinionated, follows one club, argues about football constantly. Not a bettor necessarily — a person who thinks they know better than everyone else. The app exists to test that.

### 1.4 The core loop

```
TUESDAY   → Gameweek opens. Model posts its 10 predictions.
WED–FRI   → User makes their 10 predictions. Push reminder Fri AM.
KICK-OFF  → Predictions lock (server-authoritative).
WEEKEND   → Live scoring as results land.
MONDAY    → "You 6 — Model 4." Streak updated. Rank updated. Share card generated.
```

### 1.5 Naming

Candidates (all require a trademark + App Store name-availability check before you commit): Gaffer · Form · Verdict XI · The Model · Punditry · Matchday IQ · Called It

Avoid: anything with Bet, Odds, Tips, Picks, Accumulator, Sure. These trigger review scrutiny and ASO-poison you into the gambling category.

## 2. HARD CONSTRAINTS

**[HARD] No gambling surface area.** No bookmaker odds displayed. No affiliate links. No "value", "edge", "stake", "banker", "tip", "acca". No real or virtual currency wagering. No links out to any betting site. If a feature requires odds data internally (for model calibration), it stays server-side and is never rendered.

**[HARD] No club crests, badges, kit imagery, or Premier League branding.** These are trademarked. Build an abstract team-identity system: each club gets a generated mark derived from its primary/secondary colours (see §7.4). Club names used descriptively are fine. Do not use the Premier League name or logo in the app icon, app name, or as a primary title — use "English top flight" / "the league" in marketing copy where needed, and add a disclaimer in About: "Not affiliated with, endorsed by, or connected to the Premier League or any club."

**[HARD] No API keys, secrets, or model logic in the iOS binary.** Everything goes through your own backend. Anyone can `strings` your IPA.

**[HARD] No player-level personal data beyond public match statistics.** No scraping of anything behind a login or paywall.

**[HARD] Premium entitlements are enforced server-side.** The API refuses to return premium payloads to unentitled users. Client-side gating alone = trivially bypassed = revenue leak.

**[HARD] Prediction lock uses server time.** Never trust `Date()` on device. A user changing their clock must not be able to submit after kickoff.

## 3. ARCHITECTURE

```
┌──────────────────────────────────────────────────────────┐
│  iOS CLIENT (Expo / React Native, TypeScript strict)      │
│  - Zero business logic for predictions                    │
│  - expo-sqlite local cache for offline read               │
│  - Sign in with Apple + anonymous device account          │
│  - StoreKit 2 via RevenueCat RN SDK                       │
└──────────────────────────────────────────────────────────┘
                          │ HTTPS + JWT + App Attest
                          ▼
┌──────────────────────────────────────────────────────────┐
│  API LAYER (Supabase Edge Functions / Cloudflare Workers) │
│  - Auth, entitlement check, rate limiting                 │
│  - Serves precomputed predictions (never computes live)   │
│  - Writes user predictions with server timestamp          │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│  POSTGRES (Supabase) — RLS on every user table            │
└──────────────────────────────────────────────────────────┘
                          ▲
                          │
┌──────────────────────────────────────────────────────────┐
│  MODEL WORKER (Python, Fly.io or Railway, cron)           │
│  - Nightly: ingest results/xG, refit model, write preds   │
│  - Matchday: poll results every 60s, settle scores        │
│  - Weekly: recalibrate, log Brier/log-loss                │
└──────────────────────────────────────────────────────────┘
```

**Rationale:** predictions are computed on a schedule, not on request. That means the API is a dumb, fast, cacheable read layer that survives a traffic spike at 2:59pm on a Saturday. This is the single most important architectural decision in the app.

### 3.1 Stack decisions

**Build environment: Windows.** No Mac. All iOS compilation and submission happens on EAS Build. This is why the client is Expo, not SwiftUI — see §3.2.

| Layer | Choice | Why |
|---|---|---|
| UI | Expo SDK + React Native, Expo Router | Builds from Windows via EAS; no Mac required |
| Language | TypeScript, `strict: true` | Closest available analogue to Swift 6 strictness |
| Local cache | expo-sqlite + Drizzle | Offline reads. Treat as a **disposable cache** — wipe and refill on schema change, never a source of truth |
| Networking | `fetch` + Zod response validation, zero HTTP deps | Fewer supply-chain risks |
| Charts | react-native-svg + Reanimated, hand-rolled | No Swift Charts. §7.3 was always custom anyway |
| Motion | react-native-reanimated | Real spring physics, maps ~1:1 to the §7.2 curves |
| Backend | Supabase (Postgres + Auth + Edge Functions) | Fastest path to RLS + auth |
| Model | Python ≥3.12, numpy/scipy/pandas | Poisson fitting is trivial here |
| Payments | RevenueCat RN SDK (wraps StoreKit 2) | Receipt validation, entitlements, free at this volume |
| Push | expo-notifications → APNs via Supabase Edge Function | No Firebase dependency |
| Secure storage | expo-secure-store (Keychain-backed) | Never AsyncStorage for tokens |
| Haptics | expo-haptics | |
| Analytics | PostHog | GDPR-clean, no IDFA, avoids ATT prompt entirely |
| Crash | Sentry | |
| CI / build | EAS Build + EAS Update, GitHub Actions | Free tier: 15 iOS builds/mo, 1k MAU OTA |

**Do not add:** Firebase, Axios, any UI component library (NativeBase, Tamagui, gluestack), Lottie (use Reanimated), Redux (use Zustand or context), or any dependency not in the table above without asking.

### 3.2 Consequences of the Expo pivot — read before Phase 2

The pivot removes the Mac blocker, which was the largest schedule risk in the project. It costs the following, and these are accepted, not open questions:

- **No `matchedGeometryEffect`.** Expo Router shared-element transitions are experimental. The fixture → detail transition will be a compromise. Do not burn a day fighting this.
- **§7.5 accessibility is manual.** React Native does not give Dynamic Type for free the way SwiftUI does. Font scaling must be handled explicitly against `PixelRatio.getFontScale()`. §7.5 is [HARD]; budget real time in Phase 4.
- **Widgets and Live Activities require native targets** via config plugins. They are already #1 and #2 on the §13 cut list. Treat them as cut for v1.
- **Cold launch < 1.2s (§10) is harder** with a JS bundle. Hermes + New Architecture required. Measure it; don't assume it.
- **Expo Go is only usable until the first native module lands.** RevenueCat, Sign in with Apple and push all require a Development Build. Sequence: Expo Go for Phase 2 (pure UI), Development Build from Phase 3 onward.
- **EAS free tier is 15 iOS builds/month.** JS changes never need a rebuild. Install *every* native dependency in one pass before the first build; a forgotten module costs a build plus a 20–60 min low-priority queue wait.
- **[HARD] restated, and it matters more here:** a JS bundle is easier to read than a compiled binary. Only `EXPO_PUBLIC_*` values are inlined into the bundle. The Supabase URL and anon key are the *only* things permitted there — the anon key is designed to be public and RLS is what protects you. Everything else is server-side. Your RLS policies are the security model, not a formality.

## 4. DATA PIPELINE

### 4.1 Sources (decide in Phase 0, wire in Phase 1)

**Decision (Phase 0): launch on free sources, add a paid provider in September when revenue exists and the model actually needs live xG.**

- **Primary (live ops):** football-data.org free tier — 10 req/min, which covers daily ingest *and* 60-second matchday polling with headroom. ⚠️ **Open: confirm their terms permit commercial use.** If not, fall back to API-Football (~$19/mo).
- **Secondary (settlement cross-check):** never settle a user's points from a single source. Second provider adapter reads results only.
- **Historical training set:** football-data.co.uk CSVs — 30+ seasons of results *and closing odds*. The odds are the §5.5 market baseline and are used server-side only, never displayed.
- **Understat** for historical xG. One-time backfill to local Parquet; never hit from a live job. Respect their terms; cache aggressively; do not hammer.

**Consequence:** no live xG and no injury feed at launch. This is accepted — §5.4 weights GW1 predictions ~90% prior/preseason anyway, so live xG barely moves a probability before ~GW8. See §5.1 note on fitting target.

Build an adapter interface so the provider can be swapped in one file. You will change provider at some point.

### 4.2 Ingestion jobs

```
02:00 UTC daily    → fetch completed fixtures, results, xG, cards, lineups
02:15 UTC daily    → refit model, write predictions for next 14 days
06:00 UTC daily    → fetch injury/suspension list, apply availability adjustment
Every 60s on MD    → poll live scores, settle user predictions incrementally
Sunday 23:00       → weekly calibration report, accuracy stats, leaderboard rollup
```

### 4.3 Schema (core tables)

```sql
teams(id, name, short_name, primary_color, secondary_color, founded, stadium)
fixtures(id, gameweek, home_team_id, away_team_id, kickoff_utc, status,
         home_goals, away_goals, home_xg, away_xg)
team_ratings(team_id, as_of_date, attack, defence, elo, form_index, confidence)
predictions(fixture_id, model_version, p_home, p_draw, p_away,
            exp_home_goals, exp_away_goals, scoreline_matrix jsonb,
            p_btts, p_over_25, p_home_cs, p_away_cs, confidence, generated_at)
user_predictions(id, user_id, fixture_id, outcome, home_goals, away_goals,
                 submitted_at_server, points_awarded, locked)
users(id, apple_sub, display_name, created_at, streak_current, streak_best,
      total_points, entitlement, notification_prefs jsonb)
model_performance(model_version, gameweek, brier_score, log_loss,
                  accuracy, vs_market_baseline)
leagues(id, name, invite_code, owner_id)   -- private leagues, v1.1
```

**RLS:** users may SELECT/INSERT only their own `user_predictions`, and only where `now() < fixtures.kickoff_utc`. Enforce the lock in the database policy, not just in application code.

## 5. THE MODEL

This is the product. Everything else is packaging. Do not ship a naive "team A has better form" heuristic.

### 5.1 Primary: Dixon–Coles bivariate Poisson

- Fit team attack (α) and defence (β) parameters plus a global home-advantage term (γ).
- Time decay: weight each historical match by `exp(-ξ · days_ago)`, with ξ ≈ 0.0019 (≈ half-life of one year). Tune ξ by maximising out-of-sample log-likelihood.
- Low-score correlation correction (τ): the Dixon–Coles adjustment for 0-0, 1-0, 0-1, 1-1, which independent Poisson systematically misprices.
- **Fitting target — decided:** fit on **goals** for v1 launch; xG is the first post-launch model upgrade. xG is the better estimator (lower variance, stabilises in ~6 matches instead of ~20), but requires historical xG for every match across several seasons, which means a rate-limited Understat backfill with real failure modes, and the payoff doesn't land until ~GW8 (see §5.4). This removes a day of schedule risk from Phase 1, which is the critical path.
- Output the full score matrix (0–7 goals each side), then marginalise for: P(H/D/A), most likely scorelines, BTTS, over/under 2.5, clean sheets.

### 5.2 Secondary: Elo / pi-ratings

Independent ratings updated match-by-match with margin-of-victory scaling. Cheap, robust, and decorrelated enough from Poisson to add value in the ensemble.

### 5.3 Ensemble

Blend the two with logistic regression stacking, weights fitted on the previous three seasons. Add adjustment features:

- Rest days differential (fixture congestion)
- European midweek involvement
- Key player availability (weight by minutes share + xG/xA contribution)
- Travel distance (marginal, but real for the away side)
- Manager change within last 3 matches (bounce effect — small, decaying)
- New-manager / promoted-side uncertainty widening

### 5.4 The early-season problem — read this carefully

On 21 August you will have zero matches of 2026/27 data, and three promoted sides (Coventry, Hull, Ipswich) with no top-flight form at all. A model fitted naively on nothing will output garbage and destroy trust in week one.

Handle it properly:

- Carry over prior-season ratings with regression toward the league mean (~35% shrinkage over the summer).
- Promoted sides: initialise from Championship performance with a league-strength conversion factor (historically ~0.65–0.75 of top-flight equivalence), then apply heavy shrinkage.
- Transfer adjustment: net xG-contribution of players in/out, capped so a single signing can't swing a rating wildly.
- Blend weight: in GW1, predictions are ~90% prior/preseason, decaying to ~0% by GW8 as current-season data accumulates.
- Widen confidence intervals in GW1–6 and show that in the UI. Honest uncertainty builds far more trust than false precision.

### 5.5 Calibration & honesty — this is your moat

- Track Brier score and log loss every gameweek. Store in `model_performance`.
- Benchmark against a market baseline (closing implied probabilities, de-vigged). Server-side only, never displayed. If you beat it, you have a genuine claim. If you don't, you have an honest one.
- **Phase 1 gate (§11) — defined:** the gate is *proximity* to the de-vigged market baseline, never beating it. Held-out season multiclass Brier within **+0.010** and log-loss within **+0.05** of baseline. Ballpark for de-vigged PL closing odds is log-loss ~0.98–1.00, Brier ~0.19–0.20; a competent Dixon–Coles lands ~1.00–1.03. Lock the exact numbers after the first baseline run, but the *rule* is agreed before any results are seen.
- Ship a reliability chart in the app: "when we said 60%, it happened 58% of the time." No other app in this category does this. It is your entire credibility story.
- **Seed the reliability chart with the backtest**, clearly labelled as historical, and layer live season data on as it accrues. By GW3 you have ~30 live predictions — a reliability diagram over 30 points is noise, and shipping a noisy one damages the credibility this section exists to build.
- Never hide a bad week. Publish the accuracy history unfiltered. The app's tone is "a model that shows its working", not "we know who wins."

### 5.6 Copy rules for model output

Always probabilistic, never assertive:

- ✅ "Arsenal 64% · Draw 22% · Coventry 14%"
- ✅ "Most likely scoreline 2–0 (11.3%)"
- ✅ "Low confidence — first gameweek, limited data"
- ❌ "Arsenal will win"
- ❌ "Nailed on"
- ❌ any language implying certainty or wagering

## 6. FEATURES

### 6.1 MVP — must ship by 16 August

- **Onboarding** (4 screens max): pick your club → how it works → notification permission (soft-asked, with reason) → done. No forced signup; anonymous device account, upgrade to Sign in with Apple later.
- **Gameweek screen** — the home screen. All 10 fixtures, model probability bars, tap to expand.
- **Make your prediction** — outcome + scoreline per fixture. Satisfying tactile input. Haptics on lock-in.
- **Match detail** — full model breakdown: probability split, top 5 scorelines, expected goals, head-to-head, form, key absences, confidence level.
- **Results & scoring** — after the weekend: you vs model, points, streak.
- **Model accuracy** — season-to-date record, reliability chart, per-gameweek history.
- **Paywall + subscription.**
- **Settings** — notifications, club, restore purchases, privacy, about/disclaimer.

### 6.2 v1.1 — first two weeks after launch

- **Private leagues** — invite code, 2–100 friends, table. This is your growth engine; every league invite is a free install.
- **Global leaderboard** with weekly + season tables.
- **Share cards** — beautiful image export of your gameweek result. Designed for group chats, not Twitter.
- **Widgets** — Lock Screen + Home Screen: next fixture with the model's split; live during matches.
- **Live Activity** — Dynamic Island during matches showing your prediction status across the slate. High-effort, high-delight.

### 6.3 v1.2+ — season-long roadmap

- **Season simulator** — 10,000 Monte Carlo runs of the remaining fixtures → title odds, top-4 odds, relegation odds per club, updated nightly. This is the single best premium feature you can build. Massive perceived value, cheap to compute, screenshot-able.
- **Your club hub** — everything filtered to the one team they picked at onboarding.
- **Prediction streaks & badges** — "5 correct in a row", "beat the model 3 weeks running", "called the 3-0".
- **Model vs Pundits** — track public pundit predictions (publicly published ones) against the model. Free content marketing every single week.
- **Rivalry mode** — head-to-head with one friend, season-long, persistent.
- **Notifications digest** — Monday morning wrap.
- **Watch app** — quick predictions from the wrist.

## 7. DESIGN

### 7.1 Direction

Editorial sports data terminal, not a fantasy football app. Think a broadsheet's data journalism desk crossed with a trading terminal. Restrained, confident, dense where density earns its place.

Explicitly avoid: rounded gradient cards, emoji in the UI, glassmorphism everywhere, generic green "sports app" palette, stock football photography, anything that looks like a template.

### 7.2 System

- **Dark first.** Near-black base (`#0A0B0D`), elevated surfaces at `#141619`, `#1C1F24`. Ship a light mode but design dark.
- **One accent.** A single electric colour (suggest an acid lime `#C4F000` or electric blue `#2E5BFF`) used only for the model's voice and primary actions. Never decorative.
- Team colours are the only other saturation in the app, used as thin accent strips and mark fills.
- **Type:** system font (`System` → SF Pro on iOS) for headings with tight tracking (`letterSpacing: -0.02em` equivalent) at large sizes. All numbers use `fontVariant: ['tabular-nums']` — non-negotiable, numbers must not jitter when they update.
- **Spacing:** 4pt base grid. Generous vertical rhythm. Let the data breathe.
- **Motion:** spring physics only — Reanimated `withSpring({ damping: 18, stiffness: 180 })` as the house curve. Probability bars animate in with a staggered 40ms delay. Nothing bounces gratuitously. Shared-element fixture → detail transition is best-effort (see §3.2).
- **Haptics:** `Haptics.impactAsync(Rigid)` on prediction lock-in, `notificationAsync(Success)` on a correct result. Sparingly.

### 7.3 The signature moment

Every good app has one screen people screenshot. Yours is the match detail probability visualisation — a horizontal stacked bar for H/D/A that animates from centre, with the score matrix rendered as a 8×8 heatmap below it. Get this one screen perfect and it does your marketing.

### 7.4 Team marks (crest replacement)

Generate deterministically from team primary/secondary colours: a geometric mark (circle, split-diagonal, chevron, halves, hoops, vertical stripes) chosen by a hash of the team ID, filled in club colours, with the club's initials in the centre. Consistent, distinctive, legally clean, and it will look more coherent than 20 real badges ever would.

### 7.5 Accessibility [HARD]

- Full Dynamic Type support up to AX5. Test it.
- All probability information must also be conveyed as text, never colour alone.
- VoiceOver labels on every chart: "Arsenal 64 percent, draw 22 percent, Coventry 14 percent."
- Minimum 44×44pt touch targets.
- Respect `.reduceMotion`.

## 8. MONETISATION

### 8.1 Model: freemium subscription

**Free forever**

- Make predictions on every fixture
- Model's headline pick + confidence level for every match
- Your score vs the model
- Global leaderboard
- 1 private league

**Premium**

- Full probability breakdown (H/D/A percentages, not just the pick)
- Score matrix + top 5 scorelines
- xG projections, BTTS, over/under, clean sheet probabilities
- Injury/availability impact analysis
- Full model accuracy history + reliability charts
- Season simulator (title/top-4/relegation odds)
- Unlimited private leagues
- Widgets + Live Activities
- Deep club pages

The split is deliberate: free users get enough to play the game every week and stay engaged; premium is the depth. **Never paywall the core loop** — a paywalled game has no players and no leaderboard.

### 8.2 Pricing

| SKU | Price | Notes |
|---|---|---|
| Monthly | £2.49 | |
| Annual | £14.99 | **14-day** free trial (see note). Headline as "£1.25/month" |
| Season Pass (non-consumable) | £24.99 | One-off. Converts price-resistant users beautifully |

Push annual hard — football is a 10-month product and annual matches the season shape. Run the trial so it converts after they've experienced two gameweeks.

**Trial length — changed to 14 days.** This table originally said 7, which contradicted the sentence above it: gameweeks are weekly, so a 7-day trial covers *one*. The user would predict once, never reach the "You 6 — Model 4" moment the trial exists to sell, and then be asked to pay. 14 days delivers the two gameweeks the rationale actually calls for.

### 8.3 Paywall rules

- Never show on first launch. Show after the user completes their first gameweek prediction — the moment of peak investment.
- Contextual soft paywalls: tapping a locked probability breakdown shows a blurred preview of the real data behind it.
- Single-screen paywall, three options, annual pre-selected, trial terms in plain English above the fold.
- **[HARD]** Restore Purchases button, visible, on the paywall and in Settings. Missing this is a guaranteed rejection.
- **[HARD]** Subscription length, price, and auto-renewal terms shown before purchase, with links to Terms and Privacy Policy. Also required in the App Store description.

### 8.4 Retention mechanics

- **Streaks:** consecutive gameweeks with predictions submitted. Losing a streak must hurt slightly.
- **Push notifications** (all opt-out, all in Settings):
  - Thu 18:00 — "Gameweek 3 is open. 10 predictions waiting."
  - Fri 2h before first kickoff — "Predictions lock in 2 hours."
  - Mon 08:00 — "You beat the model 6–4. You're 14th in the world."
- Weekly reset is your natural re-engagement cadence. Football gives you this for free — use it.
- **Loss aversion:** show the user's rank slipping if they don't play.

## 9. SECURITY

### 9.1 Client

- **[HARD]** No secrets in source or `app.json`. Only `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` may reach the bundle; everything else lives in EAS secrets and is server-side only. Verify by grepping the built JS bundle before submission.
- Tokens in `expo-secure-store` (Keychain-backed) with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Never AsyncStorage.
- ATS enforced. No `NSAllowsArbitraryLoads` in the config plugin.
- **Deferred to v1.1:** App Attest and SPKI certificate pinning. Both are 1–2 days done properly, neither has a first-class Expo module, and pinning can brick the app in the field. Launch with JWT + per-user rate limiting; the asset being protected has near-zero value in week one. Both belong on the §13 cut list above accuracy charts.
- Jailbreak detection is optional and defeatable — skip it.

### 9.2 Server

- **[HARD]** RLS enabled on every table containing user data. Default deny.
- **[HARD]** Entitlement verified server-side against RevenueCat webhook state before returning any premium field. Premium data must be **absent from the response**, not hidden in the UI.
- Rate limiting per user and per device (App Attest key) — e.g. 60 req/min burst, 1000/hour sustained.
- Prediction submission validated: fixture exists, `now() < kickoff_utc`, user hasn't already submitted, scoreline within sane bounds.
- All timestamps `now()` from Postgres. Ignore any client-supplied time.
- Secrets in the platform's secret manager. Rotate the data-provider key on a schedule.
- Structured audit logging on entitlement changes and prediction writes.

### 9.3 Privacy & compliance

- **[HARD]** Privacy Policy + Terms hosted at stable URLs before submission.
- **[HARD]** Accurate App Privacy nutrition labels in App Store Connect.
- Use a GDPR-clean analytics provider so you never show the ATT prompt — you don't need IDFA and the prompt costs you conversions.
- UK/EU GDPR: account deletion in-app (Apple requires this if you offer account creation), data export on request.
- **[HARD]** If you offer any third-party sign-in, you must also offer Sign in with Apple.
- Minimum data collection: you need a user ID, a display name, and predictions. Nothing else. Don't collect email unless you have a reason.

## 10. QUALITY BAR

- **Performance:** cold launch to interactive < 1.2s. Gameweek screen scrolls at 120fps on ProMotion. Test on an iPhone 12 or older, not just the simulator.
- **Offline:** every screen the user has visited must render from SwiftData cache with a clear "last updated" state. No blank screens, no infinite spinners.
- **Error states:** every network call has a designed failure state with a retry. Never a raw error string.
- **Empty states:** designed, not blank.
- **Testing:** Vitest on the client-side scoring/formatting logic; Python tests on the model are mandatory — assert probabilities sum to 1.0, assert the score matrix is normalised, assert calibration on a held-out season. (The probability-sum invariant is *also* enforced as a Postgres CHECK constraint so a broken 02:15 UTC model run cannot write garbage to production.)
- **CI:** GitHub Actions — `tsc --noEmit`, ESLint, Vitest, and pytest on every PR. EAS Build is manual, not per-PR — the free tier is 15 iOS builds/month.

## 11. BUILD PHASES

**Phase 0 — Foundations (Day 1)** Repo, Expo project, Supabase project, schema + RLS, data-provider adapter, EAS secret handling, CI. *Deliverable: a fixture list fetched from your own API and printed to console.*

**Phase 1 — Model (Days 1–3)** Python worker. Historical ingest. Dixon–Coles fit with time decay. Elo. Ensemble. Preseason priors and promoted-side handling. Backtest on 2023/24 and 2024/25 — report Brier score and comparison to market baseline. Do not proceed until backtest results are acceptable. *Deliverable: predictions table populated for GW1.*

**Phase 2 — Core UI (Days 3–6)** Design system (colours, type, spacing, components). Gameweek screen. Match detail with the signature probability visualisation. Prediction input flow. All against real data.

**Phase 3 — Accounts, scoring, monetisation (Days 6–8)** Sign in with Apple + anonymous accounts. Prediction submission with server lock. Settlement job. Results screen. RevenueCat, products, paywall, server-side entitlement gating.

**Phase 4 — Polish (Days 8–9)** Onboarding. Empty/error/offline states. Animation and haptics pass. Accessibility audit. Dynamic Type at AX5. Performance profiling on device.

**Phase 5 — Ship (Days 9–11)** App Store Connect setup, screenshots, description, keywords, privacy labels, age rating questionnaire. TestFlight with 10+ real testers. Reviewer notes with demo account and a clear explanation that the app contains no gambling functionality. Submit by 16 August.

**Phase 6 — In-season (weekly)** Private leagues → widgets → Live Activities → season simulator. Ship every Tuesday. Football gives you a weekly news cycle; use it.

## 12. APP STORE SUBMISSION CHECKLIST

- [ ] App name available + trademark-checked
- [ ] Icon: works at 29pt, distinctive at thumbnail size in search results
- [ ] Screenshots: 6.9" and 6.5" required. Lead with the signature match-detail screen. Text overlays stating the benefit, not the feature
- [ ] Keywords: football predictions, premier league, football stats, match predictor, football game, xg, fixtures, league table — no gambling terms
- [ ] Description: leads with the game, then the model. Includes subscription terms and the "not affiliated" disclaimer
- [ ] Age rating questionnaire: answer no to all gambling questions — truthfully, because there is none
- [ ] Reviewer notes: demo account credentials + explicit statement of no wagering, no odds, no real money
- [ ] Privacy Policy + Terms URLs live and reachable
- [ ] App Privacy labels accurate
- [ ] Restore Purchases present and functional
- [ ] Account deletion in-app
- [ ] Tested on a physical device, on cellular, with airplane mode toggled mid-session
- [ ] JS bundle grepped — no keys beyond the Supabase anon key, no internal URLs

## 13. RISK REGISTER

| Risk | Mitigation |
|---|---|
| Rejected under 5.3 | No odds, no wagering language, explicit reviewer note. Have a stripped build ready |
| Data provider outage on matchday | Cache last-known-good; secondary provider adapter ready; graceful degradation |
| Model embarrasses itself in GW1 | Wide confidence bands, prominent "early season, limited data" framing, publish accuracy honestly |
| Traffic spike Saturday 3pm | Precomputed predictions + CDN cache. Never compute on request |
| Scraping of your predictions | Per-user rate limiting at launch; App Attest in v1.1 (§9.1) |
| EAS free tier: 15 iOS builds/mo | Install all native deps in one pass before the first build. JS changes need no rebuild |
| App Review rejection round | Submit by ~13–14 Aug to leave room for one rejection before the 21st |
| Not ready by 21 Aug | Cut in this order: Live Activities → widgets → App Attest/pinning → season simulator → private leagues → accuracy charts. **Never cut:** prediction loop, model quality, paywall |

## 15. OPEN DECISIONS

Deliberately unresolved. Each blocks a later phase, none blocks Phase 0.

| # | Decision | Blocks | Recommendation |
|---|---|---|---|
| 1 | ~~**App name + bundle ID.**~~ **DECIDED.** Name: **Reckon** — "what do you reckon?" is the conversation the app is about, and being warm and human against a cold model *is* the product's story. No gambling vocabulary, so it stays clear of §2 and of the ASO category. Bundle ID: `com.reckonfootball.app`, set before any App Store Connect record existed, so it was still free to change. ⚠️ **Still outstanding:** App Store name availability (only App Store Connect can confirm, at reservation) and a proper trademark search — note Reckon Ltd (AU accounting software) holds marks in software classes. A web search found no football-prediction collision; that is not clearance | Phase 5 | Register `reckonfootball.app` — §9.3 [HARD] needs Terms and Privacy at stable URLs before submission anyway |
| 2 | **Launch date.** §6.1 says 16 Aug, §11's phases run to day 11 (20 Aug), App Review needs slack | Phase 5 | TestFlight for GW1, public launch GW2–3. GW1 is by §5.4 the model's weakest week and the worst week to be judged |
| 3 | **Season Pass pricing is inverted.** Annual £14.99 buys 12 months; Season Pass £24.99 buys ~10 for £10 more. Nobody rationally buys it | Phase 3 | Drop it for v1. Two SKUs beat three |
| 4 | **Global leaderboard = UGC.** Free-text display names trigger Guideline 1.2 (filtering, reporting, blocking, published contact) | Phase 3 | Auto-generate display names ("Quiet Chevron 41"), no free text. The whole obligation disappears. Custom names in v1.1 with real moderation |
| 5 | **Anon → Sign in with Apple merge.** User has anon predictions on device B, signs in with an Apple ID that already has an account. Whose data wins? | Phase 3 | SIWA account wins, anon predictions discarded, explicit warning before linking |
| 6 | **§8.1 sells "1 private league" free, but §6.2 ships leagues in v1.1.** Launch paywall would advertise a feature that doesn't exist | Phase 3 | Fix the paywall copy |
| 7 | **§2 forbids the Premier League name; §12's keyword list opens with "premier league"** | Phase 5 | Keep it out of name and subtitle. Keywords are a lower but nonzero risk — take it knowingly, not by accident |
| 8 | **football-data.org commercial-use terms** (§4.1) | Phase 1 | Read the ToS. Determines £0 vs £15/mo |
| 9 | ~~**Unverified factual premises.**~~ **RESOLVED — both correct.** Verified against the official fixture list ingested from football-data.org: the opener is **Arsenal v Coventry, Fri 21 Aug 2026, 19:00 UTC (20:00 BST)**, and the promoted trio is **Coventry, Hull, Ipswich**. Marketing copy and model priors both rest on accurate facts | — | Done |

## 14. FIRST INSTRUCTION TO CLAUDE CODE

Read this entire spec. Then start **Phase 0 only**. Before writing code, give me:

1. Your recommended data provider and why, with monthly cost.
2. The exact Postgres schema with RLS policies.
3. The repo structure for both the iOS app and the Python worker.
4. Any place where you think this spec is wrong or over-scoped for 11 days.

Then stop and wait for approval. Do not scaffold the whole app.

---

**Disclaimer to include in the app's About screen:**

> "This app is not affiliated with, endorsed by, or connected to the Premier League, the Football Association, or any football club. Predictions are statistical estimates, not advice, and should not be used for betting purposes."
