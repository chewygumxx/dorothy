// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/client.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env, RecordRequest } from "@dorothy/core";
import { flushPending, requestBlock, sendRecord } from "./client.js";

const AT = "2026-10-18T09:30:00.000Z";
const BLOCK = {
    text: "<memory>\nTea.\n</memory>",
    digest: "xxh3:0123456789abcdef",
    items: [],
    used: 22,
};
let home: string;
let env: Env;
let server: ReturnType<typeof Bun.serve>;
let status = 200;
let seen: string[] = [];

beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "dorothy-client-"));
    env = { HOME: home, XDG_STATE_HOME: join(home, "state") };
    status = 200;
    seen = [];
    server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: async (request) => {
            const url = new URL(request.url);
            seen.push(url.pathname);
            if (status !== 200) {
                return Response.json({ error: "no" }, { status });
            }
            return url.pathname === "/v1/block"
                ? Response.json(BLOCK)
                : Response.json({ accepted: 1, duplicates: 0, through: "a" });
        },
    });
});
afterEach(() => {
    server.stop(true);
    rmSync(home, { recursive: true, force: true });
});

const up = () => ({ env, url: `http://127.0.0.1:${server.port}`, token: null });
const down = () => ({ env, url: "http://127.0.0.1:9", token: null });
const record: RecordRequest = {
    host: "codex",
    session: "s1",
    events: [{ sourceId: "a", at: AT, kind: "user", text: "Hi" }],
};
const pending = () => {
    try {
        return readdirSync(join(home, "state", "dorothy", "pending"));
    } catch {
        return [];
    }
};

describe("requestBlock", () => {
    const request = {
        host: "codex",
        session: "s1",
        project: "github.com/me/app",
        reason: "startup" as const,
    };

    it("gives the service's block, and keeps it", async () => {
        expect(await requestBlock(request, up())).toEqual(BLOCK);
    });

    it("gives the last block kept when the service is down", async () => {
        await requestBlock(request, up());
        const fallback = await requestBlock(request, down());
        expect(fallback?.text).toBe(BLOCK.text);
        expect(fallback?.items).toEqual([]);
    });

    it("gives null when the service is down and nothing is kept", async () => {
        expect(await requestBlock(request, down())).toBeNull();
    });
});

describe("sendRecord", () => {
    it("sends a record", async () => {
        expect(await sendRecord(record, up())).toEqual({
            accepted: 1,
            duplicates: 0,
            through: "a",
        });
        expect(pending()).toEqual([]);
    });

    it("keeps a record the service cannot take, and sends it later, first", async () => {
        expect(await sendRecord(record, down())).toBeNull();
        expect(pending()).toHaveLength(1);
        expect(await flushPending(up())).toBe(0);
        expect(pending()).toEqual([]);
        expect(seen).toEqual(["/v1/record"]);
    });

    it("drops a record the service refuses", async () => {
        status = 400;
        expect(await sendRecord(record, up())).toBeNull();
        expect(pending()).toEqual([]);
    });

    it("keeps a record refused for its token, which may come right", async () => {
        status = 401;
        expect(await sendRecord(record, up())).toBeNull();
        expect(pending()).toHaveLength(1);
    });
});
