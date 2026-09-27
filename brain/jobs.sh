# Shared by every antifeed job (curate, inbox, x-bookmarks, deploy). Sourced,
# never run. The harness itself is the vendored kb brain kit in brain/kit.sh
# (canonical: ~/Code/brain/kit/jobs.sh; never edit the copy here).
JOB="${JOB:-antifeed}"
source "$(dirname "${BASH_SOURCE[0]}")/kit.sh"
