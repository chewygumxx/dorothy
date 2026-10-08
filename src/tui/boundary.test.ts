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
        // App.test.tsx reads the scripted chat while App still records it.
        expect(importers.sort()).toEqual(["App.test.tsx", "run.tsx"]);
    });

    it("leaves compaction to run.tsx, which wires it in", async () => {
        const importers: string[] = [];
        for await (const path of new Glob("*.{ts,tsx}").scan(import.meta.dir)) {
            const text = await Bun.file(`${import.meta.dir}/${path}`).text();
            if (path !== import.meta.file && text.includes("../compaction/")) {
                importers.push(path);
            }
        }
        expect(importers.sort()).toEqual(["run.tsx"]);
    });

    it("leaves history to run.tsx, which wires it in", async () => {
        const importers: string[] = [];
        for await (const path of new Glob("*.{ts,tsx}").scan(import.meta.dir)) {
            const text = await Bun.file(`${import.meta.dir}/${path}`).text();
            if (path !== import.meta.file && text.includes("../history/")) {
                importers.push(path);
            }
        }
        expect(importers.sort()).toEqual(["run.tsx"]);
    });

    it("leaves recall to run.tsx, but for its types", async () => {
        const importers: string[] = [];
        for await (const path of new Glob("*.{ts,tsx}").scan(import.meta.dir)) {
            const text = await Bun.file(`${import.meta.dir}/${path}`).text();
            const modules = [
                ...text.matchAll(/from "\.\.\/recall\/([^"]+)"/g),
            ].map(([, module]) => module);
            if (
                path !== import.meta.file &&
                modules.some((module) => module !== "types.js")
            ) {
                importers.push(path);
            }
        }
        expect(importers.sort()).toEqual(["run.tsx"]);
    });
});
