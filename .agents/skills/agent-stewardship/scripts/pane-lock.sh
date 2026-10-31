#!/usr/bin/env sh
# vim:set expandtab shiftwidth=4 filetype=sh:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/.agents/skills/agent-stewardship/scripts/pane-lock.sh
#
#

# Sourced by send-prompt.sh and compact-self.sh: `. "$here/pane-lock.sh"`.
# A pane takes one writer at a time, so a message cannot land among
# another's text and Enter. Status and pane come from `herdr agent get`,
# which takes an agent's name or its pane's id.

# die <exit code> <message>
die() {
    code=$1
    shift
    printf '%s: %s\n' "${0##*/}" "$*" >&2
    exit "$code"
}

# Prints the directory of state kept between runs, making it private.
state_dir() {
    dir=${XDG_STATE_HOME:-$HOME/.local/state}/dorothy-agents
    mkdir -p "$dir" || die 1 "cannot make $dir"
    chmod 700 "$dir"
    printf '%s\n' "$dir"
}

# Holds the pane's lock on fd 9 until the script exits.
lock_pane() {
    [ -n "${XDG_RUNTIME_DIR:-}" ] || die 1 'XDG_RUNTIME_DIR is not set'
    dir=$XDG_RUNTIME_DIR/dorothy-agents
    mkdir -p "$dir" || die 1 "cannot make $dir"
    chmod 700 "$dir"
    name=$(printf '%s' "$1" | tr -c '[:alnum:]' _)
    exec 9>"$dir/$name.lock" || die 1 "cannot open the lock of pane $1"
    flock 9 || die 1 "cannot lock pane $1"
}

# agent_field <agent> <jq filter on the agent>: fails for an absent
# agent, whose reply is an error without a result.
agent_field() {
    herdr agent get "$1" 2>/dev/null | jq -er ".result.agent | $2"
}

agent_pane() {
    agent_field "$1" .pane_id
}

agent_status() {
    agent_field "$1" .agent_status
}
