# Annual season rollover

The app is built to run year after year. Almost all of the rollover is
automatic — this is the short list of things that are not.

**Automatic** (no action needed):

- The current season advances on **1 July** (`worker/src/premmodel/season.py`).
  Every job, and the app itself, derives it from the date. Nothing is hardcoded.
- The training set extends itself. `premmodel backfill` downloads every
  completed season each run, so last year's results join the model automatically.
- Promoted clubs are ingested with generated placeholder colours rather than
  failing. The season opens whether or not anyone has updated a JSON file.
- Streaks reset per season; career totals and best-ever streak persist.

---

## Late June — before fixtures publish

**1. Check the provider still works and the ToS still allows commercial use.**

```bash
cd worker && python -m premmodel ingest
```

**2. Refresh the training set with the season that just finished.**

```bash
python -m premmodel backfill
python -m premmodel backtest --seasons <last-two-completed-seasons>
```

The backtest exit code is the §5.5 gate. **If it fails, do not ship predictions**
— investigate before the season starts, not during it.

---

## Early July — when fixtures publish

**3. Mark the new season current.**

```sql
select public.begin_season('2027-28');
```

This flips `seasons.is_current`, closes the previous season, and resets
in-season streaks. The leaderboard follows `is_current`, so this is the single
switch that moves everyone onto the new ladder.

**4. Ingest fixtures, then fix the promoted clubs' colours.**

```bash
python -m premmodel ingest
```

Watch for `club(s) seeded with PROVISIONAL colours` in the log, or query:

```sql
select name, slug, primary_color from public.teams where colours_provisional;
```

Add real colours to `app/src/data/team-colours.json`, then set
`colours_provisional = false` for those rows and re-run ingest. This is
cosmetic — the app works either way — but generated colours look generic and
the marks are the whole visual identity (§7.4).

**5. Verify the promoted sides get sane priors.** §5.4 handles clubs with no
top-flight history, but sanity-check the first predictions rather than trusting
it blindly:

```bash
python -m premmodel predict
python -m premmodel gameweek --week 1
```

A promoted side priced as a title contender means the priors need attention.

---

## Before the first match

**6. Generate predictions and confirm the honesty framing is on.**

GW1 output must carry `data_regime = 'prior_heavy'` and a **Low** confidence
band. That is §5.4 working, not a bug — GW1 is the model's weakest week and
saying so is the entire credibility position.

**7. Ship an EAS Update if any copy changed.** JS-only changes need no rebuild
and no review.

---

## Things that will eventually need a real decision

- **A club promoted that has never been in the training set at all.** The model
  falls back to league-average, which is reasonable but crude. If it happens
  often, wire in the Championship data (`fd_couk_csv.CHAMPIONSHIP` already
  supports it; `priors.estimate_promotion_penalty` already measures the gap).
- **League size changes.** The schema assumes 38 gameweeks and does not assume
  20 clubs, but `gameweek <= 38` is a CHECK constraint that would need editing.
- **Provider shutdown.** One file: `providers/__init__.py`. Team identity lives
  in `external_refs`, so no primary key changes.
