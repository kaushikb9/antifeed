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

# inbox items are now in articles.json (or rejected as dupes) — clear it
if [ -n "$AF_TOKEN" ] && [ "$INBOX" != '{"inbox":[]}' ]; then
  curl -sf -X POST -H "x-af-token: $AF_TOKEN" -H "content-type: application/json" \
    -d '{"clear":true}' "$BASE_URL/api/inbox" >/dev/null \
    && echo "inbox cleared" || echo "warning: could not clear inbox"
fi

./deploy.sh || echo "deploy failed — run ./deploy.sh manually"
