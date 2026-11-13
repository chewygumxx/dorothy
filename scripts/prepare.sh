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
DO_NOT_TRACK=1 skills experimental_sync -y \
    --agent claude-code codex ${CI:+--no-remote}

# The sync exits 0 on a skipped skill, so the skills' checks fail instead.
bun test --bail agents.test.ts --test-name-pattern 'the skills'

bun scripts/agent-memory.ts
