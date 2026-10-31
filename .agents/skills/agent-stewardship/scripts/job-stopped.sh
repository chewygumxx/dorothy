#!/usr/bin/env sh
# vim:set expandtab shiftwidth=4 filetype=sh:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/.agents/skills/agent-stewardship/scripts/job-stopped.sh
#
#

# The ExecStopPost of a job.sh unit, run by systemd with SERVICE_RESULT,
# EXIT_CODE and EXIT_STATUS in its environment (the last two are absent
# when the job never started). The result is written first, to
# jobs/<unit>.result, then the agent is told, unless it is `-`. A failed
# send is logged to jobs/<unit>.notify.log and never fails the unit.
#
#   job-stopped.sh <unit> <agent|->

set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
. "$here/pane-lock.sh"

usage() {
    printf 'usage: %s <unit> <agent|->\n' "${0##*/}" >&2
    exit 2
}

now() {
    date -u +%Y-%m-%dT%H:%M:%SZ
}

[ $# -eq 2 ] || usage
unit=$1
agent=$2
case $unit in
*[!A-Za-z0-9._-]*) usage ;;
dorothy-job-*-[0-9]*) ;;
*) usage ;;
esac
case $agent in
*[!A-Za-z0-9:_.-]* | '') usage ;;
esac

# The unit is dorothy-job-<name>-<epoch ns>, and a name may hold dashes.
name=${unit#dorothy-job-}
name=${name%-*}

jobs=$(state_dir)/jobs
mkdir -p "$jobs" || die 1 "cannot make $jobs"
{
    printf 'result=%s\n' "${SERVICE_RESULT:-}"
    printf 'exit_code=%s\n' "${EXIT_CODE:-}"
    printf 'exit_status=%s\n' "${EXIT_STATUS:-}"
    printf 'at=%s\n' "$(now)"
} >"$jobs/$unit.result.tmp"
mv "$jobs/$unit.result.tmp" "$jobs/$unit.result"

[ "$agent" != - ] || exit 0

# The exit code and status are left out when the job never ran.
detail="${EXIT_CODE:-} ${EXIT_STATUS:-}"
detail=${detail# }
detail=${detail% }
message="job $unit stopped: ${SERVICE_RESULT:-}"
[ -z "$detail" ] || message="$message ($detail)"
message="$message; log $jobs/$unit.log"

status=0
err=$(printf '%s\n' "$message" |
    "$here/send-prompt.sh" --from "job:$name" --in 1s "$agent" 2>&1 >/dev/null) ||
    status=$?
if [ "$status" -ne 0 ]; then
    printf '%s send to %s failed (%s): %s\n' "$(now)" "$agent" "$status" \
        "$(printf '%s' "$err" | tr '\n' ' ')" >>"$jobs/$unit.notify.log"
fi
exit 0
