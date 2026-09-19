#!/usr/bin/env bash
# Deploy antifeed. Always run wrangler from the repo root — deploying from a
# subdirectory silently drops the functions/ bundle and kills the /api/* routes.
set -euo pipefail
cd "$(dirname "$0")"

# Never ship red. ./check.sh is ~1s and offline; SKIP_CHECK=1 only when you
# are deploying a fix for the check itself and say so in the commit.
if [ "${SKIP_CHECK:-}" != "1" ]; then
  ./check.sh >/dev/null 2>&1 || { ./check.sh 2>&1 | grep -E "^✖|Error|not ok" | head -20; echo "ERROR: ./check.sh failed — refusing to deploy. Fix it, or SKIP_CHECK=1 if the deploy IS the fix."; exit 1; }
fi

[ -f wrangler.toml ] \
  || { echo "ERROR: wrangler.toml missing (it's local-only) — cp wrangler.toml.example wrangler.toml and fill in your KV id"; exit 1; }

OUT=$(CI=1 npx wrangler pages deploy --branch main 2>&1) || { echo "$OUT"; exit 1; }
echo "$OUT" | grep -q "Uploading Functions bundle" \
  || { echo "$OUT"; echo "ERROR: Functions bundle missing from deploy — aborting trust in this deploy"; exit 1; }
echo "$OUT" | tail -2
