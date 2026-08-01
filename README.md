# antifeed

One good read a day. No scroll, no bait.

A two-part system — a static reader and a curation brain:

- **`site/`** — static web app (no framework, no build step). Three tabs:
  **must reads** (today's pick as a card with a hook written for me, plus the
  archive), **more** (good-not-sacred reads for wandering), and **mine**
  (links I add myself via the inline form — my read-it-later shelf). Rows
  expand (one at a time) into a "why this made the cut" mini-card matching
  the daily card's design: hook, author, publish + curation dates, HN
  points/comments, read button. List dates are curation dates. Flags per
  article: ✓ read (dims the row, keeps it), ★ star (favorite / for later),
  ✕ skip (neutral hide-from-feed, not a downvote; the ✕ filter view
  un-skips). The whole "database" is `site/data/articles.json`.
- **`functions/api/`** — Cloudflare Pages Functions: `flags.js` (cross-device
  flag sync) and `inbox.js` (manually added links), both in KV behind a
  shared token. The client falls back to localStorage when offline.
- **`brain/`** — curation brain, headless Claude Code driven by
  `brain/prompt.md` + `brain/sources.md`. Appends picks to the JSON,
  commits, clears the inbox, deploys.

See `CLAUDE.md` for the full architecture notes, content-model rules, and
hard-won gotchas; `IDEAS.md` for the backlog.

## Daily use

Curation runs itself: a launchd agent fires `brain/auto.sh` hourly while the
laptop is awake and no-ops unless today's pick is missing (so a shut laptop
just means it runs on next open, after 7am). Install once — first replace
`/Users/YOURNAME` in the plist with your repo's absolute path (launchd
doesn't expand `~`), then:

```sh
cp brain/com.kb.antifeed.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kb.antifeed.plist
```

Logs land in `brain/auto.log` (gitignored). Manual runs still work anytime:

```sh
./brain/curate.sh              # daily: sweep sources + inbox, commit, deploy
./brain/inbox.sh               # fast: process ONLY manually added links
./brain/curate.sh backfill 15  # one-time: seed ~15 picks from recent weeks
```

Links added via the **mine** tab's form land in the KV inbox, appear
immediately as "awaiting the brain", and become full entries (`mine: true`,
staying in the mine tab — or promoted to the home page if truly dope) on the
next brain run.

## Clipping from anywhere

Two capture paths besides the mine-tab form, both feeding the same inbox:

- **Desktop bookmarklet** — drag the "+antifeed" link (mine tab, under the
  form) to the bookmarks bar. Clicking it on any page opens
  `antifeed.pages.dev/?add=<url>&t=<title>` in a new tab (`#add=` also
  still works, for bookmarklets dragged before the query switch); the app
  posts it to the inbox using the sync token already in that browser's
  localStorage (so no token ever lives in the bookmarklet) and lands on
  the mine tab with the pending row visible. If that browser context has
  no token yet (bookmarks sync across profiles and machines; localStorage
  doesn't), it prompts for the sync token inline and completes the clip.
- **iOS share sheet** — build once in Shortcuts (~3 min, needs the token):
  1. New shortcut → name it "Save to antifeed" → shortcut settings →
     enable **Show in Share Sheet**, accept **URLs** and **Safari web pages**.
  2. Add **Get Contents of URL**: URL `https://antifeed.pages.dev/api/inbox`,
     Method **POST**, Header `x-af-token` = the sync token,
     Request Body **JSON** with one field: `url` = **Shortcut Input**.
  3. (Optional) Add **Show Notification** ("saved to antifeed").
  Then any app's share sheet → Save to antifeed.

## Deploy

```sh
./deploy.sh   # always use this — it verifies the Functions bundle shipped
```

(Deploying with raw wrangler from a subdirectory silently omits `functions/`
and breaks `/api/*` — the script guards against that.)

First time:

1. `npx wrangler login`
2. `cp wrangler.toml.example wrangler.toml` (`wrangler.toml` is gitignored —
   it stays on your machine), then
   `npx wrangler kv namespace create ANTIFEED_KV` → paste the id into
   `wrangler.toml`
3. Deploy once (creates the project), then set the sync token:
   `npx wrangler pages secret put AF_TOKEN --project-name antifeed`
   (pick any long random string)
4. On each device, tap "sync off — connect" in the footer and enter that token.
   First connect merges the device's local flags into KV.

Custom domain (e.g. `antifeed.kaushikbhat.com`) is added in the Cloudflare
dashboard under the Pages project → Custom domains.

Local dev with the sync API: `npx wrangler pages dev` (token `dev-token`
via `.dev.vars`, KV simulated locally).

## Sources

HN (primary, with the comment thread always linked), my Substack follows
(`brain/sources.md` — keep it updated), frontier AI company blogs, and
AI-first product companies' engineering blogs. Evergreen classics welcome.

### X/Twitter bookmarks (monthly-ish)

```bash
./brain/x-bookmarks.sh            # harvest -> curate -> commit -> deploy -> unbookmark
./brain/x-bookmarks.sh harvest    # stop after harvesting, to eyeball candidates first
./brain/x-sweep.sh login          # when it says NOT LOGGED IN (only I can do this)
```

Scrapes my bookmarks in a logged-in browser and expands each one via X's public
syndication endpoint — no developer-tier API, and no, a Grok subscription would
not help. Entries land with `mine: true`; only bookmarks whose content actually
made it into `articles.json` get cleared, and every skip is written to
`brain/last-run.txt` with a reason so I can clear the rest by hand.

Rules and the gotchas that cost an afternoon (auth, lazy pagination, links
hiding in quoted tweets) are in `brain/x-prompt.md`. Read it first.

## Second-machine setup (KB's other laptop)

Agent-followable. Goal: this machine can run the daily curation and deploy,
coordinating with the other laptop via git (auto.sh pulls before deciding,
brain scripts push after committing — no duplicate picks).

1. Verify prereqs, install what's missing: `claude` CLI (logged in — check
   `claude --version`), `node`/`npx`, `gh` (authenticated — `gh auth status`).
2. Clone if not already here:
   `gh repo clone kaushikb9/antifeed ~/Code/antifeed`
3. In the repo: `git config user.email kaushikb9@users.noreply.github.com`
   (MANDATORY — global config has a personal email that must not enter
   this repo's history).
4. Cloudflare auth: `npx wrangler login` (interactive — ask KB to run it),
   then verify with `npx wrangler whoami`. Create the local config:
   `cp wrangler.toml.example wrangler.toml`, then paste the existing KV id
   from `npx wrangler kv namespace list` (wrangler.toml is gitignored).
5. Sync token: `.af-token.local` at repo root is gitignored and cannot be
   recovered from Cloudflare. Ask KB to copy it from the other laptop
   (AirDrop/scp). Verify:
   `curl -sf -H "x-af-token: $(cat .af-token.local)" https://antifeed.pages.dev/api/flags`
   → must return JSON, not "unauthorized".
6. Install the auto-curation agent. First replace `/Users/YOURNAME` inside
   `brain/com.kb.antifeed.plist` with this repo's absolute path. Then:
   `cp brain/com.kb.antifeed.plist ~/Library/LaunchAgents/`
   `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kb.antifeed.plist`
7. Verify: `bash brain/auto.sh` exits 0 silently when today's pick already
   exists (check `site/data/articles.json` max date), and
   `launchctl print gui/$(id -u)/com.kb.antifeed | grep "last exit"` shows 0.

Steps 4 and 5 need KB personally (interactive login, secret file) — an agent
should do everything else and ask for exactly those two.

## Make it yours (fork guide)

antifeed is deliberately single-tenant — the curation is the product, and
it's aimed at one person. To run it for yourself:

1. Fork this repo.
2. Rewrite the "Who you're curating for" section of `brain/prompt.md` for
   YOUR role and interests, and put your sources in `brain/sources.md`.
3. `npx wrangler login`, then `cp wrangler.toml.example wrangler.toml` and
   `npx wrangler kv namespace create ANTIFEED_KV` → paste the id into
   `wrangler.toml` (gitignored — your infra ids stay local).
4. Deploy once (`./deploy.sh` creates the Pages project), then set your
   sync token: `npx wrangler pages secret put AF_TOKEN --project-name antifeed`
   (any long random string; also save it to `.af-token.local` — gitignored —
   so the brain scripts can reach your inbox). Update `BASE_URL` in
   `brain/*.sh` to your pages.dev URL.
5. Seed your backlog: `./brain/curate.sh backfill 15`. Then daily:
   `./brain/curate.sh`. Requires [Claude Code](https://claude.com/claude-code).
6. On each device, tap "sync off — connect" in the footer, paste your token.

Total setup: ~30 minutes. Your picks, your hooks, your flags.

## Deliberately not built (yet)

- Notes/reflections capture (revisit if the habit sticks)
- Upvote/downvote feedback loop into the brain (parked; ✕ skip + ★ favorites
  already carry most of the signal)
- Automated daily trigger (run it with morning coffee; launchd/GitHub Action later)

## License

MIT — see [LICENSE](LICENSE).
