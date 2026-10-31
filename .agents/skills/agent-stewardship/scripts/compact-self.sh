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
# Needs $HERDR_PANE_ID, which names the agent; its pane, as herdr now
# reports it, is the one locked and written. Writes `/compact`, a space
# and the file's contents (after a space if they begin with `-`), then
# Enter, apart and pausing between (DOROTHY_COMPACT_PAUSE seconds, 3 by
# default), holding the pane's lock so no message falls in between.
#
# Exit: 2 usage, 4 no agent on the pane, 5 the agent was not idle once
# the pane was locked, 1 other failure.

set -eu

here=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=pane-lock.sh source-path=SCRIPTDIR
. "$here/pane-lock.sh"

usage() {
    printf 'usage: %s <instructions file>, within herdr\n' "${0##*/}" >&2
    exit 2
}

[ $# -eq 1 ] && [ -r "$1" ] && [ -n "${HERDR_PANE_ID:-}" ] || usage
instructions=$(cat "$1")
[ -n "$instructions" ] || usage
# The pane may have moved since $HERDR_PANE_ID was set; send-prompt.sh
# locks the pane herdr reports, so this does too.
pane=$(agent_pane "$HERDR_PANE_ID") || die 4 "no agent on $HERDR_PANE_ID"
pause=${DOROTHY_COMPACT_PAUSE:-3}
# herdr takes no `--`, so text beginning with `-` could pass for an option.
case $instructions in
-*) instructions=" $instructions" ;;
esac

herdr agent wait "$pane" --until idle >/dev/null || die 1 'wait failed'
sleep "$pause"
lock_pane "$pane"
[ "$(agent_status "$pane")" = idle ] || die 5 "agent on $pane is not idle"

herdr pane send-text "$pane" '/compact ' >/dev/null 2>&1 ||
    die 1 "cannot write to pane $pane"
sleep "$pause"
herdr pane send-text "$pane" "$instructions" >/dev/null 2>&1 ||
    die 1 "/compact typed in pane $pane, instructions not sent: clear the input"
sleep "$pause"
herdr pane send-keys "$pane" enter >/dev/null 2>&1 ||
    die 1 "/compact and instructions typed in pane $pane, enter failed"
