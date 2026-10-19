// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/header.ts
//
//

// Which files must carry the house header. `sync-header-metadata` keeps an
// existing header's repository and path honest but passes a file with none,
// so this names the types whose files must have one.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The types whose files carry the header; JSON, lockfiles, dotfiles and
// the like cannot, or never did.
const HEADED = /\.(ts|tsx|mts|sh|toml|ya?ml|jsonc|md)$/;

// Headed types that are not the repository's own writing: captured probe
// scripts, agent memory entries (written by Dorothy's project sync and by
// clients' memory, in their own format) and the template GitHub reads.
const EXEMPT = [
    /^docs\/reports\/.+\/probe\//,
    /^\.agents\/memory\//,
    /^\.github\/pull_request_template\.md$/,
];

// `sync-header-metadata` looks for its markers in a file's first 32 lines.
const HEADER_LINES = 32;

export const isHeaded = (path: string): boolean =>
    HEADED.test(path) && !EXEMPT.some((exempt) => exempt.test(path));

// The files of the headed types that lack the breadcrumb for their own
// path. A listed file that no longer exists is skipped.
export const missingHeaders = (root: string, files: string[]): string[] =>
    files.filter((file) => {
        if (!isHeaded(file) || !existsSync(join(root, file))) {
            return false;
        }
        const head = readFileSync(join(root, file), "utf8")
            .split("\n", HEADER_LINES)
            .map((line) => line.trimEnd());
        return !head.some((line) => line.endsWith(`::: :/${file}`));
    });
