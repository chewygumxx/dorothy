// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/repository.ts
//
//

// The broker repository: one per identity, a bare clone of the main
// checkout made at its first use, holding every object its workers'
// clones borrow, so with gc and maintenance off and no remote of its
// own. After it is made, nothing reads the checkout again but its
// origin's URL. Beside it, the broker's global config: the user's name
// and email and, for an https URL, gh's credential helper.

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type Env, xdgDir } from "@dorothy/core";
import { type Git, sealedEnvironment, sealedGit } from "./git.js";
import { readIdentity } from "./identity.js";

export type BrokerDeps = {
    // resolveGit's, at the server's start.
    git: string;
    // The server's environment.
    env: Env;
    // $XDG_STATE_HOME/dorothy/orchestra.
    state: string;
    // start_worker's repo.
    checkout: string;
    deadline?: number;
    // Tests alone: a local bare remote as origin.
    localRemotes?: boolean;
};

export type Broker = {
    identity: string;
    // The remote's URL, which every fetch and push names.
    url: string;
    state: string;
    repo: string;
    // Sealed, in the broker repository.
    git: Git;
    // The sealed environment, which gh shares.
    env: Record<string, string>;
};

const quoted = (value: string) =>
    `"${value.replace(/[\\"]/g, "\\$&").replace(/\n/g, "\\n")}"`;

// user.name and user.email from the user's global config, includes and
// all, read by file so that nothing else of it applies.
async function userOf(reader: Git, env: Env): Promise<Map<string, string>> {
    const user = new Map<string, string>();
    for (const file of [
        join(xdgDir(env, "XDG_CONFIG_HOME", ".config"), "git", "config"),
        join(env.HOME ?? "/", ".gitconfig"),
    ]) {
        const result = await reader.run([
            "config",
            "--file",
            file,
            "--includes",
            "--get-regexp",
            "^user\\.(name|email)$",
        ]);
        for (const line of result.stdout.split("\n")) {
            const [, key, value] = /^user\.(name|email) (.*)$/.exec(line) ?? [];
            if (key !== undefined && value !== undefined) {
                user.set(key, value);
            }
        }
    }
    return user;
}

function globalConfig(user: Map<string, string>, url: string): string {
    let text = "[user]\n";
    for (const [key, value] of user) {
        text += `\t${key} = ${quoted(value)}\n`;
    }
    if (url.startsWith("https://")) {
        text += `[credential "https://github.com"]\n\thelper = ${quoted("!gh auth git-credential")}\n`;
    }
    return text;
}

// Written whole, then renamed into place, as another launch may be
// reading it.
async function replace(path: string, text: string): Promise<void> {
    const temp = `${path}.${randomUUID()}`;
    await writeFile(temp, text);
    await rename(temp, path);
}

// Made aside, then renamed into place: a launch that dies midway leaves
// no half repository, and of two launches at once, one's is kept.
async function makeRepository(git: Git, checkout: string, repo: string) {
    const temp = `${repo}.${randomUUID()}`;
    await git.out(
        [
            "clone",
            "--bare",
            "--no-local",
            "--config",
            "gc.auto=0",
            "--config",
            "maintenance.auto=false",
            "--",
            checkout,
            temp,
        ],
        dirname(repo),
    );
    await git.out(["config", "--remove-section", "remote.origin"], temp);
    try {
        await rename(temp, repo);
    } catch (error) {
        await rm(temp, { recursive: true, force: true });
        if (!existsSync(repo)) {
            throw error;
        }
    }
}

export async function openBroker(deps: BrokerDeps): Promise<Broker> {
    const { git: path, env, state, deadline } = deps;
    const reader = sealedGit({
        git: path,
        env,
        config: "/dev/null",
        cwd: state,
        deadline,
    });
    const { identity, url } = await readIdentity(
        reader,
        deps.checkout,
        deps.localRemotes,
    );
    const repo = join(state, "repos", `${identity}.git`);
    const config = join(state, "repos", `${identity}.gitconfig`);
    await mkdir(dirname(repo), { recursive: true });
    await replace(config, globalConfig(await userOf(reader, env), url));
    const git = sealedGit({ git: path, env, config, cwd: repo, deadline });
    if (!existsSync(repo)) {
        await makeRepository(git, deps.checkout, repo);
    }
    return {
        identity,
        url,
        state,
        repo,
        git,
        env: sealedEnvironment(env, config),
    };
}
