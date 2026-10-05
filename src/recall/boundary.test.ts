// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/recall/boundary.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { Glob } from "bun";

// Direct imports only, like src/tui/boundary.test.ts; the memory modules
// recall may use import nothing from the SDK either.
async function sources(): Promise<{ path: string; text: string }[]> {
    const files: { path: string; text: string }[] = [];
    for await (const path of new Glob("*.ts").scan(import.meta.dir)) {
        if (path !== import.meta.file) {
            files.push({
                path,
                text: await Bun.file(`${import.meta.dir}/${path}`).text(),
            });
        }
    }
    return files;
}

describe("recall", () => {
    it("imports nothing from the Agent SDK", async () => {
        const importers = (await sources())
            .filter(({ text }) =>
                text.includes("@anthropic-ai/claude-agent-sdk"),
            )
            .map(({ path }) => path);
        expect(importers).toEqual([]);
    });

    it("leaves MCP to server.ts", async () => {
        const importers = (await sources())
            .filter(
                ({ path, text }) =>
                    !path.endsWith(".test.ts") &&
                    text.includes("@modelcontextprotocol/sdk"),
            )
            .map(({ path }) => path);
        expect(importers).toEqual(["server.ts"]);
    });

    it("uses only the catalogue's SDK-free modules", async () => {
        const used = new Set<string>();
        for (const { text } of await sources()) {
            for (const [, module] of text.matchAll(
                /from "\.\.\/memory\/([^"]+)"/g,
            )) {
                used.add(module as string);
            }
        }
        expect(
            [...used].every((module) =>
                ["sidecar.js", "rank.js"].includes(module),
            ),
        ).toBe(true);
    });
});
