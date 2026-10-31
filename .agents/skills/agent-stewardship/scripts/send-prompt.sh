#!/usr/bin/env sh
# vim:set expandtab shiftwidth=4 filetype=sh:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/.agents/skills/agent-stewardship/scripts/send-prompt.sh
#
#

# Sends a message, read from stdin, to an agent in a herdr pane, as text
# and then Enter in two calls: Claude Code swallows an Enter arriving in
# the same paste as text. A blocked agent is refused, as the text would
# answer its dialog.
#
#   send-prompt.sh [--from <name>] [--at <time> | --in <span>] <agent>
#   send-prompt.sh --deliver <id>
#
# The message is labelled `[from <name>] `, the name being --from, else
# the agent on $HERDR_PANE_ID. --at takes a time that holds a date
# (YYYY-MM-DD ..., or @<epoch>), as a bare time recurs daily; --in a
# span, such as 90min. Either keeps the message in a file under the
# state directory and sets a transient systemd timer to run this script
# with --deliver, so no message is in a unit or its arguments. A
# delivery refused by a blocked or absent agent is tried again in five
# minutes, twelve times at most.
#
# Exit: 2 usage, 3 agent blocked, 4 agent absent, 1 other failure.

set -eu

here=$(cd "$(dirname "$0")" && pwd)
self=$here/$(basename "$0")
. "$here/pane-lock.sh"

usage() {
    printf '%s\n' \
        "usage: ${0##*/} [--from <name>] [--at <time> | --in <span>] <agent>" \
        "       ${0##*/} --deliver <id>" \
        'the message on stdin; --at needs a date, as in "2026-11-02 02:31"' >&2
    exit 2
}

now() {
    date -u +%Y-%m-%dT%H:%M:%SZ
}

# Agent names and ids stay within what a unit and a file name hold, so an
# id gives its agent back.
valid() {
    case $1 in
    *[!A-Za-z0-9:_.-]* | '' | -*) usage ;;
    esac
}

# arm <unit> <timer option> <id>: a one-shot timer running this script to
# deliver the send. Neither the message nor a secret goes in its arguments.
arm() {
    unit=$1 option=$2 id=$3
    set -- --user --collect --timer-property=AccuracySec=1s
    set -- "$@" --setenv=PATH --setenv=XDG_RUNTIME_DIR
    [ -z "${HERDR_SOCKET_PATH:-}" ] || set -- "$@" --setenv=HERDR_SOCKET_PATH
    [ -z "${XDG_STATE_HOME:-}" ] || set -- "$@" --setenv=XDG_STATE_HOME
    systemd-run "$@" --unit="$unit" "$option" -- "$self" --deliver "$id"
}

from=
at=
span=
deliver=
while [ $# -gt 0 ]; do
    case $1 in
    --from | --at | --in | --deliver)
        [ $# -ge 2 ] && [ -n "$2" ] || usage
        case $1 in
        --from) from=$2 ;;
        --at) at=$2 ;;
        --in) span=$2 ;;
        --deliver) deliver=$2 ;;
        esac
        shift 2
        ;;
    --) shift && break ;;
    -*) usage ;;
    *) break ;;
    esac
done

if [ -n "$deliver" ]; then
    [ $# -eq 0 ] && [ -z "$from$at$span" ] || usage
    valid "$deliver"
    id=$deliver
    agent=${id%-*}
    sends=$(state_dir)/sends
    [ -f "$sends/$id.msg" ] || die 1 "no message waits as $id"
    tries=$(cat "$sends/$id.tries" 2>/dev/null || echo 0)

    log() {
        printf '%s %s\n' "$(now)" "$1" >>"$sends/$id.log"
    }

    # refuse <why> <exit code>: tries again later, or gives up; exits.
    refuse() {
        if [ "$tries" -ge 12 ]; then
            log 'gave up'
            die "$2" "gave up on $id: agent $agent is $1"
        fi
        tries=$((tries + 1))
        printf '%s\n' "$tries" >"$sends/$id.tries"
        if arm "dorothy-send-$id-$tries" --on-active=5min "$id" >/dev/null; then
            log "refused $1, re-armed"
            exit 0
        fi
        log "refused $1, re-arming failed"
        die 1 "cannot re-arm $id"
    }

    pane=$(agent_pane "$agent") || refuse absent 4
    lock_pane "$pane"
    status=$(agent_status "$agent") || refuse absent 4
    [ "$status" != blocked ] || refuse blocked 3
    text=$(cat "$sends/$id.msg")
    herdr pane send-text "$pane" "$text" >/dev/null 2>&1 || refuse unsendable 1
    if ! herdr pane send-keys "$pane" enter >/dev/null 2>&1; then
        log 'partial: text written, enter failed'
        die 1 "$id: text written, enter failed"
    fi
    log delivered
    rm -f "${sends:?}/${id:?}.msg"
    exit 0
fi

[ $# -eq 1 ] || usage
agent=$1
valid "$agent"
[ -z "$at" ] || [ -z "$span" ] || usage

if [ -z "$from" ] && [ -n "${HERDR_PANE_ID:-}" ]; then
    from=$(agent_field "$HERDR_PANE_ID" '.name // .pane_id') || from=
fi
from=$(printf '%s' "$from" | tr -d '[:cntrl:]')
[ -n "$from" ] || usage

message=$(cat)
case $message in
*[![:space:]]*) ;;
*) usage ;;
esac

if [ -z "$at$span" ]; then
    # The pane is needed for its lock, and the status is read once the
    # lock is held, as a send ahead of this one may have left it blocked.
    pane=$(agent_pane "$agent") || die 4 "agent $agent is absent"
    lock_pane "$pane"
    status=$(agent_status "$agent") || die 4 "agent $agent is absent"
    [ "$status" != blocked ] || die 3 "agent $agent is blocked on a dialog"
    # The label begins the text, so a message of `-rf` is never an option.
    herdr pane send-text "$pane" "[from $from] $message" >/dev/null 2>&1 ||
        die 1 "cannot write to pane $pane"
    herdr pane send-keys "$pane" enter >/dev/null 2>&1 ||
        die 1 "text written to pane $pane, enter failed"
    exit 0
fi

if [ -n "$at" ]; then
    case $at in
    [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]* | @[0-9]*) ;;
    *) die 2 "--at needs a date, as in \"2026-11-02 $at\"; a bare time recurs daily" ;;
    esac
    epoch=$(date -d "$at" +%s 2>/dev/null) || die 2 "cannot read the time $at"
    [ "$epoch" -gt "$(date +%s)" ] || die 2 "$at is not in the future"
    resolved=$(date -d "$at" '+%Y-%m-%d %H:%M:%S %Z')
    option=--on-calendar=$resolved
else
    resolved="in $span"
    option=--on-active=$span
fi

sends=$(state_dir)/sends
mkdir -p "$sends"
id=$agent-$(date +%s%N)
(umask 077 && printf '%s' "[from $from, scheduled] $message" >"$sends/$id.msg")
if ! arm "dorothy-send-$id" "$option" "$id" >/dev/null; then
    rm -f "${sends:?}/${id:?}.msg"
    die 1 'systemd-run refused the timer'
fi
printf 'unit: dorothy-send-%s\nwhen: %s\n' "$id" "$resolved"
