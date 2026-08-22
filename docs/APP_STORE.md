# App Store submission pack

## Account details

| Field | Value |
|---|---|
| App Store name | `Reckon Football` (`Reckon` was taken) |
| Home-screen name | `Reckon` — set in `app.json`, unaffected by the above |
| Bundle ID | `com.reckonfootball.app` |
| SKU | `reckon-001` |
| Support / contact email | `reckon2026@outlook.com` |
| Privacy Policy URL | `<site>/privacy` |
| Terms URL | `<site>/terms` |

`<site>` comes from `EXPO_PUBLIC_SITE_URL` in `app/.env`, so the app and the
listing always agree. Both URLs must load before submitting — App Store Connect
asks for the privacy one directly and rejects a 404.


Everything for App Store Connect. The §5.3 gambling boundary shapes most of it —
see "Reviewer notes" for why that matters more than usual here.

---

## Name and subtitle

**[HARD] The Premier League name must not appear in the app name, subtitle or
icon** (§2). It is an actively enforced trademark.

**There are two different names, and they are set in two different places.**
Conflating them is the most common ASO mistake.

| Where | Value | Limit | Set in |
|---|---|---|---|
| **Home screen** | `Reckon` | ~12 chars before iOS truncates | `app.json` → `expo.name` |
| **App Store listing** | `Reckon: Football Predictions` | 30 chars (28 used) | App Store Connect |
| **Subtitle** | `What do you reckon?` | 30 chars (19 used) | App Store Connect |
| **Promotional text** | `The model has called all ten. What do you reckon?` | 170 chars | App Store Connect |

⚠️ The previous subtitle, `You vs the model. Every gameweek.`, was **33
characters** and App Store Connect would have rejected it at save. Count before
pasting; the field does not warn, it refuses.

**Why the subtitle is the tagline and not a feature list.** The subtitle sits
directly under the name in search results and on the product page, and it is
indexed. `What do you reckon?` is the sentence the app is named after — it
explains "Reckon" instantly to someone who has never heard of it, which a
brand-name-only listing cannot do. It is also the line running as a kicker on
all ten screenshots, so the listing reads as one piece.

The home-screen name must stay short. iOS truncates at roughly 12 characters,
so `Reckon: Football Predictions` would render as `Reckon: Foo…` under the icon
— which looks broken rather than descriptive.

The App Store listing name is where length earns its keep: Apple indexes it for
search, and it is weighted far more heavily than the keywords field. `Reckon`
alone is unfindable by anyone who does not already know the name; **`Reckon:
Football Predictions`** ranks for "football predictions" while still leading
with the brand.

Fallbacks if the name is taken at reservation: **Reckon FC** · **Verdict XI**

Avoid entirely: Bet, Odds, Tips, Picks, Acca, Sure. These invite 5.3 scrutiny
and push you into the gambling ASO category — note how many competitors are
called "Football Prediction & Tips" and sit in exactly that bucket.

---

## Description

**Paste the block below verbatim.** It is fenced, not quoted, so copying it
gives you exactly what should appear in App Store Connect.

> The previous version of this section was a markdown blockquote. Copying it
> carried the `> ` prefixes into the live listing - the field is plain text and
> renders them literally, so the description began "> A statistical model...".
> Markdown bold is stripped for the same reason: `**HOW IT WORKS**` would show
> the asterisks.

```
What do you reckon?

A statistical model predicts every match in the English top flight. You
predict too. Every gameweek you find out who was smarter.

HOW IT WORKS
Tuesday, the model publishes its predictions for all ten matches — full
probabilities, expected goals, and the most likely scorelines. You make your
own calls before kick-off. Predictions lock when the whistle goes. Monday
morning, you find out how you did.

YOUR CALL OF THE WEEK
One match a gameweek counts double. Pick it before kick-off and you cannot
move it once that match starts. The model gets one too — its most confident
fixture — so the comparison stays fair.

A MODEL THAT SHOWS ITS WORKING
Most prediction apps tell you who will win. This one tells you how confident
it is, and then publishes whether it was right. Every gameweek. Including the
bad ones.

The model is a Dixon-Coles bivariate Poisson fitted on fifteen years of
results, blended with an independent rating system. In the first weeks of a
season it says so, and widens its uncertainty, because it has barely any
current data to go on.

FREE FOREVER
Predict every match. See the model's pick and confidence. Track your score
against it. Global leaderboard.

PREMIUM
Full probability breakdowns. The scoreline heatmap. Expected goals, both
teams to score, clean sheets. Complete accuracy history and reliability
charts.

Monthly £2.49 · Annual £14.99 with a 14-day free trial. Subscriptions renew
automatically unless cancelled at least 24 hours before the period ends.
Payment is charged to your Apple ID. Manage or cancel in your Apple ID
settings.

Terms: https://reckon.reckonapp.workers.dev/terms
Privacy: https://reckon.reckonapp.workers.dev/privacy

Not affiliated with, endorsed by, or connected to the Premier League, the
Football Association, or any football club. Predictions are statistical
estimates, not advice, and should not be used for betting purposes.
```

## Keywords (100 chars)

```
football,predictions,match predictor,football stats,xg,fixtures,league table,forecast,soccer
```

⚠️ §15 #7: the §12 keyword list originally opened with "premier league". Keywords
are lower risk than the name but not zero. **Omitted above — add it back only as
a deliberate decision, not by accident.**

---

## Age rating — DONE

Calculated **4+**. Age Categories and Override: **Not Applicable**.

Not "Made for Kids": that opts into the Kids Category, which forbids
third-party analytics entirely (PostHog would have to go) and brings a much
stricter review. §1.3's audience is 18-40, not children.

Answer **No** to every gambling question. Truthfully — there is no wagering, no
real or virtual currency, no odds displayed, and no link to any betting service.
Expected rating: **4+**.

---

## Rejection history

### 1.0 (5) — Guideline 2.1, 21 August 2026

> Specifically, we are unable to locate the Sign in with Apple feature.

They were right. `linkAppleIdentity()` in `app/src/core/auth.ts` was fully
written and exported, `expo-apple-authentication` was installed and its plugin
configured — and **no screen called any of it**. Settings displayed a sentence
telling the user to sign in with Apple with nothing to tap, and both the privacy
policy and the terms named the feature. The app described something it did not
have.

Two things also had to be fixed before the button could work:

- `ios.usesAppleSignIn` was missing from `app.json`, so the entitlement was not
  in the binary and `signInAsync` would have thrown at runtime.
- Supabase's Apple provider must be enabled with `com.reckonfootball.app` in
  Client IDs, or `signInWithIdToken` returns "Unsupported provider".

Fixed in 1.0 (6): a real `AppleAuthenticationButton` in **Settings → Account**
and on the **final onboarding screen**, and `tests/wired-up.test.ts` now fails
if any screen stops rendering it.

Note this is the third time a finished feature shipped mounted to nothing —
crowd-vs-model and the paywall entry were the other two. That test exists
because none of them looked unfinished in review.

---

## Reviewer notes

Same rule as the description: paste the fenced block, not a quote.

```
This app is a prediction game, not a betting or tipster app.

- No wagering of any kind, real or virtual. No currency, coins, tokens or
  stakes.
- No bookmaker odds are displayed anywhere in the app.
- No links to any gambling service. No affiliate relationships.
- Users predict scorelines and earn points. Points have no monetary value and
  cannot be exchanged for anything.
- The subscription unlocks statistical detail (probability breakdowns,
  expected goals, accuracy history). It does not unlock anything wagering-related.

Bookmaker closing odds are used server-side only, as a calibration
benchmark to measure the model's accuracy. They are never sent to the client
and never rendered. This is why the app can honestly claim its accuracy is
measured against a market baseline while displaying no odds.

Demo account: not required, and none is provided.

The app creates an anonymous account automatically on first launch, so the
reviewer can use every feature - predicting, the call of the week, results,
settings, account deletion - without signing in or being asked for anything.
Sign in with Apple is offered but never required, and there is no email,
password or registration step anywhere in the app.

To review the subscription: it is reachable from Settings -> Get Premium, or by
tapping any locked probability on a match screen.

Contact: reckon2026@outlook.com

Restore Purchases is on the paywall and in Settings. Account deletion is in
Settings.
```

---

## Privacy labels

§9.3 [HARD] requires these to be **accurate**. Over-declaring is as wrong as
under-declaring, and it also makes the nutrition label on your product page
look worse than the app actually is.

### Answer "Yes, we collect data from this app"

Two categories, and only two, because of what is actually wired up:

| Apple category | Data type | Linked to user | Used for tracking | Purpose |
|---|---|---|---|---|
| **Identifiers** | User ID | **Yes** | No | App Functionality |
| **Purchases** | Purchase History | **Yes** | No | App Functionality |

- **User ID** — an anonymous Supabase account id created on first launch. It is
  what your predictions, points and streak hang off. Linked, because it is by
  definition tied to the account.
- **Purchase History** — RevenueCat, a third-party partner, receives the
  purchase and the same user id. Apple counts a third-party SDK's collection as
  yours, so it is declared here.

Everything else is **No**: no email, no name, no phone, no address, no location,
no contacts, no photos, no browsing history, no search history, no advertising
identifier, no sensitive data.

Display names are generated ("Quiet Chevron 41"), so no user-supplied personal
data is ever stored — which also keeps the leaderboard out of Guideline 1.2's
UGC obligations (§15 #4). No IDFA means no ATT prompt.

### ⚠️ Do NOT declare analytics or crash data

An earlier version of this table listed *Product Interaction* and *Crash Data*,
on the basis that §3.1 specifies PostHog and Sentry.

Both packages are installed, and **neither one runs.** `initAnalytics()` and
`initCrashReporting()` in `app/src/core/bootstrap.ts` return immediately when
their key is absent, and `EXPO_PUBLIC_POSTHOG_KEY` and `EXPO_PUBLIC_SENTRY_DSN`
are set in neither `.env` nor `eas.json`. Verified against the exported bundle:
zero references. The shipping app transmits no analytics and no crash reports.

**If you ever set either key, you must update these labels in the same release.**
Turning on collection without amending the label is the exact thing Apple
treats as a misrepresentation, and it is easy to do by accident because adding
an EAS secret needs no code change.

## Pre-submission checklist

- [ ] App name trademark-checked and available
- [ ] Bundle ID final — **permanent** once the ASC record exists
- [ ] Paid Apps agreement signed; banking and tax forms complete *(blocks
      subscriptions entirely; longest lead time in the whole project)*
- [ ] Privacy Policy and Terms live at stable URLs
- [ ] Subscription products created in ASC and mapped in RevenueCat
- [ ] RevenueCat webhook secret set in Supabase Edge Function env
- [ ] `npx expo export --platform ios && npm run check-bundle-secrets` clean
- [ ] Restore Purchases works on a real device
- [ ] Account deletion works and actually deletes
- [ ] Tested on cellular, and with airplane mode toggled mid-session
- [ ] Tested at Dynamic Type AX5
- [ ] Demo account created and credentials in the reviewer notes
- [ ] Age rating questionnaire: No to all gambling questions
