// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/projects/identify.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { identify, localId, normaliseRemote, originUrl } from "./identify.js";

const ID = "github.com/chewygumxx/dorothy";

describe("normaliseRemote", () => {
    it.each([
        ["git@github.com:chewygumxx/dorothy.git", ID],
        ["https://github.com/chewygumxx/dorothy.git", ID],
        ["https://GitHub.com/chewygumxx/dorothy", ID],
        ["ssh://git@github.com:22/chewygumxx/dorothy.git/", ID],
        ["git://github.com/chewygumxx/dorothy", ID],
        [
            "https://gitlab.com/group/sub/project.git",
            "gitlab.com/group/sub/project",
        ],
    ])("reads %p as %p", (url, id) => {
        expect(normaliseRemote(url)).toBe(id);
    });

    it("drops the credentials a URL carries", () => {
        const id = normaliseRemote(
            "https://chewygumxx:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/chewygumxx/dorothy.git",
        );
        expect(id).toBe(ID);
    });

    it.each([
        "https://user:ghp_secret123@github.com/chewygumxx/dorothy.git",
        "https://a@b:ghp_secret123@github.com/chewygumxx/dorothy.git",
        "ssh://user:ghp_secret123@github.com:22/chewygumxx/dorothy.git",
        "user:ghp_secret123@github.com:chewygumxx/dorothy.git",
        "https://ghp_secret123@github.com/chewygumxx/dorothy.git",
        "https://github.com/chewygumxx/dorothy.git?token=ghp_secret123",
    ])("never lets the credentials of %p reach the id", (url) => {
        expect(normaliseRemote(url)).toBe(ID);
    });

    it.each([
        "https://user:ghp_secret123@github.com/",
        "https://user:ghp_secret123@github.com/%zz",
        "user:ghp_secret123@github.com",
        "user:ghp_secret123@host",
        "https://user:ghp_secret123@[::1]/a/b",
    ])("gives no id, and no secret, for the unusable %p", (url) => {
        const id = normaliseRemote(url);
        expect(id === null || !id.includes("ghp_secret123")).toBe(true);
    });

    it.each([
        "/srv/git/dorothy.git",
        "../dorothy",
        "file:///srv/git/dorothy.git",
        "https://github.com/",
        "git@github.com:../../etc",
        "",
    ])("finds no host in %p", (url) => {
        expect(normaliseRemote(url)).toBeNull();
    });
});

describe("originUrl", () => {
    it("reads the origin's url and no other remote's", () => {
        const config = [
            "[core]",
            "\tbare = false",
            '[remote "upstream"]',
            "\turl = https://example.com/upstream.git",
            '[remote "origin"]',
            "\t# a comment",
            '\turl = "git@github.com:chewygumxx/dorothy.git" ; trailing',
            "\tfetch = +refs/heads/*:refs/remotes/origin/*",
        ].join("\n");
        expect(originUrl(config)).toBe("git@github.com:chewygumxx/dorothy.git");
    });

    it("gives null with no origin", () => {
        expect(originUrl('[remote "upstream"]\n\turl = x\n')).toBeNull();
    });
});

describe("identify", () => {
    let base = "";
    beforeEach(async () => {
        base = await realpath(
            await mkdtemp(join(tmpdir(), "dorothy-identify-")),
        );
    });
    afterEach(async () => {
        await rm(base, { recursive: true, force: true });
    });

    const repo = async (dir: string, config: string) => {
        await mkdir(join(dir, ".git"), { recursive: true });
        await writeFile(join(dir, ".git", "config"), config);
    };

    it("finds the repository a path is in, by its origin", async () => {
        const root = join(base, "dorothy");
        await repo(
            root,
            '[remote "origin"]\n\turl = git@github.com:chewygumxx/dorothy.git\n',
        );
        await mkdir(join(root, "packages", "memory"), { recursive: true });
        expect(await identify(join(root, "packages", "memory"))).toEqual({
            root,
            id: ID,
            name: "dorothy",
        });
    });

    it("follows a worktree's .git file to the shared config", async () => {
        const main = join(base, "main");
        await repo(
            main,
            '[remote "origin"]\n\turl = https://github.com/chewygumxx/dorothy\n',
        );
        const gitdir = join(main, ".git", "worktrees", "wt");
        await mkdir(gitdir, { recursive: true });
        await writeFile(join(gitdir, "commondir"), "../..\n");
        const tree = join(base, "wt");
        await mkdir(tree);
        await writeFile(join(tree, ".git"), `gitdir: ${gitdir}\n`);
        expect((await identify(tree))?.id).toBe(ID);
    });

    it("names a repository with no origin by its root", async () => {
        const root = join(base, "scratch");
        await repo(root, "[core]\n\tbare = false\n");
        expect(await identify(root)).toEqual({
            root,
            id: localId(root),
            name: "scratch",
        });
        expect(localId(root)).toMatch(/^local-[0-9a-f]{12}$/);
    });

    it("keeps a credentialed origin's token out of the project", async () => {
        const root = join(base, "private");
        await repo(
            root,
            '[remote "origin"]\n\turl = https://me:ghp_secret123@github.com/chewygumxx/dorothy.git\n',
        );
        const project = await identify(root);
        expect(project?.id).toBe(ID);
        expect(JSON.stringify(project)).not.toContain("ghp_secret123");
    });

    it("gives a local id when the credentialed origin is unusable", async () => {
        const root = join(base, "odd");
        await repo(
            root,
            '[remote "origin"]\n\turl = https://me:ghp_secret123@host/%zz\n',
        );
        const project = await identify(root);
        expect(project?.id).toBe(localId(root));
        expect(JSON.stringify(project)).not.toContain("ghp_secret123");
    });

    it("gives null outside any repository", async () => {
        expect(await identify(base)).toBeNull();
    });
});
