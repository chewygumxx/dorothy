#!/usr/bin/env sh
# vim:set expandtab shiftwidth=4 filetype=sh:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/.agents/skills/agent-stewardship/scripts/at-limit.sh
#
#

# Runs a command, and while it exits 75, the code `eval run` and
# `dorothy --review-backfill -n all` return when a plan's usage limit
# stops them, waits and runs it again, up to N more times. A retry is the
# command again, or `sh -c CMD` if --retry gave one, say a resume of the
# run that stopped. Exits with the last run's code.
#
#   at-limit.sh [--wait S] [--tries N] [--retry CMD] -- <command> [args]
#
# S is 1200 seconds and N is 40 by default.

set -eu

usage() {
    printf 'usage: %s [--wait S] [--tries N] [--retry CMD] -- <command> [args]\n' \
        "${0##*/}" >&2
    exit 2
}

wait=1200
tries=40
retry=
while [ $# -gt 0 ]; do
    case $1 in
    --wait | --tries | --retry)
        [ $# -ge 2 ] || usage
        case $1 in
        --wait) wait=$2 ;;
        --tries) tries=$2 ;;
        --retry) retry=$2 ;;
        esac
        shift 2
        ;;
    --)
        shift
        break
        ;;
    *) usage ;;
    esac
done
[ $# -gt 0 ] || usage
case $wait in '' | *[!0-9]*) usage ;; esac
case $tries in '' | *[!0-9]*) usage ;; esac

code=0
"$@" || code=$?
attempt=0
while [ "$code" -eq 75 ] && [ "$attempt" -lt "$tries" ]; do
    attempt=$((attempt + 1))
    printf '%s limited; retrying in %ss (%s of %s)\n' "$(date +%H:%M)" \
        "$wait" "$attempt" "$tries" >&2
    sleep "$wait"
    code=0
    if [ -n "$retry" ]; then
        sh -c "$retry" || code=$?
    else
        "$@" || code=$?
    fi
done
exit "$code"
