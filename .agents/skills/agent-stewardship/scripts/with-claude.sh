#!/usr/bin/env sh
# vim:set expandtab shiftwidth=4 filetype=sh:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/.agents/skills/agent-stewardship/scripts/with-claude.sh
#
#

# Runs a command on the Claude account to spend: the primary whenever its
# token is in secrets.json, unless a fresh reading of its usage shows it
# near a limit, then the reserve. A reading is $XDG_RUNTIME_DIR/
# claude-usage-<primary>.json, written by scripts/statusline.sh; it counts
# when it parses, is under 600 seconds old and holds rate_limits, and the
# primary is spent past 90% of the five-hour window or 80% of the week.
# Anything else is no reading, and the primary is tried: a limit then
# stops the job for at-limit.sh to retry.
#
# Only the name of the token's entry goes out, as DOROTHY_CLAUDE_TOKEN_VAR,
# for dorothy and eval to read from secrets.json; no token is read here.
#
#   with-claude.sh <command> [args]
#
# DOROTHY_CLAUDE_PRIMARY (claude-2) names the primary account and
# DOROTHY_CLAUDE_PRIMARY_TOKEN_VAR (CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2) its
# entry; the reserve's entry is CLAUDE_CODE_OAUTH_TOKEN.

set -eu

[ $# -gt 0 ] || {
    printf 'usage: %s <command> [args]\n' "${0##*/}" >&2
    exit 2
}

# Four directories above the script, resolved physically so that the
# .claude/skills link and the .agents/skills directory meet at one checkout.
checkout=$(CDPATH='' cd -P -- "$(dirname -- "$0")/../../../.." && pwd) || exit 1

primary=${DOROTHY_CLAUDE_PRIMARY:-claude-2}
token_var=${DOROTHY_CLAUDE_PRIMARY_TOKEN_VAR:-CLAUDE_CODE_OAUTH_TOKEN_CLAUDE2}
usage_file=${XDG_RUNTIME_DIR:-/nonexistent}/claude-usage-$primary.json

# Prints "limited" for a fresh reading past a threshold; nothing otherwise.
# An unreadable file or a missing field is an error jq's try swallows.
limited() {
    [ -f "$usage_file" ] || return 0
    jq -r 'try (
        if (now - (.at | fromdateiso8601)) < 600
            and (.rate_limits.five_hour.used_percentage >= 90
                or .rate_limits.seven_day.used_percentage >= 80)
        then "limited" else empty end
    ) catch empty' "$usage_file" 2>/dev/null || true
}

account=reserve
if sops decrypt --extract "[\"$token_var\"]" "$checkout/secrets.json" \
    >/dev/null 2>&1; then
    account=primary
    [ "$(limited)" != limited ] || account=reserve
fi

if [ "$account" = primary ]; then
    DOROTHY_CLAUDE_TOKEN_VAR=$token_var
else
    DOROTHY_CLAUDE_TOKEN_VAR=CLAUDE_CODE_OAUTH_TOKEN
fi
export DOROTHY_CLAUDE_TOKEN_VAR
printf '%s claude account: %s\n' "$(date +%H:%M)" "$account" >&2
exec "$@"
