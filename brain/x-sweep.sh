#!/usr/bin/env bash
# Harvest KB's X/Twitter bookmarks into candidates for antifeed curation.
#
#   ./brain/x-sweep.sh harvest              # sweep + resolve + pull article text
#   ./brain/x-sweep.sh unbookmark <file>    # remove bookmarks listed in <file>
#   ./brain/x-sweep.sh login                # open a browser to (re)authenticate
#
# Needs a logged-in X session in the gstack browse browser. See brain/x-prompt.md.
set -euo pipefail
cd "$(dirname "$0")/.."

B="${GSTACK_BROWSE:-$HOME/.claude/skills/gstack/browse/dist/browse}"
LIB="brain/x-lib"
WORK="${X_SWEEP_WORK:-/private/tmp/antifeed-x-sweep}"
mkdir -p "$WORK"

[ -x "$B" ] || { echo "browse binary not found at $B — run gstack setup"; exit 1; }

# browse eval only reads files under /private/tmp or the project dir, so LIB
# (inside the repo) and WORK (under /private/tmp) are both safe.

ensure_login() {
  # The headless context loses X cookies whenever the browse server restarts.
  # `connect` attaches to the headed browser backed by the persistent profile
  # at ~/.gstack/chromium-profile, which is where a real login survives.
  $B connect >/dev/null 2>&1 || true
  $B goto "https://x.com/home" >/dev/null 2>&1 || true
  $B wait --ms 4000 >/dev/null 2>&1 || true
  local state
  state=$($B eval "$LIB/check-login.js" 2>/dev/null || echo '{}')
  case "$state" in
    *'"loggedIn":true'*) echo "X session OK" ;;
    *)
      echo "NOT LOGGED IN to X."
      echo "Run:  ./brain/x-sweep.sh login   then log in, then re-run this command."
      exit 2
      ;;
  esac
}

sweep_bookmarks() {
  local out="$1"
  : > "$out"
  $B goto "https://x.com/i/bookmarks" >/dev/null 2>&1 || true
  $B wait --ms 5000 >/dev/null 2>&1 || true
  local prev=0 dry=0 count
  for i in $(seq 1 200); do
    $B eval "$LIB/harvest.js" 2>/dev/null >> "$out" || true
    echo >> "$out"
    count=$(python3 - "$out" <<'PY'
import json, sys
ids = set()
for line in open(sys.argv[1]):
    line = line.strip()
    if not line:
        continue
    try:
        for it in json.loads(line):
            if it.get("id"):
                ids.add(it["id"])
    except Exception:
        pass
print(len(ids))
PY
)
    if [ "$count" -le "$prev" ]; then dry=$((dry + 1)); else dry=0; fi
    prev=$count
    if [ $((i % 20)) -eq 0 ]; then echo "  round $i: $count unique"; fi
    # X paginates lazily and stalls for seconds at a time; a short dry streak
    # is NOT the end of the list. 15 dry rounds at 3s is the tested floor.
    # (bare `[ x ] && break` would abort the script under `set -e` when false)
    if [ "$dry" -ge 15 ]; then break; fi
    sleep 3
  done
  echo "  swept $prev bookmarks"
}

cmd_harvest() {
  ensure_login
  echo "sweeping bookmarks..."
  sweep_bookmarks "$WORK/raw.jsonl"

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

  : > "$WORK/article-text.jsonl"
  while read -r aid; do
    if [ -z "$aid" ]; then continue; fi
    $B goto "https://x.com/i/article/$aid" >/dev/null 2>&1 || true
    $B wait --ms 3500 >/dev/null 2>&1 || true
    $B eval "$LIB/xarticle.js" 2>/dev/null | tr -d '\n' >> "$WORK/article-text.jsonl" || true
    echo >> "$WORK/article-text.jsonl"
  done < "$WORK/article-ids.txt"

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
  local list="$1"
  ensure_login
  local ok=0 fail=0
  while read -r u; do
    if [ -z "$u" ]; then continue; fi
    $B goto "$u" >/dev/null 2>&1 || true
    $B wait --ms 3000 >/dev/null 2>&1 || true
    r=$($B eval "$LIB/unbookmark.js" 2>/dev/null || echo '{}')
    case "$r" in
      *removed*|*already-not-bookmarked*) ok=$((ok + 1)) ;;
      *) fail=$((fail + 1)); echo "  FAILED: $u -> $r" ;;
    esac
    sleep 1
  done < "$list"
  echo "unbookmarked $ok, failed $fail"
  # Removing bookmarks lets X paginate deeper — older bookmarks that were never
  # rendered can appear afterwards. Always re-run harvest once after removals.
  echo "NOTE: re-run './brain/x-sweep.sh harvest' — removals can surface older bookmarks."
}

case "${1:-harvest}" in
  harvest) cmd_harvest ;;
  unbookmark) cmd_unbookmark "${2:?usage: x-sweep.sh unbookmark <file-of-urls>}" ;;
  login)
    $B connect >/dev/null 2>&1 || true
    $B goto "https://x.com/login" >/dev/null 2>&1 || true
    $B handoff "Log into X, then run: ./brain/x-sweep.sh harvest" || true
    ;;
  *) echo "usage: x-sweep.sh [harvest|unbookmark <file>|login]"; exit 1 ;;
esac
