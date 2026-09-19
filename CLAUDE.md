# antifeed

One good read a day for KB. A static reader (`site/`, no framework, no build)
plus a curation brain (`brain/`, headless Claude Code) that appends at most
one pick a day to `site/data/articles.json`, then commits, pushes and deploys
by itself. `AGENTS.md` is a symlink to this file.

**Hard boundaries.** The brain writes `articles.json` and `retired.json` and
nothing else. Curation is the product and it is aimed at one person: nothing
new is a valid daily outcome. The reader is *read, don't tweak systems*.
`/usage/` is unlisted on purpose and stays out of nav, footer and sitemap.

`README.md` is the full architecture: content model, the 2026-09-06 budget
rules, the THIS MONTH block, clipping paths, `/usage/`, second-machine setup.
Read it before changing anything in `brain/` or `functions/`. Design language:
`~/Code/brain/design-system/INVARIANTS.md`.

**Auth.** `auth/` is kb-auth, vendored byte-for-byte from `~/Code/brain/auth/`
(`auth/README.md` is the contract; `~/Code/check-all.sh` fails on drift —
edit there, copy here). The reader is public; `functions/_middleware.js`
gates only `/api/flags`, `/api/inbox` and `/api/pair` (`/api/telemetry`
decides for itself so strangers can POST). One secret, `KB_TOKEN`, shared
with kaizen and brain: browsers pair once by link (`npm run pair`), scripts
send it as Bearer from `~/.config/kb/config.json`. No token file in the repo.
The reader shows nothing about pairing or sync (KB, 2026-09-19: not even
that the option exists); a paired device syncs silently. The only place
pairing state appears is the unpaired empty state of `/usage/`.

## Run · verify · deploy

```sh
npm run dev                       # local reader + sync API (KB_TOKEN=devtoken; pair with node auth/pair.mjs http://localhost:8788)
./check.sh                        # ~1s, no network: 20 tests across the three seams
DRY=1 ./brain/curate.sh           # a real brain run with nothing committed or deployed
./brain/curate.sh                 # daily: curate, validate, commit, push, clear inbox, deploy
./deploy.sh                       # deploy alone — runs ./check.sh first, refuses on red
```

`./check.sh` is `node --test tests/*.test.mjs`: **data** (`tests/data.test.mjs`,
both JSON files against `brain/schema.json`), **API** (`tests/api.test.mjs`,
`flags.js` and `inbox.js` against a stubbed KV, no wrangler), **renderer**
(`tests/app.test.mjs`, `site/app.js` draws the schema's vocabulary; everything
that ships parses). It gates `deploy.sh` (`SKIP_CHECK=1` only when the deploy
*is* the fix) and `curate.sh`, which after the brain writes runs
`node brain/validate.mjs` and on red commits nothing, deploys nothing, and says
so in `brain/auto.log`.

The daily job is launchd `com.kb.antifeed` → `brain/auto.sh`, hourly while
awake, no-op once today's pick exists. It **auto-commits and auto-deploys**,
so anything committed here ships on the next run. `curate.sh` stages only
`site/data/articles.json`, `data/retired.json` and `data/snapshot` by name.

## One schema, four consumers

`brain/schema.json` is the only description of an entry, the tiers and the
flag keys. `brain/prompt.md` cites it (what the brain writes),
`brain/validate.mjs` enforces it, `functions/api/flags.js` imports it (the API
stores no key it does not list), and `tests/app.test.mjs` holds `site/app.js`
to it. Change the schema file; the tests tell you which consumer disagrees.

## kaizen writes flags here (2026-09-06)

kaizen (`~/Code/kaizen`, `functions/api/pick.js`) shows each day's must-read
from `data/articles.json` and toggles its `f` / `r` / `x` flags through
`/api/flags` with the shared `KB_TOKEN` as Bearer, one `{id, key, value}` at a time. It is
the one external writer. Changing the flag keys, the POST shape, the
`must` tier name, or the public file's `date`/`tier` fields breaks it —
change both repos in the same sitting.

## Deferred — don't build unless asked

The canonical list is README.md → "Deliberately not built (yet)"; wishlist
items with sizes are in `IDEAS.md`; defects live in GitHub issues. Two
standing no's beyond those: antifeed stays on pages.dev, not a
kaushik.sh subdomain (it may be spun out), and no upvote/downvote —
★ and ✕ already reach the brain through the THIS MONTH block.

## Learned the hard way

The full list, with dates, is README.md. The four that decide how you work
here:

- **Always `./deploy.sh`**, never raw wrangler from a subdirectory — it drops
  `functions/` and kills `/api/*` silently.
- **Count readers, not opens.** The first `/usage/` page reported 200%.
- **Hooks are under 40 words**, enforced on live entries since 2026-09-10;
  retired entries keep their original hooks as the record. One `mine` entry
  (`2026-08-05-3b1b-neural-networks`) was retired in the 09-06 cut against the
  rule; the validator enforces it from 09-10 and that entry is KB's call.
- **`git config user.email kaushikb9@users.noreply.github.com`** in this repo on
  any new machine. (2026-09-10: this file replaced a three-hop chain
  `AGENTS.md → CLAUDE.md → README` on the one repo that deploys unattended.)
