#!/usr/bin/env sh
# vim:set expandtab shiftwidth=4 filetype=sh:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/scripts/statusline.sh
#
#

# Claude Code's status line for this project. Claude Code passes the
# plan's rate limits to the status line alone, so this keeps them where
# an agent can read them before spending: rate_limits, with the time,
# in $XDG_RUNTIME_DIR/claude-usage-<account>.json, the account being
# CLAUDE_CONFIG_DIR's last part. Then the user's own status line,
# ccstatusline, draws from the same input. A missing jq or runtime
# directory skips the file; the status line is drawn regardless.

input=$(cat)

runtime=${XDG_RUNTIME_DIR:-}
if [ -n "$runtime" ] && [ -d "$runtime" ] && command -v jq >/dev/null 2>&1; then
    account=$(basename -- "${CLAUDE_CONFIG_DIR:-$HOME/.claude}")
    target="$runtime/claude-usage-$account.json"
    temporary="$target.$$"
    if printf '%s' "$input" |
        jq -c --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            'select(.rate_limits != null) | {at: $at, rate_limits}' \
            >"$temporary" 2>/dev/null &&
        [ -s "$temporary" ]; then
        chmod 600 "$temporary" && mv -f "$temporary" "$target"
    fi
    rm -f "$temporary"
fi

if command -v ccstatusline >/dev/null 2>&1; then
    printf '%s' "$input" | ccstatusline
fi
