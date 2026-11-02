// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/identity.ts
//
//

// A repository's identity, <owner>/<name>, from its main checkout's
// origin URL as written: read from the checkout's own config file alone,
// no include followed, and only in one of GitHub's forms. Every fetch,
// push and pull request of its workers names that URL and that identity.

import { basename, dirname, isAbsolute, join } from "node:path";
import type { Git } from "./git.js";

const GITHUB =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/)([^/]+)\/([^/]+)$/;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const NAME = /^[A-Za-z0-9._-]+$/;

const named = (owner: string, raw: string): string | null => {
    const name = raw.replace(/\.git$/, "");
    return OWNER.test(owner) && NAME.test(name) && !/^\.*$/.test(name)
        ? `${owner}/${name}`
        : null;
};

// localRemotes, for tests alone, admits a bare repository by its
// absolute path, <...>/<owner>/<name>.git.
export function repoIdentity(url: string, localRemotes = false): string | null {
    const github = GITHUB.exec(url);
    if (github) {
        return named(github[1] ?? "", github[2] ?? "");
    }
    return localRemotes && isAbsolute(url)
        ? named(basename(dirname(url)), basename(url))
        : null;
}

export type Identity = { identity: string; url: string };

export async function readIdentity(
    git: Git,
    checkout: string,
    localRemotes = false,
    signal?: AbortSignal,
): Promise<Identity> {
    const result = await git.run(
        [
            "config",
            "--file",
            join(checkout, ".git", "config"),
            "--get",
            "remote.origin.url",
        ],
        undefined,
        signal,
    );
    const url = result.stdout.trim();
    if (result.code !== 0 || url === "") {
        throw new Error(`${checkout} is no git checkout with an origin`);
    }
    const identity = repoIdentity(url, localRemotes);
    if (identity === null) {
        throw new Error(`${checkout}'s origin names no GitHub repository`);
    }
    return { identity, url };
}
