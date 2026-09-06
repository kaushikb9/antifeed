#!/usr/bin/env bash
# antifeed brain — run daily (or `./brain/curate.sh backfill 15` once).
#   DRY=1 ./brain/curate.sh   # run the brain, touch nothing else: no commit,
#                             # push, inbox clear, snapshot or deploy
set -euo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-daily}"
COUNT="${2:-15}"
TODAY="$(date +%F)"
BASE_URL="https://antifeed.pages.dev"
AF_TOKEN="$(cat .af-token.local 2>/dev/null || true)"
DRY="${DRY:-}"

INBOX='{"inbox":[]}'
if [ -n "$AF_TOKEN" ]; then
  INBOX=$(curl -sf -H "x-af-token: $AF_TOKEN" "$BASE_URL/api/inbox" || echo '{"inbox":[]}')
fi

# THIS MONTH — the two signals the brain cannot reach from inside its sandbox
# (it can only read this repo): what KB is working on, from kaizen's own
# task snapshot next door (tags only, never the task text), and what he has
# starred / read / skipped here. Both are optional; a missing file yields an
# empty section, never a failed run.
THIS_MONTH=$(node -e '
  const fs = require("fs");
  const out = [];
  try {
    const p = "../kaizen/data/snapshot/todos.json";
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const items = Array.isArray(j) ? j : (j.todos || j.items || []);
    // tags are mapped to plain domain words; anything unmapped (an internal
    // programme, a product name, a personal tag) never leaves this machine
    const DOMAIN = {
      slash: "internal coding-agent rollout", devex: "developer experience and productivity",
      cost: "inference cost and model routing", team: "team leadership", "org-design": "org design",
      "discover-rkg": "enterprise knowledge graph / RAG", hiring: "hiring", harness: "agent harness design",
      "agent-studio": "internal agent platform", "ai-perf": "measuring AI leverage per engineer",
      partnerships: "model-provider partnerships", data: "engineering metrics data",
      writing: "writing", "ai-stack": "AI stack strategy", "side-project": "side projects",
    };
    const n = {};
    for (const t of items) if (!t.done) for (const g of (t.tags || [])) {
      const d = DOMAIN[g]; if (d) n[d] = (n[d] || 0) + 1;
    }
    const top = Object.entries(n).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([g, c]) => `${g} (${c})`).join(", ");
    if (top) out.push("Open-task domains this month, most frequent first: " + top + ".");
  } catch {}
  try {
    const flags = JSON.parse(fs.readFileSync("data/snapshot/flags.json", "utf8"));
    const arts = JSON.parse(fs.readFileSync("site/data/articles.json", "utf8")).articles;
    const by = Object.fromEntries(arts.map((a) => [a.id, a]));
    const list = (k) => Object.entries(flags)
      .filter(([id, v]) => v[k] && by[id]).map(([id]) => `"${by[id].title}"`);
    const s = list("f"), r = list("r"), x = list("x");
    if (s.length) out.push("Starred: " + s.join("; ") + ".");
    if (r.length) out.push("Read: " + r.join("; ") + ".");
    if (x.length) out.push("Skipped: " + x.join("; ") + ".");
  } catch {}
  console.log(out.join("\n") || "(no signal available this run)");
')

if [ "$MODE" = "backfill" ]; then
  TASK="BACKFILL MODE: today is $TODAY. Curate the $COUNT best articles from roughly the last 4-6 weeks across the sources, plus 2-3 evergreen classics. Spread their 'date' fields plausibly across recent weeks. Tier them honestly: roughly a third 'must', the rest 'more'. Quality over quota — if only 10 clear the bar, add 10."
else
  TASK="DAILY MODE: today is $TODAY. Budget: at most ONE tier='must' entry dated $TODAY, at most ONE tier='more' (default zero). If nothing clears the bar, add nothing and resurface one existing unread entry instead (set 'resurfaced' to $TODAY). Retire any existing entry that today's pick supersedes, per the rules."
fi

caffeinate -i claude -p "$(cat brain/prompt.md)

---

$TASK

THIS MONTH (weight the search with this; never narrow to it):
$THIS_MONTH

MANUAL INBOX (process every item per the 'Manual inbox' section of the rules):
$INBOX" \
  --allowedTools "WebSearch,WebFetch,Read,Edit,Write,Bash(node:*),Bash(curl:*)" \
  --strict-mcp-config \
  --permission-mode acceptEdits

# validate before publishing
node -e "JSON.parse(require('fs').readFileSync('site/data/articles.json'));JSON.parse(require('fs').readFileSync('data/retired.json'))" \
  || { echo 'articles.json or retired.json is invalid — aborting'; exit 1; }

if [ -n "$DRY" ]; then
  echo "DRY run — brain output left uncommitted:"
  git --no-pager diff --stat -- site/data/articles.json data/retired.json
  exit 0
fi

git add site/data/articles.json data/retired.json
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
