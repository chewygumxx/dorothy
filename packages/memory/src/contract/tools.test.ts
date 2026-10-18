// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/tools.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newPhrase } from "@dorothy/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { baselineEngine } from "../engine/baseline.js";
import type { MemoryEngine } from "../engine/engine.js";
import { PERSONAL, putFact } from "../facts/store.js";
import { EMPTY_SIDECAR, updateSidecar } from "../memory/sidecar.js";
import { RecallIndex } from "../recall/store.js";
import { transcriptDir, transcriptPath } from "../transcript.js";
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

const MINE = "github.com/me/app";
const OTHER = "github.com/me/other";

async function connect(project: string | null, host: MemoryEngine = engine) {
    const server = createContractServer({
        engine: host,
        index,
        store: { root, lock: index.lock, recorder: null },
        project,
        host: "codex",
        resolveProject: async (value) => value,
    });
    const [near, far] = InMemoryTransport.createLinkedPair();
    await server.connect(near);
    client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(far);
}

beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "dorothy-tools-"));
    index = RecallIndex.open(join(root, "recall.sqlite"));
    await connect(null);
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

const phrase = (seed: number) =>
    newPhrase((size) => Uint8Array.from({ length: size }, () => seed));

const fact = (name: string) => ({
    name,
    title: name,
    description: `About ${name}.`,
    type: "user" as const,
    extra: {},
    tags: [],
    importance: null,
    provenance: {
        origin: "user" as const,
        by: "user" as const,
        at: "2026-10-18T09:30:00.000Z",
        created: "2026-10-18T09:30:00.000Z",
    },
    retired: null,
    body: `Body of ${name}.`,
});

const converse = (name: string, project: string | null) => {
    index.db.run(
        "INSERT INTO conversations (phrase, t_size, t_ino, turns, first_at, last_at, project) VALUES (?, 0, 0, 1, 1, 1, ?)",
        [name, project],
    );
    index.db.run(
        "INSERT INTO turns (phrase, n, role, at, text) VALUES (?, 1, 'user', 1, 'Hello.')",
        [name],
    );
};

describe("open keeps to the connection's scope", () => {
    const own = phrase(1);
    const elsewhere = phrase(2);
    const personal = phrase(3);

    beforeEach(async () => {
        await putFact(root, PERSONAL, fact("likes-tea"));
        await putFact(root, { kind: "project", id: MINE }, fact("uses-bun"));
        await putFact(root, { kind: "project", id: OTHER }, fact("uses-npm"));
        converse(own, MINE);
        converse(elsewhere, OTHER);
        converse(personal, null);
        await client.close();
        await connect(MINE);
    });

    it("opens personal knowledge and the project's own", async () => {
        for (const id of [
            "k:personal/likes-tea",
            `k:projects/${MINE}/uses-bun`,
        ]) {
            const { isError, text } = await call("open", { id });
            expect(isError).toBe(false);
            expect(JSON.parse(text).id).toBe(id);
        }
    });

    it("refuses another project's knowledge", async () => {
        const { isError, text } = await call("open", {
            id: `k:projects/${OTHER}/uses-npm`,
        });
        expect(isError).toBe(true);
        expect(text).toBe("that id is outside this session's scope");
    });

    it("refuses another project's knowledge where there is no project", async () => {
        await client.close();
        await connect(null);
        const { isError, text } = await call("open", {
            id: `k:projects/${MINE}/uses-bun`,
        });
        expect(isError).toBe(true);
        expect(text).toContain("outside this session's scope");
    });

    it("opens the project's conversations and personal ones", async () => {
        for (const name of [own, personal]) {
            const { isError, text } = await call("open", { id: `c:${name}` });
            expect(isError).toBe(false);
            expect(JSON.parse(text).window[0].text).toBe("Hello.");
        }
    });

    it("refuses another project's conversation", async () => {
        const { isError, text } = await call("open", { id: `c:${elsewhere}` });
        expect(isError).toBe(true);
        expect(text).toBe("that id is outside this session's scope");
    });

    it("takes the call's own project over the connection's", async () => {
        const { isError } = await call("open", {
            id: `c:${elsewhere}`,
            project: OTHER,
        });
        expect(isError).toBe(false);
    });
});

describe("the opening block's conversations", () => {
    it("lists only those open admits, and each opens", async () => {
        const env = {
            HOME: root,
            XDG_DATA_HOME: join(root, "data"),
            XDG_CACHE_HOME: join(root, "cache"),
            XDG_STATE_HOME: join(root, "state"),
        };
        mkdirSync(transcriptDir(env), { recursive: true });
        const at = "2026-10-15T09:30:00.000Z";
        const write = async (name: string, project: string | null) => {
            const line = (kind: string, fields: object) =>
                `${JSON.stringify({ v: 1, kind, at, ...fields })}\n`;
            writeFileSync(
                transcriptPath(name, env),
                line("session", {
                    phrase: "p",
                    sdkSessionId: "",
                    model: "m",
                    promptHash: "",
                    resumed: false,
                    ...(project === null ? {} : { project }),
                }) + line("user", { text: "Hello." }),
            );
            // A note, which only a titled conversation has.
            await updateSidecar(transcriptDir(env), name, () => ({
                ...EMPTY_SIDECAR,
                title: `About ${project ?? "nothing"}`,
            }));
        };
        const [a, b, none] = [phrase(4), phrase(5), phrase(6)];
        await write(a, MINE);
        await write(b, OTHER);
        await write(none, null);
        const host = baselineEngine({
            env,
            index,
            halfLifeDays: 30,
            reviewer: null,
            now: () => Date.parse(at),
        });
        await client.close();
        // The session is the project OTHER's; MINE's is a stranger.
        await connect(OTHER, host);
        const { isError, text } = await call("brief", {});
        expect(isError).toBe(false);
        const ids = (JSON.parse(text).items as { id: string }[]).map(
            (item) => item.id,
        );
        expect(ids).toContain(`c:${b}`);
        expect(ids).toContain(`c:${none}`);
        expect(ids).not.toContain(`c:${a}`);
        for (const id of ids.filter((id) => id.startsWith("c:"))) {
            expect((await call("open", { id })).isError).toBe(false);
        }
    });
});

describe("a failure nobody meant to show", () => {
    it("answers in general terms, naming no path", async () => {
        const broken = fakeEngine();
        broken.index = async () => {
            throw new Error("SQLITE_CORRUPT at /home/user/.cache/dorothy/x");
        };
        await client.close();
        await connect(null, broken);
        const { isError, text } = await call("open", {
            id: "k:personal/likes-tea",
        });
        expect(isError).toBe(true);
        expect(text).toBe("Memory failed.");
    });
});
