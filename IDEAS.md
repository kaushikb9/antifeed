# antifeed — ideas & known gaps

From an independent code + product review (2026-07-25). Nothing here is
built; it's the menu to pick from. Respect the prime directive: **read,
don't tweak systems.**

## Fix next (real defects, ordered by pain)

1. **Offline toggles can be lost.** If a flag POST fails, the local change
   stays only in localStorage; the next successful sync GET overwrites it.
   Fix: queue failed deltas and replay them before the next GET
   (`site/app.js` syncLoad/toggleFlag).
2. **Inbox clear can eat links.** curate/inbox scripts clear the whole KV
   inbox after a run, even if the brain skipped items (dead link, judgment
   call) or a link was added mid-run from the phone. Fix: clear only the
   URLs from the fetched snapshot that now exist in articles.json; write the
   brain's "skipped X because Y" summary to `brain/last-run.txt`.
3. **Stale cache on the phone.** `fetch("data/articles.json")` with no
   cache-busting — the morning visit can show yesterday's pick. One-line
   fix (`?v=date` or `cache: "no-cache"`); disproportionate payoff.
4. **"Read it →" doesn't mark as read.** Auto-flag ✓ when the read button is
   clicked (✓ tap = undo). Makes the read-tracking honest without ceremony.
5. **Curation commits never pushed.** articles.json history lives on one
   laptop. Add `git push || true` to curate.sh/inbox.sh.
6. **Brain output isn't schema-checked.** A missing `read_minutes` or a
   timestamp-shaped `published` renders as "undefined min"/"Invalid Date".
   Small node validator before commit.
7. **Flag RMW races.** Two devices toggling simultaneously can clobber one
   toggle (whole-blob write in `functions/api/flags.js`); KV eventual
   consistency adds a stale-read window. Acceptable for one user; fix only
   if a lost flag is ever actually noticed.
8. **Hardening (needs a hostile curation run to matter):** escape `a.id` in
   inline onclick handlers; reject non-http(s) URL schemes at render;
   tighten brain tool allowlist (it can currently Read the token file and
   curl anywhere while fetching arbitrary pages).
9. **Small polish:** taps inside the expanded card shouldn't collapse it;
   read/star filters ignore the active tab (global — fine, but implies
   scoping it doesn't do); URL dedupe misses http/https + `?utm_*`
   variants; empty-articles state hides the mine form; two same-date musts
   make "today" depend on file order — brain should keep one must per day.

## MVP gaps (would bite within two weeks)

- **Automation is the #1 habit risk** — one busy morning breaks the fresh
  pick. launchd plist calling `curate.sh` first (zero new infra); GitHub
  Actions only if laptop-cron proves flaky (needs API key + token as repo
  secrets).
- **Phone capture friction** — the moment you meet a link is in another
  app. An iOS Shortcut in the share sheet POSTing to `/api/inbox` with the
  token is ~15 min and no new code. Highest leverage-per-effort item.

## Backlog (documented, deliberately not built)

- **[S] PWA-lite**: manifest + standalone display for a chrome-less
  home-screen app. No service worker (offline caching fights freshness).
- **[S] Resurface starred**: when no new must clears the bar, today's card
  offers an old starred-but-unread pick ("you starred this 12 days ago").
  Uses signal already collected; very antifeed.
- **[S] Quiet read counter** in the footer ("41 reads since July").
  Lifetime count only — streaks/fire-emoji mechanics are engagement bait
  and violate the ethos.
- **[S] Nightly KV→git backup** of flags + inbox via a cron curl. Makes KV
  loss a non-event.
- **[S] Archive search/tag filter** — defer until ~100 entries; before
  that it's tweaking, not reading.
- **[M] Feedback loop v1**: brain reads flags KV before curating (skips/
  stars per source/tag as a taste snapshot in the prompt). Parked — data
  accrues for free meanwhile. Scope-creep risk: medium (invites endless
  prompt tuning).
- **[M] Notes capture**: one text field on the expanded card, stored in KV;
  brain weaves past notes into future hooks. Only if the habit has stuck
  for a month.
- **[M] Weekly digest** as a self-referential `more` entry. Cute; medium
  scope-creep risk.
- **[M] Public "what KB reads" page / RSS** from must entries. High
  scope-creep risk: hooks are written *to KB* — sharing quietly turns a
  private tool into a publication with a different audience.
- **[L] Multi-user / circles / voting** — documented so it can be declined
  quickly. Against everything in CLAUDE.md.
