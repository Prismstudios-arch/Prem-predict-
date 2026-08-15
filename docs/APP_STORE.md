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

> What do you reckon?
>
> A statistical model predicts every match in the English top flight. You
> predict too. Every gameweek you find out who was smarter.
>
> **HOW IT WORKS**
> Tuesday, the model publishes its predictions for all ten matches — full
> probabilities, expected goals, and the most likely scorelines. You make your
> own calls before kick-off. Predictions lock when the whistle goes. Monday
> morning, you find out how you did.
>
> **YOUR CALL OF THE WEEK**
> One match a gameweek counts double. Pick it before kick-off and you cannot
> move it once that match starts. The model gets one too — its most confident
> fixture — so the comparison stays fair.
>
> **A MODEL THAT SHOWS ITS WORKING**
> Most prediction apps tell you who will win. This one tells you how confident
> it is, and then publishes whether it was right. Every gameweek. Including the
> bad ones.
>
> The model is a Dixon-Coles bivariate Poisson fitted on fifteen years of
> results, blended with an independent rating system. In the first weeks of a
> season it says so, and widens its uncertainty, because it has barely any
> current data to go on.
>
> **FREE FOREVER**
> Predict every match. See the model's pick and confidence. Track your score
> against it. Global leaderboard.
>
> **PREMIUM**
> Full probability breakdowns. The scoreline heatmap. Expected goals, both
> teams to score, clean sheets. Complete accuracy history and reliability
> charts.
>
> Monthly £2.49 · Annual £14.99 with a 14-day free trial. Subscriptions renew
> automatically unless cancelled at least 24 hours before the period ends.
> Payment is charged to your Apple ID. Manage or cancel in your Apple ID
> settings.
>
> Terms: https://reckon.jonnywilsonnn2012.workers.dev/terms
> Privacy: https://reckon.jonnywilsonnn2012.workers.dev/privacy
>
> Not affiliated with, endorsed by, or connected to the Premier League, the
> Football Association, or any football club. Predictions are statistical
> estimates, not advice, and should not be used for betting purposes.

---

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

## Reviewer notes

> This app is a prediction *game*, not a betting or tipster app.
>
> - No wagering of any kind, real or virtual. No currency, coins, tokens or
>   stakes.
> - No bookmaker odds are displayed anywhere in the app.
> - No links to any gambling service. No affiliate relationships.
> - Users predict scorelines and earn points. Points have no monetary value and
>   cannot be exchanged for anything.
> - The subscription unlocks statistical detail (probability breakdowns,
>   expected goals, accuracy history). It does not unlock anything wagering-related.
>
> Bookmaker closing odds are used **server-side only**, as a calibration
> benchmark to measure the model's accuracy. They are never sent to the client
> and never rendered. This is why the app can honestly claim its accuracy is
> measured against a market baseline while displaying no odds.
>
> Demo account: <fill in before submitting>
> The account has predictions already submitted so the results screen is
> populated.
>
> Note: the app creates an anonymous account on first launch, so a reviewer can
> use every feature without signing in. Sign in with Apple is offered but never
> required.
>
> Contact: reckon2026@outlook.com
>
> Restore Purchases is on the paywall and in Settings. Account deletion is in
> Settings.

---

## Privacy labels

Minimum collection (§9.3) — you need a user id, a display name and predictions.

| Data | Collected | Linked to user | Tracking | Purpose |
|---|---|---|---|---|
| User ID | Yes | Yes | No | App functionality |
| Purchases | Yes | Yes | No | App functionality |
| Product interaction | Yes | No | No | Analytics |
| Crash data | Yes | No | No | App functionality |
| **Email** | **No** | — | — | not collected |
| **Name** | **No** | — | — | display names are auto-generated |
| **Location** | **No** | — | — | — |
| **IDFA / advertising** | **No** | — | — | no ATT prompt needed |

Display names are generated ("Quiet Chevron 41"), so no user-supplied personal
data is stored (§15 #4 — this also keeps the leaderboard out of Guideline 1.2
UGC obligations).

---

## Screenshots

Generated, not hand-made:

```
worker/.venv/Scripts/python.exe app/scripts/generate-screenshots.py
```

Writes ten shots at both sizes App Store Connect accepts:

| Folder | Size | Slot |
|---|---|---|
| `app/assets/screenshots/6.9-inch/` | 1290 × 2796 | **required** — upload this set |
| `app/assets/screenshots/6.5-inch/` | 1242 × 2688 | legacy, optional |

Rendered natively at each size rather than up-scaled, because a resampled
screenshot is visibly soft next to a native one at these dimensions.

**Order is deliberate.** Apple shows only the first three on the install sheet
without the user swiping, so those three carry the whole pitch: what the model
gives you, what a week looks like, and what you actually do.

| # | Screen | Caption |
|---|---|---|
| 01 | Match detail (§7.3 signature) | See how sure it is. |
| 02 | Gameweek list | Ten matches. Every Tuesday. |
| 03 | Prediction input | Call all ten in a minute. |
| 04 | Results | Monday morning, you find out. |
| 05 | Reliability chart | A model that admits it's guessing. |
| 06 | Scorelines + marginals | Every scoreline, ranked. |
| 07 | Confidence ranking | It tells you what it doesn't know. |
| 08 | Crowd vs model | You, the model, everyone else. |
| 09 | Club picker (§7.4 marks) | Pick your club. |
| 10 | No-gambling statement | No odds. No betting. Ever. |

All ten carry **WHAT DO YOU RECKON?** as an accent kicker above the headline.
Running it on every shot rather than one makes the set read as a campaign, and
guarantees the line appears whichever three Apple picks for the install sheet.

Overlay text states the benefit, not the feature. Captions follow §5.6 as
strictly as the app does — none of them claims the model knows anything.

**Accuracy.** Every probability, expected-goals figure, scoreline and kick-off
time is pulled from the live database via `worker/data/screenshot_data.json` —
the same Dixon–Coles/Elo output the app renders. Guideline 2.3.3 requires
screenshots to reflect the app in use.

Two things on these are illustrative rather than measured, because no 2026/27
match has been played yet, and both are marked as such in the script:

- the completed-gameweek scores on 04 (the *scoring* is real —
  `score_prediction()`: 5 exact, 2 outcome, 0)
- the crowd row on 08

**Regenerate after any UI change.** These are renders of the real screens, not
device captures, so they drift silently if the design moves.

---

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
