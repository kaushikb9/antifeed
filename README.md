# antifeed

One good read a day. No scroll, no bait.

A two-part system:

- **`site/`** — static web app (no framework, no build step). Today's pick as a
  card with a hook written for me, archive below, bookmark / favorite / share
  flags in `localStorage`, copy-share-list-as-markdown. The whole "database" is
  `site/data/articles.json`.
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

First time: `npx wrangler login`, then create the project when prompted.
Custom domain (e.g. `antifeed.kaushikbhat.com`) is added in the Cloudflare
dashboard under the Pages project → Custom domains.

## Sources

HN (primary, with the comment thread always linked), my Substack follows
(`brain/sources.md` — keep it updated), frontier AI company blogs, and
AI-first product companies' engineering blogs. Evergreen classics welcome.

## Deliberately not built (yet)

- Notes/reflections capture (needs a backend; revisit if the habit sticks)
- Cross-device sync of flags (localStorage is per-browser)
- Automated daily trigger (run it with morning coffee; launchd/GitHub Action later)
