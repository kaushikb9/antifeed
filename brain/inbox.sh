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
git push -q || echo "push failed — run 'git push' manually"

# remove ONLY snapshot inbox items that made it into articles.json —
# skipped links and anything added mid-run stay in the inbox
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
    -d "$REMOVE" "$BASE_URL/api/inbox" >/dev/null && echo "ingested inbox items removed"
fi

./deploy.sh || echo "deploy failed — run ./deploy.sh manually"
