// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/broker/pull-request.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { makeRepos, type Repos } from "../fixtures/repos.js";
import { resolveGit } from "./git.js";
import {
    openPullRequest,
    reconcilePullRequest,
    resolveGh,
} from "./pull-request.js";
import { type Broker, openBroker } from "./repository.js";

const URL = "https://github.com/acme/widget/pull/7";

describe("the broker's pull requests", () => {
    let repos: Repos;
    let broker: Broker;
    let dir: string;
    let gh: string;

    // A fake gh: it logs its directory, its arguments and the broker's
    // config, then answers by the files beside it.
    beforeEach(async () => {
        repos = await makeRepos();
        broker = await openBroker({
            git: resolveGit(repos.env),
            env: { ...repos.env, GH_TOKEN: "not for gh" },
            state: repos.state,
            checkout: repos.checkout,
            localRemotes: true,
        });
        dir = join(repos.root, "gh");
        await mkdir(dir);
        gh = join(dir, "gh");
        await writeFile(
            gh,
            `#!/bin/sh
d=${dir}
printf '%s\\n' "$PWD" "$GIT_CONFIG_GLOBAL" "\${GH_TOKEN:-none}" "$@" > "$d/log.$2"
case "$2" in
create)
    [ -e "$d/hang" ] && sleep 30
    [ -e "$d/fail" ] && { echo "no such branch" >&2; exit 1; }
    echo ${URL}
    ;;
list)
    [ -e "$d/list" ] || exit 1
    cat "$d/list"
    ;;
esac
`,
        );
        await chmod(gh, 0o755);
    });

    afterEach(async () => {
        await rm(repos.root, { recursive: true, force: true });
    });

    const logOf = async (command: string) =>
        (await readFile(join(dir, `log.${command}`), "utf8")).split("\n");

    const open = (deadline?: number) =>
        openPullRequest(broker, {
            gh,
            branch: "feature",
            title: "Add the feature",
            body: "Body\nof the request",
            deadline,
        });

    it("resolves gh from PATH once, or fails", () => {
        expect(resolveGh({ PATH: dir })).toBe(gh);
        expect(() => resolveGh({ PATH: repos.root })).toThrow(/gh/);
    });

    it("runs gh pr create for the branch in the broker repository", async () => {
        expect(await open()).toEqual({ status: "succeeded", detail: URL });
        expect(await logOf("create")).toEqual([
            broker.repo,
            join(repos.state, "repos", "acme", "widget.gitconfig"),
            "none",
            "pr",
            "create",
            "--repo",
            "acme/widget",
            "--head",
            "feature",
            "--title",
            "Add the feature",
            "--body",
            "Body",
            "of the request",
            "",
        ]);
    });

    it("fails with gh's reason", async () => {
        await writeFile(join(dir, "fail"), "");
        expect(await open()).toEqual({
            status: "failed",
            detail: "no such branch",
        });
    });

    describe("reconciliation", () => {
        const list = (requests: object[]) =>
            writeFile(join(dir, "list"), JSON.stringify(requests));

        it("lists the branch's pull requests on the repository", async () => {
            await list([]);
            await reconcilePullRequest(broker, { gh, branch: "feature" });
            expect((await logOf("list")).slice(3, -1)).toEqual([
                "pr",
                "list",
                "--repo",
                "acme/widget",
                "--head",
                "feature",
                "--state",
                "all",
                "--json",
                "url,isCrossRepository",
            ]);
        });

        it("is succeeded where the repository shows the pull request", async () => {
            await list([{ url: URL, isCrossRepository: false }]);
            expect(
                await reconcilePullRequest(broker, { gh, branch: "feature" }),
            ).toEqual({ status: "succeeded", detail: URL });
        });

        it("is failed where it shows none of the repository's own", async () => {
            await list([
                {
                    url: "https://github.com/acme/widget/pull/3",
                    isCrossRepository: true,
                },
            ]);
            expect(
                (await reconcilePullRequest(broker, { gh, branch: "feature" }))
                    .status,
            ).toBe("failed");
        });

        it("is unknown where gh cannot tell", async () => {
            expect(
                (await reconcilePullRequest(broker, { gh, branch: "feature" }))
                    .status,
            ).toBe("unknown");
            await writeFile(join(dir, "list"), "not json");
            expect(
                (await reconcilePullRequest(broker, { gh, branch: "feature" }))
                    .status,
            ).toBe("unknown");
        });

        it("reconciles a pull request whose gh passed its deadline", async () => {
            await writeFile(join(dir, "hang"), "");
            await list([{ url: URL, isCrossRepository: false }]);
            expect(await open(500)).toEqual({
                status: "succeeded",
                detail: URL,
            });
            await list([]);
            expect((await open(500)).status).toBe("failed");
        });
    });
});
