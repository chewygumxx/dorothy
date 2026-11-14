#!/usr/bin/env sh
# vim:set expandtab shiftwidth=4 filetype=sh:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~xxdorothy/dorothy.git
# ::: :/scripts/prepare.sh
#
#

set -e

# A production install has no development dependencies to set up.
[ -d node_modules/husky ] || exit 0

husky

# The sync exits 1 on a failed fetch, as offline: warn and link the
# package's skills alone, failing the install only if that fails too.
DO_NOT_TRACK=1 skills experimental_sync -y \
    --agent claude-code codex ${CI:+--no-remote} || {
    echo "prepare: fetching remote skills failed; linking package skills alone" >&2
    DO_NOT_TRACK=1 skills experimental_sync -y \
        --agent claude-code codex --no-remote
}

# The sync exits 0 on a skipped skill, so the skills' checks fail instead.
bun test --bail agents.test.ts --test-name-pattern 'the skills'

bun scripts/agent-memory.ts
