#!/usr/bin/env bash
# Fast path: process ONLY the manual inbox — no source sweep, cheap and quick.
# Use after adding links when you want them in the list without a full curation.
set -euo pipefail
cd "$(dirname "$0")/.."
JOB=antifeed-inbox
. brain/jobs.sh

BASE_URL="https://antifeed.pages.dev"
KB_TOKEN="$(jq -r '.token // empty' ~/.config/kb/config.json)"
[ -n "$KB_TOKEN" ] || { echo "no token in ~/.config/kb/config.json"; exit 1; }

INBOX=$(curl -sf --max-time 30 -H "Authorization: Bearer $KB_TOKEN" "$BASE_URL/api/inbox")
COUNT=$(node -e "console.log(JSON.parse(process.argv[1]).inbox.length)" "$INBOX")
if [ "$COUNT" -eq 0 ]; then
  echo "inbox is empty — nothing to do"
  exit 0
fi
echo "processing $COUNT inbox item(s)…"

# KB already chose these links, so this is grunt work: Sonnet (KB, 2026-09-27).
# Pinned: an unpinned brain inherits the interactive default and shares its limit.
BRAIN_FILES=(site/data/articles.json data/retired.json)
run_brain inbox "$(cat brain/prompt.md)

---

INBOX-ONLY MODE: today is $(date +%F). Do NOT sweep any sources. Process ONLY
the manual inbox below, per the 'Manual inbox' section: dedupe against
site/data/articles.json, research each new link, and append entries dated
$(date +%F) with \"mine\": true. Tier honestly ('must' only if truly dope).

MANUAL INBOX:
$INBOX" \
  --model sonnet --effort medium \
  --allowedTools "WebSearch,WebFetch,Read,Edit,Write,Bash(node:*),Bash(curl:*)"

# full schema check, not just JSON.parse: red → edits to brain/scratch, files restored
node brain/validate.mjs || restore_data validate site/data/articles.json data/retired.json

git add site/data/articles.json
git commit -m "inbox: $(date +%F)" || echo "nothing new committed"
tmo 90 git push -q || fail push "git push failed or timed out" "run 'git push' by hand"

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
  curl -sf -X POST -H "Authorization: Bearer $KB_TOKEN" -H "content-type: application/json" \
    -d "$REMOVE" "$BASE_URL/api/inbox" >/dev/null && echo "ingested inbox items removed"
fi

tmo 300 ./deploy.sh || fail deploy "deploy.sh failed or timed out" "run ./deploy.sh; on a 401 check cloudflare_api_token in ~/.config/kb/config.json"
job_line "ok · inbox $(date +%F) published"
