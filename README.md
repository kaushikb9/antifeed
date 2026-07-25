# antifeed

One good read a day. No scroll, no bait.

A two-part system:

- **`site/`** — static web app (no framework, no build step). Two tabs:
  **must reads** (today's pick as a card with a hook written for me, plus the
  archive) and **more** (good-not-sacred reads for wandering). Rows expand on
  click into a "why this made the cut" panel: hook, meta chips (author,
  publish date, curation date, HN points/comments), read button — list dates
  are curation dates. Flags per article: ✓ read (dims the row, keeps it),
  ★ star (favorite / for later), ✕ skip (neutral hide-from-feed, not a
  downvote; the ✕ filter view un-skips). The whole "database" is
  `site/data/articles.json`.
- **`functions/api/flags.js`** — Cloudflare Pages Function backing flag sync
  across devices via KV, guarded by a shared token. Client falls back to
  localStorage when offline/unconfigured.
- **`brain/`** — curation brain. `curate.sh` runs headless Claude Code with
  `brain/prompt.md` + `brain/sources.md`, appends one pick to the JSON,
  commits, and deploys to Cloudflare Pages.

## Daily use

```sh
./brain/curate.sh            # pick today's article, commit, deploy
./brain/curate.sh backfill 15  # one-time: seed ~15 picks from recent weeks
```

## Deploy

```sh
npx wrangler pages deploy site --project-name=antifeed
```

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

## Deliberately not built (yet)

- Notes/reflections capture (revisit if the habit sticks)
- Upvote/downvote feedback loop into the brain (parked; ✕ skip + ★ favorites
  already carry most of the signal)
- Automated daily trigger (run it with morning coffee; launchd/GitHub Action later)
