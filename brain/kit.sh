# kb brain kit — the harness every unattended brain job shares. CANONICAL COPY:
# edit here (~/Code/brain/kit/jobs.sh), then copy byte-for-byte to each app's
# brain/kit.sh; ~/Code/check-all.sh fails on drift. Generic plumbing only:
# no app names, no paths outside the app, no prompts, nothing private (apps
# that vendor it may be public).
#
# Use: set JOB (and optionally JOB_LOG, BRAIN_FILES) then `source brain/kit.sh`.
# The app keeps its own brain/runlog.mjs (turns a claude -p JSON result into
# one metrics line).
#
# Reliability contract (KB, 2026-09-27): every claude/git/deploy call is
# time-boxed, every failed leg exits non-zero with one dated log line and a
# notification, every success writes one dated metrics line.

JOBS_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JOB_LOG="${JOB_LOG:-$JOBS_ROOT/brain/auto.log}"
JOB="${JOB:?set JOB before sourcing brain/kit.sh}"

# One wrangler for every app: an unpinned npx pulled whatever was latest.
WRANGLER_VERSION="${WRANGLER_VERSION:-4.141.0}"

# launchd's PATH may lack coreutils' timeout; fall back to gtimeout, then perl.
if command -v timeout >/dev/null 2>&1; then TIMEOUT=timeout
elif command -v gtimeout >/dev/null 2>&1; then TIMEOUT=gtimeout
else TIMEOUT=perl; fi
tmo() { # tmo 90 git push …   (durations: 90, 90s, 45m, 2h)
  local d="$1"; shift
  if [ "$TIMEOUT" = perl ]; then
    case "$d" in *m) d=$(( ${d%m} * 60 ));; *h) d=$(( ${d%h} * 3600 ));; *s) d="${d%s}";; esac
    perl -e 'alarm shift; exec @ARGV' "$d" "$@"
  else "$TIMEOUT" "$d" "$@"; fi
}

job_line() { # one dated line to the log (and the terminal when interactive)
  local line; line="$(date '+%F %H:%M') $JOB: $*"
  echo "$line" >> "$JOB_LOG"
  [ -t 2 ] && echo "$line" >&2
  return 0
}

# fail <step> <reason> <hint>  → log, notify, exit 1
fail() {
  job_line "FAILED at $1 · $2 · fix: $3"
  osascript -e "display notification \"$JOB: $1 failed\" with title \"kb jobs\"" >/dev/null 2>&1 || true
  exit 1
}

# Cloudflare: the scoped API token beats wrangler's OAuth, whose refresh 401s
# unattended. Exported only when present, so interactive OAuth still works.
cf_token() {
  local f="$HOME/.config/kb/config.json" t a
  t=$(jq -r '.cloudflare_api_token // empty' "$f" 2>/dev/null || true)
  a=$(jq -r '.cloudflare_account_id // empty' "$f" 2>/dev/null || true)
  [ -n "$t" ] && export CLOUDFLARE_API_TOKEN="$t"
  [ -n "$a" ] && export CLOUDFLARE_ACCOUNT_ID="$a"
  return 0
}

# Harness for every brain: no slash commands/skill list, and only the
# project's settings (not KB's interactive CLAUDE.md).
BRAIN_FILES=()   # data files a brain edits; restored if the run fails
BRAIN_FLAGS=(--safe-mode --disable-slash-commands --output-format json --strict-mcp-config --permission-mode acceptEdits)

# run_brain <name> <prompt> <claude args…>: 45m cap, JSON result → one metrics
# line; non-zero on a failed/hung run.
run_brain() {
  local name="$1" prompt="$2"; shift 2
  local out; out="$(mktemp -t "$JOB-brain")"
  tmo 45m caffeinate -i claude -p "$prompt" "${BRAIN_FLAGS[@]}" "$@" > "$out" || true
  local line rc=0
  line=$(node "$JOBS_ROOT/brain/runlog.mjs" "$name" "$out") || rc=1
  echo "$line" >> "$JOB_LOG"; [ -t 2 ] && echo "$line" >&2
  rm -f "$out"
  if [ $rc -ne 0 ]; then
    [ ${#BRAIN_FILES[@]} -gt 0 ] && stash_data "${BRAIN_FILES[@]}"
    local hint="read brain/auto.log; rerun"
    case "$line" in *login*) hint='run `claude /login` in a terminal';; *"no JSON"*) hint="claude -p hung past 45m or crashed (usage limit?)";; esac
    fail "brain" "claude -p run failed" "$hint"
  fi
}

# stash_data <files…>: keep the brain's edits in brain/scratch for inspection
# and put the committed files back, so a failed day is retried next hour
# instead of stranded (a red validator used to leave today's date in the tree).
stash_data() {
  local dir="$JOBS_ROOT/brain/scratch/red-$(date +%F-%H%M%S)" f
  mkdir -p "$dir"
  for f in "$@"; do [ -f "$JOBS_ROOT/$f" ] && cp "$JOBS_ROOT/$f" "$dir/$(basename "$f")"; done
  git -C "$JOBS_ROOT" checkout -- "$@"
  STASHED="${dir#$JOBS_ROOT/}"
}

# restore_data <step> <files…>: stash, then fail loud.
restore_data() {
  local step="$1"; shift
  stash_data "$@"
  fail "$step" "validator red, edits moved to $STASHED" "read the validator output, fix the prompt or data; next hour retries"
}
