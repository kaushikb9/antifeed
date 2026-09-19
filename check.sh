#!/usr/bin/env bash
# The one verb. ~1s, no network, no KV, no brain. Exit 0 = safe to hand back.
# Three seams under test: data (schema), API (stubbed KV), renderer (source).
set -euo pipefail
cd "$(dirname "$0")"
node --test 'tests/*.test.mjs' 'auth/*.test.mjs'
