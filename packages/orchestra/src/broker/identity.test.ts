// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/identity.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeRepos, type Repos } from "../fixtures/repos.js";
import { resolveGit, sealedGit } from "./git.js";
import { readIdentity, repoIdentity } from "./identity.js";

describe("repoIdentity", () => {
    it.each([
        ["git@github.com:acme/widget.git", "acme/widget"],
        ["git@github.com:acme/widget", "acme/widget"],
        ["ssh://git@github.com/acme/widget.git", "acme/widget"],
        ["ssh://git@github.com/acme/widget", "acme/widget"],
        ["https://github.com/acme/widget.git", "acme/widget"],
        ["https://github.com/Acme-2/my.widget_x", "Acme-2/my.widget_x"],
    ])("takes %s as %s", (url, identity) => {
        expect(repoIdentity(url)).toBe(identity);
    });

    it.each([
        "http://github.com/acme/widget",
        "https://github.com.evil.test/acme/widget",
        "https://user@github.com/acme/widget",
        "https://gitlab.com/acme/widget",
        "git@github.com:acme/widget/extra",
        "ssh://git@github.com:22/acme/widget",
        "git@github.com:-acme/widget",
        "git@github.com:acme/..",
        "git@github.com:acme/.git",
        "https://github.com/acme/widget.git/",
        "/srv/remotes/acme/widget.git",
    ])("refuses %s", (url) => {
        expect(repoIdentity(url)).toBeNull();
    });

    it("admits a local bare remote only when asked, as tests do", () => {
        expect(repoIdentity("/srv/remotes/acme/widget.git", true)).toBe(
            "acme/widget",
        );
        expect(repoIdentity("relative/acme/widget.git", true)).toBeNull();
    });
});

describe("readIdentity", () => {
    let repos: Repos;

    beforeEach(async () => {
        repos = await makeRepos();
    });

    afterEach(async () => {
        await rm(repos.root, { recursive: true, force: true });
    });

    const git = () =>
        sealedGit({
            git: resolveGit(repos.env),
            env: repos.env,
            config: "/dev/null",
            cwd: repos.state,
        });

    it("reads origin's URL as written, no include followed", async () => {
        const other = join(repos.root, "other.gitconfig");
        await writeFile(
            other,
            '[remote "origin"]\n\turl = https://github.com/evil/other\n',
        );
        repos.git(
            ["remote", "set-url", "origin", "https://github.com/acme/widget"],
            repos.checkout,
        );
        repos.git(["config", "include.path", other], repos.checkout);
        expect(await readIdentity(git(), repos.checkout)).toEqual({
            identity: "acme/widget",
            url: "https://github.com/acme/widget",
        });
    });

    it("refuses an origin that names no GitHub repository", async () => {
        repos.git(
            ["remote", "set-url", "origin", "https://gitlab.com/acme/widget"],
            repos.checkout,
        );
        await expect(readIdentity(git(), repos.checkout)).rejects.toThrow(
            /GitHub/,
        );
    });

    it("refuses a directory that is no checkout", async () => {
        await expect(readIdentity(git(), repos.root)).rejects.toThrow(/origin/);
    });

    it("refuses a local remote unless asked", async () => {
        await expect(readIdentity(git(), repos.checkout)).rejects.toThrow(
            /GitHub/,
        );
        expect(await readIdentity(git(), repos.checkout, true)).toEqual({
            identity: "acme/widget",
            url: repos.remote,
        });
    });
});
