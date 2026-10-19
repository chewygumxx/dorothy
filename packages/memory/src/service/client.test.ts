// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/client.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env, RecordRequest } from "@dorothy/core";
import {
    ensureService,
    flushPending,
    requestBlock,
    requestRecall,
    sendRecord,
} from "./client.js";
import { isLoopbackUrl } from "./loopback.js";

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
const extra: ReturnType<typeof Bun.serve>[] = [];

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
    for (const other of extra.splice(0)) {
        other.stop(true);
    }
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

    it("keeps a record sent to a name the service lacks (421)", async () => {
        status = 421;
        expect(await sendRecord(record, up())).toBeNull();
        expect(pending()).toHaveLength(1);
    });

    it("keeps a record refused for its token, which may come right", async () => {
        status = 401;
        expect(await sendRecord(record, up())).toBeNull();
        expect(pending()).toHaveLength(1);
    });
});

// A service of its own, answering by what the record is called.
const serve = (fetch: (request: Request) => Response | Promise<Response>) => {
    const other = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch });
    extra.push(other);
    return { env, url: `http://127.0.0.1:${other.port}`, token: null };
};
const wait = (...names: string[]) => {
    const dir = join(home, "state", "dorothy", "pending");
    mkdirSync(dir, { recursive: true });
    for (const name of names) {
        writeFileSync(
            join(dir, `${name}.json`),
            JSON.stringify({ ...record, session: name }),
        );
    }
};
const ACCEPTED = { accepted: 1, duplicates: 0, through: "a" };
const sessionOf = async (request: Request) =>
    ((await request.json()) as RecordRequest).session;

describe("the queue of records", () => {
    it("drops a refused head, and sends the one behind it", async () => {
        wait("1-a", "2-b");
        const sent: string[] = [];
        const options = serve(async (request) => {
            const session = await sessionOf(request);
            sent.push(session);
            return session === "1-a"
                ? Response.json({ error: "no" }, { status: 403 })
                : Response.json(ACCEPTED);
        });
        expect(await flushPending(options)).toBe(0);
        expect(sent).toEqual(["1-a", "2-b"]);
        expect(pending()).toEqual([]);
    });

    it("drops a record refused with 403, not queueing it", async () => {
        status = 403;
        expect(await sendRecord(record, up())).toBeNull();
        expect(pending()).toEqual([]);
    });

    it("removes a record taken with a reply that is not the contract's", async () => {
        wait("1-a");
        const options = serve(() => Response.json({ surprise: true }));
        expect(await flushPending(options)).toBe(0);
        expect(pending()).toEqual([]);
        const other = serve(() => new Response("not json"));
        expect(await sendRecord(record, other)).toBeNull();
        expect(pending()).toEqual([]);
    });

    it("stops at a record the service cannot take yet", async () => {
        wait("1-a", "2-b");
        for (const code of [401, 408, 429, 503]) {
            const options = serve(() => new Response("", { status: code }));
            expect(await flushPending(options)).toBe(2);
            expect(pending()).toHaveLength(2);
        }
    });

    it("spends no more than the record timeout on a backlog", async () => {
        wait(...Array.from({ length: 10 }, (_, i) => `${i}-x`));
        const options = {
            ...serve(async () => {
                await Bun.sleep(80);
                return Response.json(ACCEPTED);
            }),
            timeouts: { record: 300 },
        };
        const started = Date.now();
        const left = await flushPending(options);
        expect(Date.now() - started).toBeLessThan(700);
        expect(left).toBeGreaterThan(0);
        expect(left).toBeLessThan(10);
        expect(pending()).toHaveLength(left);
    });

    it("gives up on a service that hangs, within the timeout", async () => {
        wait("1-a", "2-b");
        const options = {
            ...serve(() => new Promise<Response>(() => {})),
            timeouts: { record: 200 },
        };
        const started = Date.now();
        expect(await sendRecord(record, options)).toBeNull();
        expect(Date.now() - started).toBeLessThan(600);
        expect(pending()).toHaveLength(3);
    });
});

describe("the client's promises", () => {
    // An environment that fails on every read, as a broken one might.
    const broken = new Proxy({} as Env, {
        get() {
            throw new Error("environment unreadable");
        },
    });

    it("never throws, whatever it is given", async () => {
        const request = {
            host: "codex",
            session: "s1",
            reason: "startup" as const,
        };
        const options = { env: broken };
        expect(await requestBlock(request, options)).toBeNull();
        expect(
            await requestRecall(
                { host: "codex", session: "s1", prompt: "tea" },
                options,
            ),
        ).toBeNull();
        expect(await sendRecord(record, options)).toBeNull();
    });

    it("spends one record budget on a flush and a send together", async () => {
        wait("1-a");
        // A clock the test moves, and the time each request is given: the
        // waiting record takes 150 of the 200, leaving 50 for the new one.
        let clock = 1_800_000_000_000;
        const now = spyOn(Date, "now").mockImplementation(() => clock);
        const given: number[] = [];
        const timeout = spyOn(AbortSignal, "timeout").mockImplementation(
            (ms: number) => {
                given.push(ms);
                return new AbortController().signal;
            },
        );
        let calls = 0;
        const fetcher = (async () => {
            calls += 1;
            if (calls === 1) {
                clock += 150;
            }
            return Response.json(ACCEPTED);
        }) as unknown as typeof fetch;
        try {
            const sent = await sendRecord(record, {
                env,
                url: "http://127.0.0.1:1",
                token: null,
                fetch: fetcher,
                timeouts: { record: 200 },
            });
            expect(sent).toEqual(ACCEPTED);
        } finally {
            now.mockRestore();
            timeout.mockRestore();
        }
        expect(calls).toBe(2);
        expect(given).toEqual([200, 50]);
    });

    it("sends nothing further once a flush has spent the budget", async () => {
        wait("1-a");
        let clock = 1_800_000_000_000;
        const now = spyOn(Date, "now").mockImplementation(() => clock);
        let calls = 0;
        const fetcher = (async () => {
            calls += 1;
            clock += 250;
            return Response.json(ACCEPTED);
        }) as unknown as typeof fetch;
        try {
            const sent = await sendRecord(record, {
                env,
                url: "http://127.0.0.1:1",
                token: null,
                fetch: fetcher,
                timeouts: { record: 200 },
            });
            expect(sent).toBeNull();
        } finally {
            now.mockRestore();
        }
        // The new record waits for the next call rather than overrun.
        expect(calls).toBe(1);
        expect(pending()).toHaveLength(1);
    });

    it("keeps records made in one millisecond in the order sent", async () => {
        const now = spyOn(Date, "now").mockReturnValue(1_800_000_000_000);
        try {
            for (let at = 0; at < 30; at++) {
                await sendRecord({ ...record, session: `n${at}` }, down());
            }
        } finally {
            now.mockRestore();
        }
        expect(pending()).toHaveLength(30);
        const sent: string[] = [];
        const options = serve(async (request) => {
            sent.push(await sessionOf(request));
            return Response.json(ACCEPTED);
        });
        expect(
            await flushPending({ ...options, timeouts: { record: 5000 } }),
        ).toBe(0);
        expect(sent).toEqual(Array.from({ length: 30 }, (_, at) => `n${at}`));
    });

    it("keeps a block apart for a host a path could name", async () => {
        const request = {
            host: "../../escape",
            session: "s1",
            reason: "startup" as const,
        };
        await requestBlock(request, up());
        expect(existsSync(join(home, "state", "escape"))).toBe(false);
        expect(
            existsSync(
                join(home, "state", "dorothy", "blocks", "..%2F..%2Fescape"),
            ),
        ).toBe(true);
        expect((await requestBlock(request, down()))?.text).toBe(BLOCK.text);
    });
});

describe("ensureService", () => {
    it("is true for a service that answers", async () => {
        const options = serve(() => new Response("ok"));
        expect(await ensureService([], options)).toBe(true);
    });

    it("resolves false for a URL that is not one", async () => {
        expect(await ensureService(["true"], { env, url: "nope" })).toBe(false);
    });

    it("resolves false for a program that is not there", async () => {
        const command = [join(home, "no-such-program")];
        expect(await ensureService(command, down())).toBe(false);
    });

    it("starts nothing for a service on another machine", async () => {
        const command = [join(home, "no-such-program")];
        const options = { env, url: "http://192.0.2.1:4774", token: null };
        expect(await ensureService(command, options)).toBe(false);
    });
});

describe("isLoopbackUrl", () => {
    it("knows the loopback addresses, IPv6 in brackets too", () => {
        expect(isLoopbackUrl("http://127.0.0.1:4774")).toBe(true);
        expect(isLoopbackUrl("http://[::1]:4774")).toBe(true);
        expect(isLoopbackUrl("http://192.0.2.1:4774")).toBe(false);
        expect(isLoopbackUrl("http://[2001:db8::1]:4774")).toBe(false);
    });
});
