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

```sh
./brain/curate.sh              # daily: sweep sources + inbox, commit, deploy
./brain/inbox.sh               # fast: process ONLY manually added links
./brain/curate.sh backfill 15  # one-time: seed ~15 picks from recent weeks
```

Links added via the **mine** tab's form land in the KV inbox, appear
immediately as "awaiting the brain", and become full entries (`mine: true`,
staying in the mine tab — or promoted to the home page if truly dope) on the
next brain run.

## Deploy

```sh
./deploy.sh   # always use this — it verifies the Functions bundle shipped
```

(Deploying with raw wrangler from a subdirectory silently omits `functions/`
and breaks `/api/*` — the script guards against that.)

First time:

1. `npx wrangler login`
2. `npx wrangler kv namespace create ANTIFEED_KV` → paste the id into
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

## Make it yours (fork guide)

antifeed is deliberately single-tenant — the curation is the product, and
it's aimed at one person. To run it for yourself:

1. Fork this repo.
2. Rewrite the "Who you're curating for" section of `brain/prompt.md` for
   YOUR role and interests, and put your sources in `brain/sources.md`.
3. `npx wrangler login`, then:
   `npx wrangler kv namespace create ANTIFEED_KV` → paste the id into
   `wrangler.toml`.
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
