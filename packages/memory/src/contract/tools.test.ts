// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/tools.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RecallIndex } from "../recall/store.js";
import { fakeEngine, knowledge } from "./testing.js";
import { createContractServer, INSTRUCTIONS } from "./tools.js";

let root: string;
let index: RecallIndex;
let client: Client;
const engine = fakeEngine({
    knowledge: [knowledge("likes-tea")],
    hits: [
        {
            id: "k:personal/likes-tea",
            kind: "knowledge",
            scope: "personal",
            title: "likes-tea",
            snippet: "Tea.",
        },
    ],
});

beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "dorothy-tools-"));
    index = RecallIndex.open(join(root, "recall.sqlite"));
    const server = createContractServer({
        engine,
        index,
        store: { root, lock: index.lock, recorder: null },
        project: null,
        host: "codex",
        resolveProject: async (value) => value,
    });
    const [near, far] = InMemoryTransport.createLinkedPair();
    await server.connect(near);
    client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(far);
});
afterEach(async () => {
    await client.close();
    index.close();
    rmSync(root, { recursive: true, force: true });
});

const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: { type: string; text: string }[];
    };
    return {
        isError: result.isError === true,
        text: result.content[0]?.text ?? "",
    };
};

describe("the contract's MCP server", () => {
    it("offers four tools and short instructions", async () => {
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual([
            "brief",
            "open",
            "remember",
            "search",
        ]);
        expect(client.getInstructions()).toBe(INSTRUCTIONS);
        expect(INSTRUCTIONS.length).toBeLessThan(512);
    });

    it("briefs with the opening block", async () => {
        const { isError, text } = await call("brief", {});
        expect(isError).toBe(false);
        expect(JSON.parse(text).text).toContain("likes-tea");
    });

    it("searches within personal and the connection's project", async () => {
        const { text } = await call("search", { query: "tea" });
        expect(JSON.parse(text)[0].id).toBe("k:personal/likes-tea");
        expect(engine.calls).toContain("search tea");
    });

    it("says there is no project for a project search outside one", async () => {
        const { isError, text } = await call("search", {
            query: "tea",
            scope: "project",
        });
        expect(isError).toBe(true);
        expect(text).toContain("no project here");
    });

    it("refuses to open what is no memory id", async () => {
        const { isError, text } = await call("open", { id: "likes-tea" });
        expect(isError).toBe(true);
        expect(text).toContain("is not a memory id");
    });

    it("refuses a traversal-shaped id", async () => {
        for (const id of ["k:personal/../../etc/passwd", "k:projects/../x"]) {
            const { isError, text } = await call("open", { id });
            expect(isError).toBe(true);
            expect(text).toContain("is not a memory id");
        }
    });

    it("remembers into knowledge/", async () => {
        const { text } = await call("remember", {
            action: "add",
            title: "Likes tea",
            text: "Tea at four.",
            type: "user",
            scope: "personal",
        });
        expect(JSON.parse(text)).toEqual({
            id: "k:personal/likes-tea",
            status: "added",
        });
        expect(existsSync(join(root, "knowledge/personal/likes-tea.md"))).toBe(
            true,
        );
    });
});
