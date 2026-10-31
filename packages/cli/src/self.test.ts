// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/self.test.ts
//
//

import { expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { mainEntry, runForwarding, shellWord } from "./self.js";

it("quotes a word for a shell", () => {
    expect(shellWord("it's")).toBe(`'it'\\''s'`);
});

it("finds the main checkout's entry from a worktree", () => {
    const git = (args: string[]) =>
        args.includes("--git-common-dir") ? "/home/u/dev/dorothy/.git" : null;
    expect(
        mainEntry(
            "/home/u/dev/_worktree/dorothy/x/packages/cli/src/index.ts",
            (args) =>
                args.includes("--show-toplevel")
                    ? "/home/u/dev/_worktree/dorothy/x"
                    : git(args),
        ),
    ).toBe("/home/u/dev/dorothy/packages/cli/src/index.ts");
});

it("answers null outside a repository", () => {
    expect(mainEntry("/opt/dorothy/index.ts", () => null)).toBeNull();
});

it("forwards TERM and HUP to the child, not INT, then lets go", async () => {
    const signals = new EventEmitter();
    const killed: (string | undefined)[] = [];
    let exit = (_code: number) => {};
    const seen: unknown[][] = [];
    const run = runForwarding(
        (cmd, env, cwd) => {
            seen.push([cmd, env, cwd]);
            return {
                exited: new Promise<number>((resolve) => {
                    exit = resolve;
                }),
                kill: (signal) => {
                    killed.push(signal);
                },
            };
        },
        ["host"],
        { A: "1" },
        signals,
        "/w",
    );
    signals.emit("SIGTERM");
    signals.emit("SIGHUP");
    signals.emit("SIGINT");
    expect(killed).toEqual(["SIGTERM", "SIGHUP"]);
    expect(signals.listenerCount("SIGINT")).toBe(1);
    exit(7);
    expect(await run).toBe(7);
    expect(seen).toEqual([[["host"], { A: "1" }, "/w"]]);
    for (const name of ["SIGINT", "SIGTERM", "SIGHUP"]) {
        expect(signals.listenerCount(name)).toBe(0);
    }
});
