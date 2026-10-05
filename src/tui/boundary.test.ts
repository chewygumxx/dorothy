// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/boundary.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { Glob } from "bun";

describe("the TUI", () => {
    it("imports nothing from the Agent SDK", async () => {
        const importers: string[] = [];
        for await (const path of new Glob("*.{ts,tsx}").scan(import.meta.dir)) {
            const text = await Bun.file(`${import.meta.dir}/${path}`).text();
            if (
                path !== import.meta.file &&
                text.includes("@anthropic-ai/claude-agent-sdk")
            ) {
                importers.push(path);
            }
        }
        expect(importers.sort()).toEqual([]);
    });

    it("leaves memory to run.tsx, which wires it in", async () => {
        const importers: string[] = [];
        for await (const path of new Glob("*.{ts,tsx}").scan(import.meta.dir)) {
            const text = await Bun.file(`${import.meta.dir}/${path}`).text();
            if (path !== import.meta.file && text.includes("../memory/")) {
                importers.push(path);
            }
        }
        expect(importers.sort()).toEqual(["run.tsx"]);
    });
});
