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
JOB=antifeed-x-bookmarks
. brain/jobs.sh

WORK="${X_SWEEP_WORK:-/private/tmp/antifeed-x-sweep}"
TODAY="$(date +%F)"
STOP_AFTER="${1:-}"

./brain/x-sweep.sh harvest
if [ "$STOP_AFTER" = "harvest" ]; then echo "candidates at $WORK/candidates.json"; exit 0; fi

CANDIDATES="$WORK/candidates.json"
[ -s "$CANDIDATES" ] || { echo "no candidates harvested — aborting"; exit 1; }

cp site/data/articles.json "$WORK/articles.before.json"

# Heavy work (judgement and writing) runs Opus at low effort (KB, 2026-09-27).
# Pinned: an unpinned brain inherits the interactive default and shares its limit.
BRAIN_FILES=(site/data/articles.json data/retired.json)
run_brain x-bookmarks "$(cat brain/prompt.md)

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
  --model claude-opus-5-5 --effort low \
  --allowedTools "WebSearch,WebFetch,Read,Edit,Write,Bash(node:*),Bash(curl:*),Bash(python3:*)"

# full schema check, not just JSON.parse: red → edits to brain/scratch, files restored
node brain/validate.mjs || restore_data validate site/data/articles.json data/retired.json

ADDED=$(node -e "
const before = JSON.parse(require('fs').readFileSync('$WORK/articles.before.json')).articles.length;
const after = JSON.parse(require('fs').readFileSync('site/data/articles.json')).articles.length;
console.log(after - before);
")
echo "curator added $ADDED entries"
if [ "$ADDED" -eq 0 ]; then echo "nothing added — leaving bookmarks alone"; exit 0; fi

git add site/data/articles.json
git commit -q -m "curate: X bookmarks sweep $TODAY ($ADDED articles)" || echo "nothing committed"
tmo 90 git push -q || fail push "git push failed or timed out" "run 'git push' by hand"
tmo 300 ./deploy.sh || fail deploy "deploy.sh failed or timed out" "run ./deploy.sh; on a 401 check cloudflare_api_token in ~/.config/kb/config.json"

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

job_line "ok · X sweep $TODAY published ($ADDED added)"
