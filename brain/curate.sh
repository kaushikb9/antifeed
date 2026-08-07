#!/usr/bin/env bash
# antifeed brain — run daily (or `./brain/curate.sh backfill 15` once).
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-daily}"
COUNT="${2:-15}"
TODAY="$(date +%F)"
BASE_URL="https://antifeed.pages.dev"
AF_TOKEN="$(cat .af-token.local 2>/dev/null || true)"

INBOX='{"inbox":[]}'
if [ -n "$AF_TOKEN" ]; then
  INBOX=$(curl -sf -H "x-af-token: $AF_TOKEN" "$BASE_URL/api/inbox" || echo '{"inbox":[]}')
fi

if [ "$MODE" = "backfill" ]; then
  TASK="BACKFILL MODE: today is $TODAY. Curate the $COUNT best articles from roughly the last 4-6 weeks across the sources, plus 2-3 evergreen classics. Spread their 'date' fields plausibly across recent weeks. Tier them honestly: roughly a third 'must', the rest 'more'. Quality over quota — if only 10 clear the bar, add 10."
else
  TASK="DAILY MODE: today is $TODAY. Append exactly ONE tier='must' article dated $TODAY (publication date irrelevant — if nothing new clears the bar, promote an evergreen classic; never lower the bar). Optionally add 0-3 tier='more' entries, same date."
fi

claude -p "$(cat brain/prompt.md)

---

$TASK

MANUAL INBOX (process every item per the 'Manual inbox' section of the rules):
$INBOX" \
  --allowedTools "WebSearch,WebFetch,Read,Edit,Write,Bash(node:*),Bash(curl:*)" \
  --permission-mode acceptEdits

# validate before publishing
node -e "JSON.parse(require('fs').readFileSync('site/data/articles.json'))" \
  || { echo 'articles.json is invalid — aborting'; exit 1; }

git add site/data/articles.json
git commit -m "curate: $MODE $TODAY" || echo "nothing new committed"
git push -q || echo "push failed — run 'git push' manually"

# remove ONLY snapshot inbox items that made it into articles.json —
# skipped links and anything added mid-run stay in the inbox
if [ -n "$AF_TOKEN" ] && [ "$INBOX" != '{"inbox":[]}' ]; then
  REMOVE=$(INBOX_JSON="$INBOX" node -e '
    const inbox = JSON.parse(process.env.INBOX_JSON).inbox;
    const arts = JSON.parse(require("fs").readFileSync("site/data/articles.json")).articles;
    const norm = (s) => s.replace(/\/+$/, "");
    // inbox_url catches entries whose URL the brain rewrote (bare channel
    // link resolved to the real page, shortener followed, canonical swap)
    const have = new Set(arts.flatMap((a) =>
      [a.url, a.inbox_url].filter(Boolean).map(norm)));
    const done = inbox.filter((i) => have.has(norm(i.url))).map((i) => i.url);
    const left = inbox.filter((i) => !have.has(norm(i.url))).map((i) => i.url);
    if (left.length) console.error("still in inbox (not ingested): " + left.join(", "));
    console.log(JSON.stringify({ remove: done }));
  ')
  if [ "$REMOVE" != '{"remove":[]}' ]; then
    curl -sf -X POST -H "x-af-token: $AF_TOKEN" -H "content-type: application/json" \
      -d "$REMOVE" "$BASE_URL/api/inbox" >/dev/null \
      && echo "ingested inbox items removed" || echo "warning: could not update inbox"
  fi
fi

# snapshot flags + inbox to git — the only copy of the read/star/skip record
# off Cloudflare. Never allowed to fail the run.
if node brain/snapshot.mjs; then
  if [ -n "$(git status --porcelain -- data/snapshot)" ]; then
    git add data/snapshot
    git commit -q -m "snapshot: $TODAY" || true
    git push -q || echo "push failed — run 'git push' manually"
  fi
else
  echo "snapshot failed — run continues"
fi

./deploy.sh || echo "deploy failed — run ./deploy.sh manually"
