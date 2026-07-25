#!/usr/bin/env bash
# Fast path: process ONLY the manual inbox — no source sweep, cheap and quick.
# Use after adding links when you want them in the list without a full curation.
set -euo pipefail
cd "$(dirname "$0")/.."

BASE_URL="https://antifeed.pages.dev"
AF_TOKEN="$(cat .af-token.local)"

INBOX=$(curl -sf -H "x-af-token: $AF_TOKEN" "$BASE_URL/api/inbox")
COUNT=$(node -e "console.log(JSON.parse(process.argv[1]).inbox.length)" "$INBOX")
if [ "$COUNT" -eq 0 ]; then
  echo "inbox is empty — nothing to do"
  exit 0
fi
echo "processing $COUNT inbox item(s)…"

claude -p "$(cat brain/prompt.md)

---

INBOX-ONLY MODE: today is $(date +%F). Do NOT sweep any sources. Process ONLY
the manual inbox below, per the 'Manual inbox' section: dedupe against
site/data/articles.json, research each new link, and append entries dated
$(date +%F) with \"mine\": true. Tier honestly ('must' only if truly dope).

MANUAL INBOX:
$INBOX" \
  --allowedTools "WebSearch,WebFetch,Read,Edit,Write,Bash(node:*),Bash(curl:*)" \
  --permission-mode acceptEdits

node -e "JSON.parse(require('fs').readFileSync('site/data/articles.json'))" \
  || { echo 'articles.json is invalid — aborting'; exit 1; }

git add site/data/articles.json
git commit -m "inbox: $(date +%F)" || echo "nothing new committed"

curl -sf -X POST -H "x-af-token: $AF_TOKEN" -H "content-type: application/json" \
  -d '{"clear":true}' "$BASE_URL/api/inbox" >/dev/null && echo "inbox cleared"

./deploy.sh || echo "deploy failed — run ./deploy.sh manually"
