#!/usr/bin/env bash
# Deploy antifeed. Always run wrangler from the repo root — deploying from a
# subdirectory silently drops the functions/ bundle and kills the /api/* routes.
set -euo pipefail
cd "$(dirname "$0")"

OUT=$(CI=1 npx wrangler pages deploy --branch main 2>&1) || { echo "$OUT"; exit 1; }
echo "$OUT" | grep -q "Uploading Functions bundle" \
  || { echo "$OUT"; echo "ERROR: Functions bundle missing from deploy — aborting trust in this deploy"; exit 1; }
echo "$OUT" | tail -2
