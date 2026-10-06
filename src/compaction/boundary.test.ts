// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/compaction/boundary.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { Glob } from "bun";

describe("compaction", () => {
    it("imports nothing from the Agent SDK", async () => {
        const importers: string[] = [];
        for await (const path of new Glob("*.ts").scan(import.meta.dir)) {
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

    it("reaches the SDK only through what it is given", async () => {
        const importers: string[] = [];
        for await (const path of new Glob("*.ts").scan(import.meta.dir)) {
            const text = await Bun.file(`${import.meta.dir}/${path}`).text();
            if (
                path !== import.meta.file &&
                /from "\.\.\/(structured|conversation|memory\/review|memory\/service)\.js"/.test(
                    text.replaceAll(/import type [^;]+;/g, ""),
                )
            ) {
                importers.push(path);
            }
        }
        expect(importers.sort()).toEqual([]);
    });
});
