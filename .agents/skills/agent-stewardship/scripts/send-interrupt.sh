#!/usr/bin/env sh
# vim:set expandtab shiftwidth=4 filetype=sh:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/.agents/skills/agent-stewardship/scripts/send-interrupt.sh
#
#

# Sends one Escape, which interrupts a Codex or Claude Code turn, to an
# agent in a herdr pane, under the pane's lock, so it never lands between
# another sender's text and Enter. The lock is waited for --lock-wait
# seconds (5 by default) at most. Once it is held, the agent is read again:
# its pane must be --expect-pane and its terminal --expect-terminal where
# given, and it must not be blocked, as Escape would answer its dialog.
# --expect-session <id> or --expect-process <pid> <boot:start> also pins
# the real occupant. --key ctrl+c asks the native harness to quit (esc is
# the default); both are sent only after the same locked guards.
#
#   send-interrupt.sh [--expect-pane <id>] [--expect-terminal <id>]
#                     [--expect-session <id> | --expect-process <pid> <start>]
#                     [--key esc|ctrl+c] [--lock-wait <seconds>] <agent>
#
# Exit: 2 usage, 3 agent blocked, 4 agent absent, 5 agent in another
# pane, 7 lock not had in time, 8 another terminal, 9 another occupant:
# each before anything is sent. 1 another failure, the key perhaps sent.

set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=pane-lock.sh source-path=SCRIPTDIR
. "$here/pane-lock.sh"

usage() {
    printf '%s\n' \
        "usage: ${0##*/} [--expect-pane <id>] [--expect-terminal <id>] [--lock-wait <seconds>] <agent>" >&2
    exit 2
}

valid() {
    case $1 in
    *[!A-Za-z0-9:_.-]* | '' | -*) usage ;;
    esac
}

expect=
terminal=
session=
process=
started=
key=esc
wait=5
while [ $# -gt 0 ]; do
    case $1 in
    --expect-session)
        [ $# -ge 2 ] && [ -n "$2" ] || usage
        valid "$2" && session=$2
        shift 2
        ;;
    --expect-process)
        [ $# -ge 3 ] && [ -n "$2" ] && [ -n "$3" ] || usage
        case $2 in *[!0-9]* | '' | 0) usage ;; esac
        valid "$3" || usage
        process=$2 started=$3
        shift 3
        ;;
    --key)
        [ $# -ge 2 ] || usage
        case $2 in esc | ctrl+c) key=$2 ;; *) usage ;; esac
        shift 2
        ;;
    --expect-pane | --expect-terminal | --lock-wait)
        [ $# -ge 2 ] && [ -n "$2" ] || usage
        case $1 in
        --expect-pane) valid "$2" && expect=$2 ;;
        --expect-terminal) valid "$2" && terminal=$2 ;;
        --lock-wait)
            case $2 in
            *[!0-9]* | 0*) usage ;;
            esac
            [ "$2" -le 60 ] || usage
            wait=$2
            ;;
        esac
        shift 2
        ;;
    --) shift && break ;;
    -*) usage ;;
    *) break ;;
    esac
done

[ $# -eq 1 ] || usage
agent=$1
valid "$agent"
[ -z "$session" ] || [ -z "$process$started" ] || usage
if { [ -n "$process" ] && [ -z "$started" ]; } ||
    { [ -z "$process" ] && [ -n "$started" ]; }; then
    usage
fi

pane=$(agent_pane "$agent") || die 4 "agent $agent is absent"
[ -z "$expect" ] || [ "$pane" = "$expect" ] ||
    die 5 "agent $agent is in pane $pane, not $expect"
lock_pane "$pane" "$wait"
# Pane, terminal and status in one reading, under the lock.
seen=$(agent_field "$agent" \
    '.pane_id + " " + (.terminal_id // "-") + " " + .agent_status') ||
    die 4 "agent $agent is absent"
now_pane=${seen%% *}
rest=${seen#* }
now_terminal=${rest%% *}
status=${rest#* }
[ "$now_pane" = "$pane" ] || die 5 "agent $agent is in pane $now_pane, not $pane"
[ -z "$terminal" ] || [ "$now_terminal" = "$terminal" ] ||
    die 8 "pane $pane holds terminal $now_terminal, not $terminal"
[ "$status" != blocked ] || die 3 "agent $agent is blocked on a dialog"
occupant_guard "$agent" "$pane" "$session" "$process" "$started"
herdr pane send-keys "$pane" "$key" >/dev/null 2>&1 ||
    die 1 "$key to pane $pane failed, perhaps sent"
