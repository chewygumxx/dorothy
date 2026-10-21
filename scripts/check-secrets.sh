#!/usr/bin/env sh
# vim:set expandtab shiftwidth=4 filetype=sh:
# SPDX-License-Identifier: GPL-3.0-only

#
#
# ~chewygumxx/dorothy.git
# ::: :/scripts/check-secrets.sh
#
#

# One policy for the index at commit time and tracked working files in CI.
# Print file names and rules only; parsers and readers must stay silent.

reject() {
    printf 'secrets: %s: %s\n' "$1" "$2" >&2
    return 1
}

read_content() {
    if [ "$mode" = staged ]; then
        git show ":$1" 2>/dev/null
    elif [ -L "$1" ]; then
        # A tracked symlink's content is its target path, not the target file.
        readlink -- "$1" 2>/dev/null
    else
        cat -- "$1" 2>/dev/null
    fi
}

check_file() {
    case "${1##*/}" in
        .env | .env.* | *.env)
            reject "$1" 'env file names are prohibited'
            return 1
            ;;
    esac

    if [ "$mode" = staged ]; then
        git cat-file -e ":$1" >/dev/null 2>&1 || {
            reject "$1" 'cannot read staged content'
            return 1
        }
    elif [ ! -L "$1" ] && { [ ! -f "$1" ] || [ ! -r "$1" ]; }; then
        reject "$1" 'cannot read tracked content'
        return 1
    fi

    case "${1##*/}" in
        secrets.json)
            if ! read_content "$1" | jq -e -s '
                length == 1 and (.[0] |
                    type == "object" and (.sops | type == "object") and
                    all(to_entries[];
                        .key == "sops" or
                        (.value | type == "string" and startswith("ENC["))))
            ' >/dev/null 2>&1; then
                reject "$1" 'encrypted JSON with a top-level sops object is required'
                return 1
            fi
            ;;
    esac

    # Match a key shape, not prose that merely names its prefix.
    if read_content "$1" | grep -aE 'AGE-SECRET-KEY-1[02-9ACDEFGHJKLMNPQRSTUVWXYZ]{58}' >/dev/null 2>&1; then
        reject "$1" 'age private key content is prohibited'
        return 1
    fi
}

if ! command -v jq >/dev/null 2>&1; then
    reject '<repository>' 'jq is required for secrets validation'
    exit 1
fi
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    reject '<repository>' 'secrets validation requires a git working tree'
    exit 1
fi

case "${1:---tracked}" in
    --check)
        mode=$2
        shift 2
        status=0
        for file do
            check_file "$file" || status=1
        done
        exit "$status"
        ;;
    --staged | --tracked)
        script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
        if [ "${1:---tracked}" = --staged ]; then
            git diff --cached --name-only --diff-filter=ACMR -z |
                xargs -0 -r sh "$script_dir/check-secrets.sh" --check staged
        else
            git ls-files -z |
                xargs -0 -r sh "$script_dir/check-secrets.sh" --check tracked
        fi
        ;;
    *)
        reject '<arguments>' 'use --staged or --tracked'
        exit 1
        ;;
esac
