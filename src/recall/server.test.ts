// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/recall/server.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { EMPTY_SIDECAR, sidecarPath } from "../memory/sidecar.js";
import { newPhrase } from "../session-id.js";
import { createRecallServer, type RecallServerOptions } from "./server.js";
import { RecallIndex } from "./store.js";
import type { OpenResult, RecollectResult, SearchResult } from "./types.js";

const A = newPhrase(() => Uint8Array.from([1, 1, 2, 3, 4, 5, 6, 7]));
const LIVE = newPhrase(() => Uint8Array.from([9, 1, 2, 3, 4, 5, 6, 7]));
const user = (text: string) =>
    `${JSON.stringify({ v: 1, kind: "user", at: "2026-10-04T12:00:00.000Z", text })}\n`;

let dir = "";
const indexes: RecallIndex[] = [];
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-server-"));
    await writeFile(join(dir, `${A}.jsonl`), user("the render bug again"));
    await writeFile(join(dir, `${LIVE}.jsonl`), user("render now"));
});
afterEach(async () => {
    for (const index of indexes.splice(0)) {
        index.close();
    }
    await rm(dir, { recursive: true, force: true });
});

async function connect(options: Partial<RecallServerOptions> = {}) {
    const server = createRecallServer({
        openIndex: () => {
            const index = RecallIndex.open(join(dir, "index", "recall.sqlite"));
            indexes.push(index);
            return index;
        },
        dir,
        exclude: LIVE,
        halfLifeDays: 30,
        ...options,
    });
    const [serverSide, clientSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(clientSide);
    return client;
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
    (result.content as { type: string; text: string }[])[0]?.text ?? "";

describe("the recall server", () => {
    it("offers search and open", async () => {
        const client = await connect();
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual([
            "open",
            "search",
        ]);
        expect(tools.every((tool) => (tool.description ?? "").length > 0)).toBe(
            true,
        );
    });

    it("searches what was written since it started", async () => {
        const client = await connect();
        const first = await client.callTool({
            name: "search",
            arguments: { query: "render" },
        });
        expect(first.isError).toBeFalsy();
        const found = JSON.parse(textOf(first)) as SearchResult;
        expect(found.results.map((hit) => hit.identifier)).toEqual([A]);
        const B = newPhrase(() => Uint8Array.from([2, 1, 2, 3, 4, 5, 6, 7]));
        await writeFile(join(dir, `${B}.jsonl`), user("render later"));
        const second = await client.callTool({
            name: "search",
            arguments: { query: "render" },
        });
        expect(
            (JSON.parse(textOf(second)) as SearchResult).results.length,
        ).toBe(2);
    });

    it("opens a conversation", async () => {
        const client = await connect();
        const result = await client.callTool({
            name: "open",
            arguments: { conversation: A, purpose: "the bug" },
        });
        const opened = JSON.parse(textOf(result)) as OpenResult;
        expect(opened.identifier).toBe(A);
        expect(opened.window).toHaveLength(1);
    });

    it("answers calls made at the same time", async () => {
        // Each call syncs under the lock and reads under it again, so a read
        // never sees rows another call's sync has half written.
        let locked = 0;
        const client = await connect({
            openIndex: () => {
                const index = RecallIndex.open(
                    join(dir, "index", "recall.sqlite"),
                );
                indexes.push(index);
                const exclusive = index.exclusive.bind(index);
                spyOn(index, "exclusive").mockImplementation(((
                    work: () => unknown,
                ) => {
                    locked++;
                    return exclusive(work);
                }) as typeof index.exclusive);
                return index;
            },
        });
        const [searched, opened] = await Promise.all([
            client.callTool({ name: "search", arguments: { query: "render" } }),
            client.callTool({
                name: "open",
                arguments: { conversation: A, purpose: "the bug" },
            }),
        ]);
        expect(searched.isError).toBeFalsy();
        expect(opened.isError).toBeFalsy();
        const found = JSON.parse(textOf(searched)) as SearchResult;
        expect(found.results.map((hit) => hit.identifier)).toEqual([A]);
        const read = JSON.parse(textOf(opened)) as OpenResult;
        expect(read.identifier).toBe(A);
        expect(read.window).toHaveLength(1);
        expect(locked).toBe(4);
    });

    it("answers a mistake with an error she can relay", async () => {
        const client = await connect();
        const missing = await client.callTool({
            name: "open",
            arguments: { conversation: LIVE, purpose: "p" },
        });
        expect(missing.isError).toBe(true);
        expect(textOf(missing)).toBe("No conversation by that name.");
        const empty = await client.callTool({
            name: "search",
            arguments: { query: "" },
        });
        expect(textOf(empty)).toBe("Give some words or tags to search for.");
    });

    it("reports an index it cannot open", async () => {
        const client = await connect({
            openIndex: () => {
                throw new Error("disk full");
            },
        });
        const result = await client.callTool({
            name: "search",
            arguments: { query: "render" },
        });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe("The memory index failed: disk full");
    });
});

describe("recollect on the server", () => {
    it("is offered only when asked for, and only with a phrase", async () => {
        const names = async (options: Partial<RecallServerOptions>) =>
            (await (await connect(options)).listTools()).tools
                .map((tool) => tool.name)
                .sort();
        expect(await names({})).toEqual(["open", "search"]);
        expect(await names({ recollect: true })).toEqual([
            "open",
            "recollect",
            "search",
        ]);
        expect(await names({ recollect: true, exclude: null })).toEqual([
            "open",
            "search",
        ]);
    });

    it("opens a cluster of the live conversation", async () => {
        await writeFile(
            sidecarPath(dir, LIVE),
            JSON.stringify({
                ...EMPTY_SIDECAR,
                clusters: [
                    {
                        from: 1,
                        through: 1,
                        abstract: "Rendering.",
                        at: "2026-10-04T12:00:00.000Z",
                        model: "m",
                    },
                ],
            }),
        );
        const client = await connect({ recollect: true });
        const opened = await client.callTool({
            name: "recollect",
            arguments: { cluster: 1 },
        });
        expect(opened.isError).toBeFalsy();
        const result = JSON.parse(textOf(opened)) as RecollectResult;
        expect(result.window.map((turn) => turn.text)).toEqual(["render now"]);
        const missing = await client.callTool({
            name: "recollect",
            arguments: { cluster: 2 },
        });
        expect(missing.isError).toBe(true);
        expect(textOf(missing)).toBe("No cluster by that number.");
    });

    it.each([1.5, 0, -1])(
        "refuses cluster %p, not a whole number from 1",
        async (value) => {
            await writeFile(
                join(dir, `${LIVE}.jsonl`),
                user("render now") + user("render later"),
            );
            const cluster = (turn: number) => ({
                from: turn,
                through: turn,
                abstract: `Turn ${turn}.`,
                at: "2026-10-04T12:00:00.000Z",
                model: "m",
            });
            await writeFile(
                sidecarPath(dir, LIVE),
                JSON.stringify({
                    ...EMPTY_SIDECAR,
                    clusters: [cluster(1), cluster(2)],
                }),
            );
            const client = await connect({ recollect: true });
            const refused = await client.callTool({
                name: "recollect",
                arguments: { cluster: value },
            });
            expect(refused.isError).toBe(true);
            expect(textOf(refused)).not.toContain("render");
            expect(textOf(refused)).not.toBe("No cluster by that number.");
            const opened = await client.callTool({
                name: "recollect",
                arguments: { cluster: 2 },
            });
            expect(opened.isError).toBeFalsy();
        },
    );
});
