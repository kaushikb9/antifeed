# antifeed

One good read a day for Kaushik (KB). No scroll, no bait. Live at
https://antifeed.pages.dev (Cloudflare Pages, project `antifeed`).

## Why this exists

KB is an EM leading AI adoption who builds personal agent systems. Attention
is his scarce resource; antifeed replaces doomscrolling with one hand-picked
daily read plus a small pool of extras. The product principle: **read, don't
tweak systems** — resist scope creep, keep everything boring and durable.

## Architecture (deliberately primitive)

- `site/` — static app: `index.html` + `app.js` + `style.css`. No framework,
  no build step. The entire content database is `site/data/articles.json`.
- `functions/api/` — Cloudflare Pages Functions:
  - `flags.js` — per-article flags in KV (key `flags`), read-modify-write per
    toggle so devices never clobber each other. `{merge:{...}}` unions a
    device's local flags on first connect.
  - `inbox.js` — manually added links in KV (key `inbox`); POST `{url,note}`
    appends (dup-checked), `{clear:true}` empties.
  - Both auth via `x-af-token` header == `AF_TOKEN` Pages secret. The token
    also sits gitignored in `.af-token.local` for scripts, and each browser
    stores it in localStorage after the footer "connect" flow.
- `brain/` — curation, all headless Claude Code (`claude -p`):
  - `curate.sh` — daily run: sweep sources + process manual inbox, append to
    articles.json, commit, clear inbox, deploy. `backfill N` mode for bulk.
  - `inbox.sh` — cheap fast path: process ONLY the manual inbox (no source
    sweep). Use when KB just added links and wants them in the list now.
  - `prompt.md` — the curator persona, KB's profile, source priorities,
    quality bar, schema. `sources.md` — concrete source list (KB maintains
    the Substack section by hand).

## Content model (articles.json entry)

`id, date (curation date — NEVER publication), title, author, source, url,
hn_url (keep whenever a thread exists — HN comments are half the value),
published (real pub date), hn_points/hn_comments (snapshot at curation),
read_minutes, hook, evergreen, tier, tags, mine`.

- `tier: "must"` = home page, sacred, max one new per daily run;
  `"more"` = wander tab. Publication date is irrelevant to picking.
- `hook` is the product: 2–3 sentences pitched **to KB personally** (his role,
  his agents, his kbOS), never a neutral summary.
- `mine: true` = KB added it himself (via the inbox) → shows in the "mine"
  tab. Brain may also promote a mine item to tier "must" if it's truly dope.

## Client state

Flags per article: `r` read (dims, keeps), `f` star (favorite/for later),
`x` skip (neutral hide, NOT a downvote — an explicit product decision).
localStorage is the offline cache; KV is truth when sync is connected.
Voting/feedback loop is deliberately parked — skip + star already carry the
signal for a future brain-learning feature.

## Gotchas (learned the hard way)

- **Always deploy via `./deploy.sh`.** Running wrangler from a subdirectory
  silently drops the `functions/` bundle (exit 0!), and every `/api/*` route
  starts returning index.html with a 200. The script greps for "Uploading
  Functions bundle" and fails loudly.
- Pages secrets attach at deploy time — after `wrangler pages secret put`,
  redeploy before expecting the function to see it.
- The production alias (antifeed.pages.dev) lags a fresh deployment by
  ~10–30s and caches app.js; cache-bust when verifying.
- style.css is linked with a manual `?v=` param in index.html — BUMP IT on
  every CSS change, or clients pair stale CSS with fresh HTML (this broke
  the blog's theme toggle once; kb-blog now auto-hashes, antifeed is manual).
- Masthead geometry (body width/padding, wordmark size) intentionally
  mirrors kaushikbhat.com — change them in both repos or not at all.
- HN data comes from the Algolia API (`hn.algolia.com/api/v1/...`) — URL-encode
  `>` in numericFilters or you get an HTML error page.

## Deferred on purpose (don't build unless KB asks)

Notes/reflections capture · up/downvote feedback loop · automated daily
trigger (launchd / GitHub Action) · custom domain.

Work tracking: **defects and enhancements live in GitHub issues**
(`gh issue list` in kaushikb9/antifeed); `IDEAS.md` holds only future
feature ideas with effort tags and scope-creep warnings. Check both
before proposing new work.
