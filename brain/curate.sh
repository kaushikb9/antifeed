#!/usr/bin/env bash
# antifeed brain — run daily (or `./brain/curate.sh backfill 15` once).
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-daily}"
COUNT="${2:-15}"
TODAY="$(date +%F)"

if [ "$MODE" = "backfill" ]; then
  TASK="BACKFILL MODE: today is $TODAY. Curate the $COUNT best articles from roughly the last 4-6 weeks across the sources, plus 2-3 evergreen classics. Spread their 'date' fields plausibly across recent weeks (evergreens get the date you add them). Quality over quota — if only 10 clear the bar, add 10."
else
  TASK="DAILY MODE: today is $TODAY. Pick exactly ONE article and append it with date $TODAY. If nothing new clears the bar today, pick an evergreen classic instead — never lower the bar."
fi

claude -p "$(cat brain/prompt.md)

---

$TASK" \
  --allowedTools "WebSearch,WebFetch,Read,Edit,Write,Bash(node:*),Bash(curl:*)" \
  --permission-mode acceptEdits

# validate before publishing
node -e "JSON.parse(require('fs').readFileSync('site/data/articles.json'))" \
  || { echo 'articles.json is invalid — aborting'; exit 1; }

git add site/data/articles.json
git commit -m "curate: $MODE $TODAY" || echo "nothing new committed"

npx wrangler pages deploy site --project-name=antifeed --commit-dirty=true \
  || echo "deploy failed — run 'npx wrangler pages deploy site --project-name=antifeed' manually"
