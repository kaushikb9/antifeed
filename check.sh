#!/usr/bin/env bash
# The one verb. ~1s, no network, no KV, no brain. Exit 0 = safe to hand back.
# Three seams under test: data (schema), API (stubbed KV), renderer (source).
set -euo pipefail
cd "$(dirname "$0")"
node --test 'tests/*.test.mjs' 'auth/*.test.mjs'
# Every job script must at least parse: a stray apostrophe inside curate.sh's
# single-quoted node -e block broke the 2026-09-28 run and no test caught it.
for f in brain/*.sh deploy.sh; do bash -n "$f"; done
