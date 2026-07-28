#!/usr/bin/env bash
# Full X-bookmarks pipeline: harvest -> curate (headless Claude) -> commit ->
# deploy -> unbookmark whatever got ingested. Run monthly-ish.
#
#   ./brain/x-bookmarks.sh            # the whole thing
#   ./brain/x-bookmarks.sh harvest    # stop after harvesting (inspect candidates)
#
# Curation rules: brain/prompt.md + brain/x-prompt.md
set -euo pipefail
cd "$(dirname "$0")/.."

WORK="${X_SWEEP_WORK:-/private/tmp/antifeed-x-sweep}"
TODAY="$(date +%F)"
STOP_AFTER="${1:-}"

./brain/x-sweep.sh harvest
if [ "$STOP_AFTER" = "harvest" ]; then echo "candidates at $WORK/candidates.json"; exit 0; fi

CANDIDATES="$WORK/candidates.json"
[ -s "$CANDIDATES" ] || { echo "no candidates harvested — aborting"; exit 1; }

cp site/data/articles.json "$WORK/articles.before.json"

claude -p "$(cat brain/prompt.md)

---

$(cat brain/x-prompt.md)

---

X BOOKMARKS SWEEP: today is $TODAY.

Every candidate below comes from Kaushik's own X bookmarks. Curate them into
site/data/articles.json following the rules above: dedupe against the existing
file, prefer non-X canonical URLs (search HN/Algolia by title), set
\"mine\": true on every entry, and be strict about tier — at most 2-3 'must'
for the whole backlog, everything else 'more'.

Write every skipped candidate with its reason to brain/last-run.txt.

CANDIDATES:
$(cat "$CANDIDATES")" \
  --allowedTools "WebSearch,WebFetch,Read,Edit,Write,Bash(node:*),Bash(curl:*),Bash(python3:*)" \
  --permission-mode acceptEdits

node -e "JSON.parse(require('fs').readFileSync('site/data/articles.json'))" \
  || { echo 'articles.json is invalid — aborting'; cp "$WORK/articles.before.json" site/data/articles.json; exit 1; }

ADDED=$(node -e "
const before = JSON.parse(require('fs').readFileSync('$WORK/articles.before.json')).articles.length;
const after = JSON.parse(require('fs').readFileSync('site/data/articles.json')).articles.length;
console.log(after - before);
")
echo "curator added $ADDED entries"
if [ "$ADDED" -eq 0 ]; then echo "nothing added — leaving bookmarks alone"; exit 0; fi

git add site/data/articles.json
git commit -q -m "curate: X bookmarks sweep $TODAY ($ADDED articles)" || echo "nothing committed"
git push -q || echo "push failed — run 'git push' manually"
./deploy.sh || echo "deploy failed — run ./deploy.sh manually"

# Removal list is derived from what actually landed in articles.json, never
# from intent: a bookmark is cleared only if one of its candidate URLs is now
# present. One canonical article can retire several bookmarks.
node -e "
const fs = require('fs');
const rows = JSON.parse(fs.readFileSync('$CANDIDATES'));
const arts = JSON.parse(fs.readFileSync('site/data/articles.json')).articles;
const norm = (s) => (s || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/+\$/, '');
const have = new Set(arts.map((a) => norm(a.url)));
const out = [];
for (const r of rows) {
  const urls = [...r.external.map((e) => e.url), ...r.x_articles.map((a) => a.url)];
  if (urls.some((u) => have.has(norm(u)))) out.push(r.permalink);
}
fs.writeFileSync('$WORK/to-unbookmark.txt', out.join('\n') + (out.length ? '\n' : ''));
console.log('bookmarks to clear: ' + out.length);
"

if [ -s "$WORK/to-unbookmark.txt" ]; then
  ./brain/x-sweep.sh unbookmark "$WORK/to-unbookmark.txt"
fi

echo
echo "Done. Skipped candidates and reasons: brain/last-run.txt"
echo "Re-run './brain/x-bookmarks.sh harvest' — removals can surface older bookmarks."
