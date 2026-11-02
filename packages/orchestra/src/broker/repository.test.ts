// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/repository.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { makeRepos, type Repos } from "../fixtures/repos.js";
import { resolveGit } from "./git.js";
import { openBroker } from "./repository.js";

describe("openBroker", () => {
    let repos: Repos;

    beforeEach(async () => {
        repos = await makeRepos();
    });

    afterEach(async () => {
        await rm(repos.root, { recursive: true, force: true });
    });

    const open = (localRemotes = true) =>
        openBroker({
            git: resolveGit(repos.env),
            env: repos.env,
            state: repos.state,
            checkout: repos.checkout,
            localRemotes,
        });

    const brokerConfig = (file: string) =>
        repos.git(["config", "--file", file, "--list"], repos.root).split("\n");

    it("makes a bare clone of the checkout, its config the broker's alone, gc and maintenance off", async () => {
        const broker = await open();
        expect(broker.identity).toBe("acme/widget");
        expect(broker.url).toBe(repos.remote);
        expect(broker.repo).toBe(
            join(repos.state, "repos", "acme", "widget.git"),
        );
        expect(repos.git(["rev-parse", "refs/heads/main"], broker.repo)).toBe(
            repos.localMain,
        );
        const config = brokerConfig(join(broker.repo, "config"));
        expect(config).toContain("core.bare=true");
        expect(config).toContain("gc.auto=0");
        expect(config).toContain("maintenance.auto=false");
        expect(config.some((line) => line.startsWith("remote."))).toBe(false);
    });

    it("makes it once, and never reads the checkout's objects again", async () => {
        const first = await open();
        repos.commit(repos.checkout, "three");
        const second = await open();
        expect(second.repo).toBe(first.repo);
        expect(repos.git(["rev-parse", "refs/heads/main"], second.repo)).toBe(
            repos.localMain,
        );
    });

    it("writes the broker's global config with the user's name and email", async () => {
        const broker = await open();
        const config = brokerConfig(
            join(repos.state, "repos", "acme", "widget.gitconfig"),
        );
        expect(config).toContain("user.name=Ada Lovelace");
        expect(config).toContain("user.email=ada@example.test");
        expect(config.some((line) => line.startsWith("credential."))).toBe(
            false,
        );
        expect(await broker.git.out(["config", "--global", "user.name"])).toBe(
            "Ada Lovelace",
        );
    });

    it("gives an https URL gh's credential helper", async () => {
        repos.git(
            ["remote", "set-url", "origin", "https://github.com/acme/widget"],
            repos.checkout,
        );
        await open(false);
        expect(
            brokerConfig(
                join(repos.state, "repos", "acme", "widget.gitconfig"),
            ),
        ).toContain(
            "credential.https://github.com.helper=!gh auth git-credential",
        );
    });

    it("refuses a checkout whose origin is no GitHub repository, making nothing", async () => {
        await expect(open(false)).rejects.toThrow(/GitHub/);
        expect(existsSync(join(repos.state, "repos"))).toBe(false);
    });
});
