#!/usr/bin/env sh
# vim:set expandtab shiftwidth=4 filetype=sh:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/scripts/with-files.sh
#
#

# Usage: with-files.sh [--staged] [<pathspec>...] -- <command> [<arg>...]
#
# Runs the command with the tracked files matching the pathspecs appended,
# or with --staged, the staged files added, copied, modified or renamed.
# No pathspec means every file. Runs nothing when no file matches. Each
# path starts ./, so no tool reads a file named -x as an option.

set -eu

usage() {
    echo 'usage: with-files.sh [--staged] [<pathspec>...] -- <command> [<arg>...]' >&2
    exit 2
}

staged=
if [ "${1-}" = --staged ]; then
    staged=1
    shift
fi

# Lists the files matching the arguments before --, NUL-separated.
list() {
    count=$#
    keep=1
    while [ "$count" -gt 0 ]; do
        arg=$1
        shift
        count=$((count - 1))
        [ "$arg" = -- ] && keep=
        [ -n "$keep" ] && set -- "$@" "$arg"
    done
    if [ -n "$staged" ]; then
        git diff -z --cached --name-only --diff-filter=ACMR \
            --line-prefix=./ -- "$@"
    else
        git ls-files -z --format='./%(path)' -- "$@"
    fi
}

for arg; do
    [ "$arg" = -- ] && break
done
[ "${arg-}" = -- ] || usage

files=$(mktemp)
trap 'rm -f "$files"' EXIT
list "$@" >"$files"

while [ "$1" != -- ]; do
    shift
done
shift
[ $# -gt 0 ] || usage

[ -s "$files" ] || exit 0
xargs -0 "$@" <"$files"
