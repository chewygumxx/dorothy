#!/usr/bin/env sh
# vim:set expandtab shiftwidth=4 filetype=sh:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/.agents/skills/agent-stewardship/scripts/compact-self.sh
#
#

# Compacts the agent's own conversation in its herdr pane, with the
# instructions in a file, once it has finished its turn. Run it detached
# from the turn that asks for it, as it waits for the turn to end:
#
#   compact-self.sh <instructions file>
#
# Needs $HERDR_PANE_ID. Writes `/compact`, a space and the file's
# contents, then Enter, apart and pausing between (DOROTHY_COMPACT_PAUSE
# seconds, 3 by default), holding the pane's lock so no message falls
# in between.
#
# Exit: 2 usage, 5 the agent was not idle once the pane was locked.

set -eu

here=$(cd "$(dirname "$0")" && pwd)
. "$here/pane-lock.sh"

usage() {
    printf 'usage: %s <instructions file>, within herdr\n' "${0##*/}" >&2
    exit 2
}

[ $# -eq 1 ] && [ -r "$1" ] && [ -n "${HERDR_PANE_ID:-}" ] || usage
pane=$HERDR_PANE_ID
instructions=$(cat "$1")
[ -n "$instructions" ] || usage
pause=${DOROTHY_COMPACT_PAUSE:-3}

herdr agent wait "$pane" --until idle >/dev/null || die 1 'wait failed'
sleep "$pause"
lock_pane "$pane"
[ "$(agent_status "$pane")" = idle ] || die 5 "agent on $pane is not idle"

herdr pane send-text "$pane" '/compact ' >/dev/null
sleep "$pause"
herdr pane send-text "$pane" "$instructions" >/dev/null
sleep "$pause"
herdr pane send-keys "$pane" enter >/dev/null
