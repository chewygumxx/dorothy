// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recall/server.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    newPhrase,
    type OpenFactResult,
    type OpenResult,
    type RecollectResult,
    type SearchResult,
    type TagsResult,
} from "@dorothy/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { factPath, PERSONAL, putFact, readFactFile } from "../facts/store.js";
import { EMPTY_SIDECAR, sidecarPath } from "../memory/sidecar.js";
import {
    createRecallServer,
    inSequence,
    type RecallServerOptions,
} from "./server.js";
import { RecallIndex } from "./store.js";

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

describe("inSequence", () => {
    it("runs calls one at a time, and goes on after one rejects", async () => {
        const inOrder = inSequence();
        const seen: string[] = [];
        const slow = inOrder(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            seen.push("slow");
            return "slow";
        });
        const failed = inOrder(async () => {
            seen.push("failed");
            throw new Error("boom");
        });
        const after = inOrder(async () => {
            seen.push("after");
            return "after";
        });
        expect(await slow).toBe("slow");
        await expect(failed).rejects.toThrow("boom");
        expect(await after).toBe("after");
        expect(seen).toEqual(["slow", "failed", "after"]);
        expect(await inOrder(async () => "later")).toBe("later");
    });
});

describe("the recall server", () => {
    it("offers search and open", async () => {
        const client = await connect();
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual([
            "open",
            "search",
            "tags",
        ]);
        expect(tools.every((tool) => (tool.description ?? "").length > 0)).toBe(
            true,
        );
    });

    it("lists tags and searches by them", async () => {
        const vocabulary = join(dir, "tags.json");
        await writeFile(
            vocabulary,
            JSON.stringify({
                v: 1,
                rev: 1,
                concepts: {
                    k00000001: {
                        prefLabel: "rendering",
                        scopeNote: "Drawing the screen.",
                        by: "dorothy",
                        at: "2026-10-04T12:00:00.000Z",
                    },
                },
            }),
        );
        await writeFile(
            sidecarPath(dir, A),
            JSON.stringify({ ...EMPTY_SIDECAR, tags: ["k00000001"] }),
        );
        const client = await connect({ vocabulary });
        const listed = JSON.parse(
            textOf(await client.callTool({ name: "tags", arguments: {} })),
        ) as TagsResult;
        expect(
            listed.results.map((tag) => [tag.name, tag.conversations]),
        ).toEqual([["rendering", 1]]);
        const found = JSON.parse(
            textOf(
                await client.callTool({
                    name: "search",
                    arguments: { tags: ["Rendering"] },
                }),
            ),
        ) as SearchResult;
        expect(
            found.results.map((hit) => [hit.identifier, hit.keywords]),
        ).toEqual([[A, ["rendering"]]]);
    });

    it("relays tag-limit errors to the recall client", async () => {
        const client = await connect({ vocabulary: join(dir, "tags.json") });
        const result = await client.callTool({
            name: "search",
            arguments: { tags: ["a", "b", "c", "d", "e", "f"] },
        });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe("Give at most 5 tags.");
    });

    it("relays a tag it does not know as a tool error", async () => {
        const client = await connect({ vocabulary: join(dir, "tags.json") });
        const result = await client.callTool({
            name: "tags",
            arguments: { under: "nothing" },
        });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe("No tag by that name: nothing.");
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
        expect(await names({})).toEqual(["open", "search", "tags"]);
        expect(await names({ recollect: true })).toEqual([
            "open",
            "recollect",
            "search",
            "tags",
        ]);
        expect(await names({ recollect: true, exclude: null })).toEqual([
            "open",
            "search",
            "tags",
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

    it("reopens a hidden chat's own turns from its transcript, which the index leaves out", async () => {
        await writeFile(
            join(dir, `${LIVE}.jsonl`),
            [
                user("the walnut cake"),
                user("a render bug"),
                user("then the kiln"),
            ].join(""),
        );
        await writeFile(
            sidecarPath(dir, LIVE),
            JSON.stringify({
                ...EMPTY_SIDECAR,
                hidden: true,
                clusters: [
                    {
                        from: 1,
                        through: 3,
                        abstract: "Cakes.",
                        at: "2026-10-04T12:00:00.000Z",
                        model: "m",
                    },
                ],
            }),
        );
        const client = await connect({ recollect: true });
        const opened = await client.callTool({
            name: "recollect",
            arguments: { cluster: 1, words: "Kiln" },
        });
        expect(opened.isError).toBeFalsy();
        const result = JSON.parse(textOf(opened)) as RecollectResult;
        expect(result.total).toBe(3);
        expect(result.matched).toBe(true);
        expect(result.window.map((turn) => turn.text)).toEqual([
            "the walnut cake",
            "a render bug",
            "then the kiln",
        ]);
        expect(result.window[2]?.at).toBe("2026-10-04T12:00:00.000Z");
        // Nothing of it was kept in the index.
        const index = indexes[0] as RecallIndex;
        expect(
            index.db
                .query("SELECT count(*) AS n FROM turns WHERE phrase = ?")
                .get(LIVE),
        ).toEqual({ n: 0 });
        const missing = await client.callTool({
            name: "recollect",
            arguments: { cluster: 2 },
        });
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

describe("the recall server's facts", () => {
    const tea = {
        name: "tea",
        title: "Tea at four",
        description: "She takes tea at four.",
        type: "user" as const,
        extra: {},
        tags: [],
        importance: null,
        provenance: {
            origin: "dorothy" as const,
            by: "dorothy" as const,
            at: "2026-10-04T12:00:00.000Z",
            created: "2026-10-04T12:00:00.000Z",
        },
        retired: null,
        body: "Every day at four.",
    };

    it("offers remember beside the lookups", async () => {
        const client = await connect({ facts: dir });
        const { tools } = await client.listTools();
        expect(tools.map((tool) => tool.name).sort()).toEqual([
            "open",
            "remember",
            "search",
            "tags",
        ]);
    });

    it("finds a fact and opens it", async () => {
        await putFact(dir, PERSONAL, tea);
        const client = await connect({ facts: dir });
        const found = JSON.parse(
            textOf(
                await client.callTool({
                    name: "search",
                    arguments: { query: "tea" },
                }),
            ),
        ) as SearchResult;
        expect(found.facts.map((hit) => hit.id)).toEqual(["personal/tea"]);
        const opened = JSON.parse(
            textOf(
                await client.callTool({
                    name: "open",
                    arguments: { fact: "personal/tea", purpose: "her tea" },
                }),
            ),
        ) as OpenFactResult;
        expect(opened.body).toBe("Every day at four.");
        const both = await client.callTool({
            name: "open",
            arguments: { fact: "personal/tea", conversation: A, purpose: "p" },
        });
        expect(both.isError).toBe(true);
        expect(textOf(both)).toBe(
            "Give a conversation or a fact to open, not both.",
        );
    });

    it("remembers in its project, from the conversation it serves, committed once opened", async () => {
        const committed: string[] = [];
        let opened = 0;
        const client = await connect({
            facts: dir,
            project: "github.com/u/here",
            openHistory: async () => {
                opened += 1;
                return {
                    recorder: async (_paths, message) => {
                        committed.push(message);
                    },
                    lock: async (work) => work(),
                    sweep: async () => {},
                    heal: async () => false,
                    close: () => {},
                };
            },
        });
        const call = (name: string) =>
            client.callTool({
                name: "remember",
                arguments: {
                    action: "write",
                    name,
                    scope: "project",
                    type: "project",
                    title: "The gateway",
                    description: "How the gateway runs.",
                    body: "On loopback.",
                },
            });
        expect(JSON.parse(textOf(await call("gateway")))).toEqual({
            action: "written",
            id: "github.com/u/here/gateway",
        });
        await call("render");
        expect(opened).toBe(1);
        expect(committed).toEqual([
            "fact: github.com/u/here/gateway",
            "fact: github.com/u/here/render",
        ]);
        const read = await readFactFile(
            factPath(
                dir,
                { kind: "project", id: "github.com/u/here" },
                "gateway",
            ),
            "gateway",
        );
        expect(read.kind === "ok" && read.fact.provenance.from).toBe(LIVE);
    });

    it("answers a search after the remember sent before it", async () => {
        const client = await connect({
            facts: dir,
            project: "github.com/u/here",
            // A remember that takes its time, as a slow disk would.
            openHistory: async () => {
                await new Promise((resolve) => setTimeout(resolve, 100));
                return null;
            },
        });
        // Both are sent before either is answered.
        const remembered = client.callTool({
            name: "remember",
            arguments: {
                action: "write",
                name: "gateway",
                scope: "project",
                type: "project",
                title: "The gateway",
                description: "How the gateway runs.",
                body: "On loopback.",
            },
        });
        const searched = client.callTool({
            name: "search",
            arguments: { query: "gateway", kind: "facts" },
        });
        expect(JSON.parse(textOf(await remembered))).toMatchObject({
            action: "written",
        });
        const found = JSON.parse(textOf(await searched)) as SearchResult;
        expect(found.facts.map((fact) => fact.id)).toEqual([
            "github.com/u/here/gateway",
        ]);
    });

    it("relays a refusal as a tool error", async () => {
        const client = await connect({ facts: dir });
        const result = await client.callTool({
            name: "remember",
            arguments: {
                action: "write",
                name: "x",
                scope: "project",
                type: "user",
                title: "t",
                description: "d",
                body: "b",
            },
        });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toStartWith("There is no project here");
    });
});

describe("the recall server in Claude Code", () => {
    const S = "0f8fad5b-d9cb-469f-a165-70867728950e";
    const begun = (phrase: string) =>
        `${JSON.stringify({ v: 1, kind: "session", at: "2026-10-04T12:00:00.000Z", phrase, sdkSessionId: "", model: "m", promptHash: "", resumed: false, source: "claude-code", sourceSession: S })}\n`;
    const found = async (client: Client) =>
        (
            JSON.parse(
                textOf(
                    await client.callTool({
                        name: "search",
                        arguments: { query: "render", kind: "conversations" },
                    }),
                ),
            ) as SearchResult
        ).results
            .map((hit) => hit.identifier)
            .sort();

    it("leaves out the live session's conversation once a hook has recorded it, and remembers from it", async () => {
        let live: string | null = null;
        const client = await connect({
            exclude: null,
            facts: dir,
            liveSession: async () => live,
        });
        expect(await found(client)).toEqual([A, LIVE].sort());
        // A session no hook has recorded yet has no conversation to leave out.
        live = S;
        expect(await found(client)).toEqual([A, LIVE].sort());
        // A hook records it as a resumed session would be: appended.
        await appendFile(join(dir, `${LIVE}.jsonl`), begun(LIVE));
        expect(await found(client)).toEqual([A]);
        await client.callTool({
            name: "remember",
            arguments: {
                action: "write",
                name: "tea",
                scope: "personal",
                type: "user",
                title: "Tea",
                description: "Tea at four.",
                body: "Every day.",
            },
        });
        const read = await readFactFile(factPath(dir, PERSONAL, "tea"), "tea");
        expect(read.kind === "ok" && read.fact.provenance.from).toBe(LIVE);
    });

    it("leaves out the conversation chat names, whatever the launch says", async () => {
        await writeFile(
            join(dir, `${A}.jsonl`),
            begun(A) + user("the render bug again"),
        );
        const client = await connect({ liveSession: async () => S });
        expect(await found(client)).toEqual([A]);
    });
});
