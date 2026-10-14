#!/usr/bin/env sh
# vim:set expandtab shiftwidth=4 filetype=sh:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/scripts/prepare.sh
#
#

# Runs on every `bun install`, as package.json's prepare. A production
# install has no development dependencies, so no hooks, skills or agent
# memory to set up, and does nothing.

set -e

[ -d node_modules/husky ] || exit 0

husky
bun run skills --no-remote

# The sync logs a skill it skips, such as one whose destination is a link
# elsewhere, and still exits 0, so the skills' own checks fail the install
# instead.
bun test --bail agents.test.ts --test-name-pattern 'the skills'

bun scripts/agent-memory.ts
