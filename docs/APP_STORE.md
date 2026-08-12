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
| **Subtitle** | `You vs the model. Every gameweek.` | 30 chars | App Store Connect |

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

> A statistical model predicts every match in the English top flight. You
> predict too. Every gameweek you find out who was smarter.
>
> **HOW IT WORKS**
> Tuesday, the model publishes its predictions for all ten matches — full
> probabilities, expected goals, and the most likely scorelines. You make your
> own calls before kick-off. Predictions lock when the whistle goes. Monday
> morning, you find out how you did.
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
> Monthly £2.49 · Annual £14.99 with a 7-day free trial. Subscriptions renew
> automatically unless cancelled at least 24 hours before the period ends.
> Payment is charged to your Apple ID. Manage or cancel in your Apple ID
> settings.
>
> Terms: https://<your-domain>/terms
> Privacy: https://<your-domain>/privacy
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

## Age rating

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

6.9" and 6.5" required. Lead with the signature match-detail screen (§7.3).

1. **Match detail** — the probability bar and scoreline heatmap. The screenshot
   that sells the app.
2. **Gameweek list** — ten matches, model splits visible.
3. **Results** — "You 6 — Model 4".
4. **Accuracy** — the reliability chart, seeded with backtest data and labelled
   as historical (§5.5).
5. **Prediction input**.

Overlay text states the benefit, not the feature: *"See exactly how confident
the model is"* beats *"Probability breakdowns"*.

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
