#!/usr/bin/env bash
# launchd wrapper: safe to run every hour — does nothing unless a curation
# is actually due. Installed via brain/com.kb.antifeed.plist (see README).
set -euo pipefail
# launchd has a bare PATH; claude/node/npx live here
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
cd "$(dirname "$0")/.."

# picks are a morning ritual — don't curate in the middle of the night
[ "$(date +%H)" -ge 7 ] || exit 0

# sync first — the other laptop may have curated already. --autostash: an
# uncommitted local change must not stand the curator down (a stray CLAUDE.md
# edit silently blocked every hourly run on 2026-08-06 — same failure class
# as the touchline 2026-08-02 outage). timeout + non-interactive ssh come
# from touchline's own scar: a hung fetch once blocked launchd for 33 hours.
# A pull that still fails is logged loudly, never a bare `exit 0`.
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND="ssh -oBatchMode=yes -oConnectTimeout=15"
timeout 90 git pull --rebase --autostash -q \
  || { echo "[auto] $(date '+%F %T') — pull failed/timed out, standing down this hour"; exit 0; }

# already curated today? (source of truth: the data itself, not a stamp file)
LATEST=$(node -e "const a=require('./site/data/articles.json').articles;console.log(a.map(x=>x.date).sort().pop())")
[ "$LATEST" = "$(date +%F)" ] && exit 0

# offline? try again next hour
curl -sf --max-time 10 https://antifeed.pages.dev >/dev/null || exit 0

echo "[auto] $(date '+%F %T') — curation due, running"
./brain/curate.sh daily
echo "[auto] $(date '+%F %T') — done"
