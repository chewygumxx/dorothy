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
# plan's rate limits and the session's context window to the status line
# alone, so this keeps them where an agent can read them before spending:
# rate_limits and context_window, with the time,
# in $XDG_RUNTIME_DIR/claude-usage-<account>.json, the account being
# CLAUDE_CONFIG_DIR's last part. Then the user's own status line,
# ccstatusline, draws from the same input; without it, a minimal line: the
# model's name and the 5-hour use. A missing jq or runtime directory skips
# the file; the status line is drawn regardless.

input=$(cat)

runtime=${XDG_RUNTIME_DIR:-}
if [ -n "$runtime" ] && [ -d "$runtime" ] && command -v jq >/dev/null 2>&1; then
    account=$(basename -- "${CLAUDE_CONFIG_DIR:-$HOME/.claude}")
    target="$runtime/claude-usage-$account.json"
    temporary="$target.$$"
    if printf '%s' "$input" |
        jq -c --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
            'select(.rate_limits != null or .context_window != null)
                | {at: $at, rate_limits, context_window}' \
            >"$temporary" 2>/dev/null &&
        [ -s "$temporary" ]; then
        chmod 600 "$temporary" && mv -f "$temporary" "$target"
    fi
    rm -f "$temporary"
fi

if command -v ccstatusline >/dev/null 2>&1; then
    printf '%s' "$input" | ccstatusline
else
    line=$(
        printf '%s' "$input" |
            jq -r '[
                (.model.display_name // "Claude"),
                (.rate_limits.five_hour.used_percentage
                    | select(type == "number") | "5h \(round)%")
            ] | join(" | ")' 2>/dev/null |
            tr -d '[:cntrl:]'
    )
    printf '%s\n' "${line:-Claude}"
fi
