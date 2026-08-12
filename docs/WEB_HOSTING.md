# Website

Three static pages. `privacy.html` and `terms.html` are **[HARD] submission
requirements** (§9.3) — App Store Connect will not accept a build without live
URLs, and `src/app/paywall.tsx` and `settings.tsx` already link to them.

## Before you publish

Replace `REPLACE_WITH_YOUR_EMAIL` in all three files. A contact address is
required by Guideline 1.2 and by UK/EU data protection law.

```powershell
cd "c:\Users\Jonny\Desktop\Prem predict\web"
(Get-Content *.html) | ForEach-Object { $_ -replace 'REPLACE_WITH_YOUR_EMAIL','you@example.com' }
```

Then check the dates at the top of each page still make sense.

## Where to host — Cloudflare Pages

**Not Fly.io.** Fly runs containers; you would be provisioning and paying for a
VM to serve three files that never change, plus writing a Dockerfile to do it.
Static hosting is free, faster, and has nothing to keep running.

**Not GitHub Pages either**, in your case — your repo is private, and Pages on
private repos needs a paid GitHub plan.

Cloudflare Pages is free, works with private GitHub repos, and gives you HTTPS
and a custom domain at no cost:

1. <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Pages**
   → **Connect to Git**
2. Authorise GitHub, pick `Prem-predict-`
3. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: **`web`**
4. **Save and Deploy**

You get `something.pages.dev` immediately. Then in **Custom domains**, add
`reckonfootball.app` and follow the DNS instructions.

Final URLs, which match what the app already links to:

```
https://reckonfootball.app/privacy
https://reckonfootball.app/terms
```

The pages live at `privacy/index.html` and `terms/index.html` rather than
`privacy.html`, so those extensionless URLs resolve on **any** static host.
Cloudflare Pages would have mapped `/privacy` to `privacy.html` on its own, but
relying on that means the links silently 404 the day you move hosts — and the
day you move hosts is not the day you want to discover the App Store's required
privacy URL is dead.

If you use a different domain, update `TERMS_URL` and `PRIVACY_URL` in
`app/src/app/paywall.tsx` and `app/src/app/(tabs)/settings.tsx`.

## A caveat worth stating plainly

These pages are a careful, accurate description of what the app actually does —
they were written against the real schema, so the data table is not boilerplate.
They are **not legal advice**, and neither of us is a lawyer. They are a solid
starting point that will pass review; if the app takes real money at scale,
have someone qualified read them.
