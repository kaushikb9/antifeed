#!/usr/bin/env bash
# Harvest KB's X/Twitter bookmarks into candidates for antifeed curation.
#
#   ./brain/x-sweep.sh harvest              # sweep + resolve + pull article text
#   ./brain/x-sweep.sh unbookmark <file>    # remove bookmarks listed in <file>
#   ./brain/x-sweep.sh login                # open a browser to (re)authenticate
#
# Needs a logged-in X session in the browser profile at ~/.config/kb/x-profile.
# The browser work lives in brain/x-lib/browser.mjs (shared Playwright from
# ~/Code/node_modules); this script keeps the glue. See brain/x-prompt.md.
set -euo pipefail
cd "$(dirname "$0")/.."

BR="node brain/x-lib/browser.mjs"
LIB="brain/x-lib"
WORK="${X_SWEEP_WORK:-/private/tmp/antifeed-x-sweep}"
mkdir -p "$WORK"

cmd_harvest() {
  $BR sweep "$WORK/raw.jsonl"

  python3 - "$WORK/raw.jsonl" "$WORK/ids.txt" <<'PY'
import json, sys
seen = {}
for line in open(sys.argv[1]):
    line = line.strip()
    if not line:
        continue
    try:
        items = json.loads(line)
    except Exception:
        continue
    for it in items:
        if it.get("id"):
            seen.setdefault(it["id"], it)
# trailing newline matters: `while read` drops a final unterminated line
open(sys.argv[2], "w").write("\n".join(seen) + ("\n" if seen else ""))
print(f"{len(seen)} unique bookmarks")
PY

  echo "resolving via syndication API..."
  python3 "$LIB/resolve.py" "$WORK/ids.txt" "$WORK/candidates.json" site/data/articles.json

  echo "pulling X-native article text (needs login)..."
  python3 - "$WORK/candidates.json" "$WORK/article-ids.txt" <<'PY'
import json, sys
rows = json.load(open(sys.argv[1]))
ids = []
for r in rows:
    for a in r["x_articles"]:
        if a["article_id"] and a["article_id"] not in ids:
            ids.append(a["article_id"])
open(sys.argv[2], "w").write("\n".join(ids) + ("\n" if ids else ""))
print(f"{len(ids)} X-native articles")
PY

  $BR articles "$WORK/article-ids.txt" "$WORK/article-text.jsonl"

  python3 - "$WORK/candidates.json" "$WORK/article-ids.txt" "$WORK/article-text.jsonl" "$WORK/candidates.json" <<'PY'
import json, sys
rows = json.load(open(sys.argv[1]))
ids = [l.strip() for l in open(sys.argv[2]) if l.strip()]
texts = {}
for i, line in enumerate([l.strip() for l in open(sys.argv[3]) if l.strip()]):
    if i < len(ids):
        try:
            texts[ids[i]] = json.loads(line)
        except Exception:
            pass
for r in rows:
    for a in r["x_articles"]:
        t = texts.get(a["article_id"] or "")
        if t:
            a["words"] = t.get("words")
            a["read_minutes"] = round((t.get("words") or 0) / 230) or 1
            a["published"] = (t.get("published") or "")[:10]
            a["text"] = t.get("text", "")[:6000]
json.dump(rows, open(sys.argv[4], "w"), indent=1)
print("candidates written")
PY

  echo
  echo "candidates: $WORK/candidates.json"
}

cmd_unbookmark() {
  $BR unbookmark "$1"
}

case "${1:-harvest}" in
  harvest) cmd_harvest ;;
  unbookmark) cmd_unbookmark "${2:?usage: x-sweep.sh unbookmark <file-of-urls>}" ;;
  login) $BR login ;;
  *) echo "usage: x-sweep.sh [harvest|unbookmark <file>|login]"; exit 1 ;;
esac
