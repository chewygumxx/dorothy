#!/usr/bin/env sh
# vim:set expandtab shiftwidth=4 filetype=sh:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/.agents/skills/agent-stewardship/scripts/job.sh
#
#

# Runs a long job as a transient user unit, so it outlives a plan's usage
# limit, a memory-pressure reap of the client's background shell, and a
# client restart. When it stops, job-stopped.sh records the result and
# then prompts the agent named by --notify.
#
#   job.sh <name> [--notify <agent>] [--env NAME]... -- <command> [args]
#
# The unit is dorothy-job-<name>-<epoch ns>, run in the caller's working
# directory, its output appended to jobs/<unit>.log under the state
# directory. Only a short allowlist of the environment crosses into the
# unit, by name, as are the --env names; no value is ever in an argument.
# The command is passed as it is written: nothing in it is expanded.

set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=pane-lock.sh source-path=SCRIPTDIR
. "$here/pane-lock.sh"

usage() {
    printf '%s\n' \
        "usage: ${0##*/} <name> [--notify <agent>] [--env NAME]... -- <command> [args]" \
        'name: letters, digits, ".", "_" and "-"' >&2
    exit 2
}

# plain <path>: ExecStopPost and the log property are read by systemd,
# which splits a command at spaces and expands $ and %, so a path holding
# anything it would read is refused.
plain() {
    case $1 in
    *[[:space:]]* | *\"* | *\'* | *\\* | *\$* | *%* | *\;*)
        die 1 "$1 holds a character systemd would read; use a plainer path"
        ;;
    esac
}

setenvs=
# add <name>: passes the name once.
add() {
    case " $setenvs " in
    *" $1 "*) ;;
    *) setenvs="$setenvs $1" ;;
    esac
}

[ $# -ge 1 ] || usage
name=$1
shift
case $name in
*[!A-Za-z0-9._-]* | '' | -*) usage ;;
esac

notify=-
extra=
while [ $# -gt 0 ]; do
    case $1 in
    --notify)
        [ $# -ge 2 ] || usage
        case $2 in
        *[!A-Za-z0-9:_.-]* | '' | -*) usage ;;
        esac
        notify=$2
        shift 2
        ;;
    --env)
        [ $# -ge 2 ] || usage
        case $2 in
        *[!A-Za-z0-9_]* | '' | [0-9]*) usage ;;
        esac
        extra="$extra $2"
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

for var in PATH HOME XDG_CONFIG_HOME XDG_DATA_HOME XDG_STATE_HOME \
    XDG_CACHE_HOME XDG_RUNTIME_DIR HERDR_SOCKET_PATH SOPS_AGE_KEY_FILE \
    CLAUDE_CONFIG_DIR; do
    if printenv "$var" >/dev/null; then add "$var"; fi
done
for var in $(env | sed -n 's/^\(DOROTHY_CLAUDE_[A-Za-z0-9_]*\)=.*/\1/p'); do
    add "$var"
done
for var in $extra; do
    add "$var"
done

jobs=$(state_dir)/jobs
mkdir -p "$jobs" || die 1 "cannot make $jobs"
unit=dorothy-job-$name-$(date +%s%N)
log=$jobs/$unit.log
stop=$here/job-stopped.sh
plain "$stop"
plain "$log"

# The command, then the names ahead of it, then the unit's own options.
set -- -- "$@"
for var in $setenvs; do
    set -- "--setenv=$var" "$@"
done
set -- --user --collect "--unit=$unit" "--working-directory=$(pwd)" \
    --expand-environment=no \
    -p "StandardOutput=append:$log" -p "StandardError=append:$log" \
    -p "ExecStopPost=$stop $unit $notify" "$@"
systemd-run "$@" >/dev/null || die 1 'systemd-run refused the unit'
printf 'unit: %s\nlog: %s\n' "$unit" "$log"
