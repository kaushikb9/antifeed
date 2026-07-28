# antifeed — X bookmarks sweep

Monthly-ish job: turn Kaushik's X/Twitter bookmark backlog into antifeed entries,
then clear the bookmarks that were ingested.

Read `brain/prompt.md` first — the curator persona, KB's profile, the quality bar
and the entry schema all apply unchanged. This file only covers what is different
about bookmarks as a source.

## Why there is no API

X's Bookmarks endpoint lives behind the paid developer tier (~$200/mo). A Grok /
X Premium subscription does **not** help: Grok is a chatbot in the X app, it has
no access to your account's bookmarks, and the xAI API doesn't expose them either.
The official "download your data" archive omits bookmarks entirely. So the sweep
is a logged-in browser scrape plus X's public syndication endpoint. Don't go
shopping for a subscription to fix this.

## Auth (the part that bites)

- KB's login does **not** live in Chrome — `cookie-import-browser` finds no
  x.com cookies there, and decrypting the gstack Chromium profile fails because
  there is no "Chromium Safe Storage" Keychain entry to derive the key from.
- The working path is `browse connect`, which attaches to the **headed** browser
  backed by the persistent profile at `~/.gstack/chromium-profile`. A real login
  performed there survives across runs.
- The **headless** browse context loses X cookies whenever the browse server
  restarts, which `browse resume` triggers. If a sweep suddenly starts returning
  login pages, that's what happened — re-run `x-sweep.sh login`.

## Harvesting gotchas

- The bookmarks list is virtualised: only ~10 tweets exist in the DOM at a time,
  so harvesting means scroll-and-collect in a loop, not one big query.
- **X paginates lazily and stalls.** A short dry streak is not the end of the
  list — the first run of this job stopped at 60 bookmarks and the real number
  was 98. Require ~15 consecutive dry rounds at 3s before declaring exhaustion,
  and confirm with `scroll-state.js` (`atBottom: true`, no spinner).
- **Removing bookmarks unlocks deeper pages.** After unbookmarking, re-run the
  harvest at least once; older bookmarks that were never rendered will appear.
  Keep going until a full sweep surfaces zero never-seen ids.
- Most article bookmarks are **quote-tweets** whose link lives in the quoted
  tweet, so link extraction must recurse (resolve.py handles this).
- Many are **X-native articles** (`x.com/i/article/<id>`), which are login-walled
  and invisible to any external fetcher. Their text comes from the logged-in
  session; their canonical URL is `x.com/<author>/article/<tweet_id>`.

## Curation rules specific to this source

- Always check for a **non-X canonical version** before settling for an x.com
  URL. Search HN/Algolia by title: the "Why Software Factories Fail" X article
  turned out to exist as a HumanLayer GitHub markdown file with a 390-point HN
  thread, which is a strictly better entry (readable without login, comments
  included). X URLs are a fallback, not the default.
- One canonical piece can back **several bookmarks** (a multi-part series
  published as one document; a piece three different people quote-tweeted).
  Add one entry, and unbookmark every tweet that pointed at it.
- Repeat bookmarks are the strongest taste signal available — if KB saved the
  same piece three times via three different people, say so in the hook.
- Dedupe against `articles.json` by normalised URL (strip scheme, `www.`,
  trailing slash) **and** by id before appending.
- `mine: true` on every entry — these are KB's own finds, so they belong in the
  "mine" tab.
- Tier discipline still applies and matters more here, because a bulk sweep can
  flood the home page. `mine: true` + `tier: "must"` shows on the home page;
  `mine: true` + `tier: "more"` shows **only** in the mine tab. Default to
  `more`. Two or three `must` picks for a whole month's backlog is plenty.
- Weave the sharer into the hook — "José Valim's 'stop whatever you are doing'",
  "Mitchell Hashimoto called him a fine writer". That provenance is why the
  bookmark exists and it makes the pitch concrete.

## What to skip (and leave bookmarked)

KB clears the rest by hand, so skipping is cheap and being precious is expensive.
Skip: videos and podcasts (antifeed is a reading app), repos and PRs, product
docs, paywalled posts, dead links, corporate announcement pages, listicles,
self-help without real substance, and X drama or in-jokes. Anything already in
`articles.json` is a skip too — note it as a duplicate so KB can clear it.

Write every skip with its reason to `brain/last-run.txt`. That file is the report
KB reads to decide what to clear manually.

## Unbookmarking

**Never take the first `article[data-testid="tweet"]` on a status page.** If the
target tweet is a *reply*, X renders the whole conversation and the PARENT tweet
comes first in the DOM — clicking its bookmark button clears the wrong bookmark.
This happened for real: culling a Dr. Gurner reply removed the Tim Ferriss post
it replied to, and left the Gurner one in place. `unbookmark.js` now selects the
article whose own permalink matches the URL and returns `WRONG-TWEET` if it
hasn't rendered yet; treat that as wait-and-retry, never as a skip.

The same trap applies to *reading* bookmark state — a read-only checker that
grabs the first article will confidently report the wrong answer. When in doubt,
enumerate the bookmarks list itself: it is the only ground truth.

Only unbookmark a tweet whose content actually landed in `articles.json`. Build
the removal list by matching candidate URLs against the file **after** curation,
never from intent beforehand. `x-sweep.sh unbookmark <file>` takes one URL per
line and reports failures rather than swallowing them.
