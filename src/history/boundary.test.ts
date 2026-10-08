// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/boundary.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { join } from "node:path";
import { Glob } from "bun";

// Every source file under a directory, nested ones included, this one
// aside.
async function sources(dir: string): Promise<{ path: string; text: string }[]> {
    const files: { path: string; text: string }[] = [];
    for await (const path of new Glob("**/*.ts").scan(dir)) {
        const full = join(dir, path);
        if (full !== join(import.meta.dir, import.meta.file)) {
            files.push({ path, text: await Bun.file(full).text() });
        }
    }
    return files;
}

const importing = async (dir: string, pattern: RegExp) =>
    (await sources(dir))
        .filter(({ text }) => pattern.test(text))
        .map(({ path }) => path);

describe("history", () => {
    it("imports nothing from the Agent SDK", async () => {
        expect(
            await importing(import.meta.dir, /@anthropic-ai\/claude-agent-sdk/),
        ).toEqual([]);
    });

    it("imports nothing from the TUI", async () => {
        expect(await importing(import.meta.dir, /from "\.\.\/tui\//)).toEqual(
            [],
        );
    });

    // Memory's writers record through what they are given; only
    // open.ts, which wires the chat, gives it to them.
    it("is imported in memory by open.ts alone", async () => {
        expect(
            await importing(
                join(import.meta.dir, "..", "memory"),
                /from "\.\.\/history\//,
            ),
        ).toEqual(["open.ts"]);
    });
});
