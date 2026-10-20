// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/sweep-command.test.ts
//
//

import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import {
    mkdir,
    mkdtemp,
    readdir,
    rm,
    utimes,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DEFAULT_CONFIG, type Env, newPhrase } from "@dorothy/core";
import {
    assistantLine,
    SESSION as CLAUDE_SESSION,
    text as claudeText,
    userLine,
} from "../bodies/fixtures.js";
import { halts, readRecord } from "../bodies/unread.js";
import { fakeEngine } from "../contract/testing.js";
import { indexCatalogue } from "../memory/catalogue.js";
import { Reviewer } from "../memory/reviewer.js";
import { isStale, MemoryService } from "../memory/service.js";
import { NOTES, reviews, settle, until } from "../memory/service-testing.js";
import { readSidecar } from "../memory/sidecar.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import {
    context,
    line,
    message,
    meta,
    SESSION,
} from "../recording/fixtures.js";
import {
    HERMES_SCHEMA,
    hermesMessage,
    hermesSession,
} from "../recording/hermes-fixtures.js";
import { transcriptDir } from "../transcript.js";
import { startJobs } from "./jobs.js";
import { runSweep, runSweepDismiss } from "./sweep-command.js";

// Events of 2026-10-20 at nine.
const BEFORE = new Date("2026-10-14T00:00:00.000Z");
const AFTER = new Date("2026-10-21T00:00:00.000Z");
const FRESH = new Date("2026-10-21T06:00:00.000Z");
const STALE = new Date("2026-10-19T09:30:00.000Z");

let home: string;
let env: Env;
let out: string[];
let err: string[];

const settings = async (text: string) => {
    await mkdir(join(home, "config", "dorothy"), { recursive: true });
    await writeFile(join(home, "config", "dorothy", "config.toml"), text);
};
const io = () => ({
    env,
    out: { write: (text: string) => out.push(text) },
    err: { write: (text: string) => err.push(text) },
});
const rollout = async (lines: string[], when: Date, name = "one.jsonl") => {
    const path = join(home, ".codex/sessions/2026/10/20", `rollout-${name}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${lines.join("\n")}\n`);
    await utimes(path, when, when);
    return path;
};
const speech = [
    meta(),
    context(),
    message("user", "Synthetic question.", 1),
    message("assistant", "Synthetic answer.", 2),
];
const unknownBlock = line("response_item", {
    type: "message",
    role: "user",
    content: [{ type: "synthetic_unknown_block" }],
});
const conversations = async () =>
    (await readdir(transcriptDir(env)).catch(() => [])).filter((name) =>
        name.endsWith(".jsonl"),
    );

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dorothy-sweep-command-"));
    env = {
        HOME: home,
        XDG_DATA_HOME: join(home, "data"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_STATE_HOME: join(home, "state"),
        XDG_CONFIG_HOME: join(home, "config"),
    };
    out = [];
    err = [];
    await settings(
        '[history]\nenabled = false\n[recording]\nhosts = ["codex"]\n',
    );
});
afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe("dorothy --sweep", () => {
    for (const host of ["codex", "claude-code"] as const)
        it(`keeps a ${host} foreground backfill out of catch-up and reviews it after a live turn`, async () => {
            await settings(
                `[history]\nenabled = false\n[recording]\nhosts = ["${host}"]\n`,
            );
            const initial =
                host === "codex"
                    ? speech
                    : [
                          userLine("u1", 0, "Synthetic question."),
                          assistantLine("a1", 1, [
                              claudeText("Synthetic answer."),
                          ]),
                      ];
            const path =
                host === "codex"
                    ? await rollout(initial, STALE)
                    : join(
                          home,
                          ".claude/projects/-work",
                          `${CLAUDE_SESSION}.jsonl`,
                      );
            if (host === "claude-code") {
                await mkdir(dirname(path), { recursive: true });
                await writeFile(path, `${initial.join("\n")}\n`);
                await utimes(path, STALE, STALE);
            }
            await runSweep({ ...io(), backfill: true, now: () => AFTER });
            const index = RecallIndex.open(indexPath(env));
            const query = reviews(NOTES, NOTES);
            const catalogue = indexCatalogue(index, transcriptDir(env));
            const launch = async () => {
                const { entries } = await catalogue.load();
                const memory = new MemoryService({
                    dir: transcriptDir(env),
                    phrase: newPhrase(),
                    history: [],
                    config: DEFAULT_CONFIG.memory,
                    entries,
                    flushed: null,
                    index,
                    vocabulary: null,
                    call: query.fn,
                    persona: "Synthetic.",
                    now: () => AFTER,
                });
                memory.ready();
                return memory;
            };
            try {
                const { entries } = await catalogue.load();
                expect(entries).toHaveLength(1);
                const [entry] = entries;
                if (!entry) throw new Error("missing backfill");
                expect(isStale(entry, AFTER.getTime(), true)).toBe(false);
                const first = await launch();
                await settle();
                await first.stop();
                expect(query.calls).toHaveLength(0);
                // The shared reviewer is also the hooks' review path.
                const reviewer = new Reviewer({
                    dir: transcriptDir(env),
                    config: DEFAULT_CONFIG.memory,
                    index,
                    vocabulary: null,
                    versions: null,
                    call: query.fn,
                    persona: "Synthetic.",
                    now: () => AFTER,
                    entries: () => entries,
                    warn: () => {},
                    cost: () => {},
                });
                await reviewer.review(
                    entry.phrase,
                    new AbortController().signal,
                );
                expect(query.calls).toHaveLength(0);
                const engine = fakeEngine();
                const jobs = startJobs({
                    config: {
                        ...DEFAULT_CONFIG,
                        memory: { ...DEFAULT_CONFIG.memory, idleSeconds: 0 },
                    },
                    engine,
                    store: {
                        root: join(home, "data/dorothy"),
                        lock: index.lock,
                        recorder: null,
                    },
                    idle: new Map([[entry.phrase, 0]]),
                    backfilled: new Set(),
                    touched: new Set(),
                    loadCatalogue: null,
                    warn: () => {},
                    tickMs: 5,
                });
                await settle();
                await jobs.stop();
                expect(engine.calls).toEqual([]);
                const resumed =
                    host === "codex"
                        ? message("user", "Synthetic resumed.", 172800)
                        : userLine("u2", 2, "Synthetic resumed.", {
                              timestamp: "2026-10-22T00:00:00.000Z",
                          });
                await writeFile(path, `${[...initial, resumed].join("\n")}\n`);
                await utimes(path, FRESH, FRESH);
                await runSweep({ ...io(), backfill: false, now: () => AFTER });
                const second = await launch();
                try {
                    await until(() => query.calls.length > 0);
                } finally {
                    await second.stop();
                }
                expect(query.calls).toHaveLength(1);
            } finally {
                index.close();
            }
        });

    it("prints backfill progress before each hundred-session batch finishes", async () => {
        await Promise.all(
            Array.from({ length: 201 }, async (_, i) => {
                const session = `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
                await rollout(
                    speech.map((each) => each.replaceAll(SESSION, session)),
                    STALE,
                    `${i}.jsonl`,
                );
            }),
        );
        const seen: number[] = [];
        expect(
            await runSweep({
                ...io(),
                backfill: true,
                now: () => AFTER,
                out: {
                    write: (text) => {
                        out.push(text);
                        if (text.includes("visited"))
                            seen.push(
                                readdirSync(transcriptDir(env)).filter((name) =>
                                    name.endsWith(".jsonl"),
                                ).length,
                            );
                    },
                },
            }),
        ).toBe(0);
        expect(seen).toEqual([100, 200]);
        expect(out.join("")).toContain(
            "codex: visited 100 sessions\ncodex: visited 200 sessions\n",
        );
        expect(out.at(-1)).toBe("codex: 402 events in 201 sessions\n");
    }, 15000);

    it("says what to set when no host is", async () => {
        await settings("[history]\nenabled = false\n");
        expect(await runSweep({ ...io(), backfill: false })).toBe(1);
        expect(out).toEqual([]);
        expect(err.join("")).toContain("[recording] hosts");
    });

    it("prints a host and a count a line", async () => {
        await settings(
            '[history]\nenabled = false\n[recording]\nhosts = ["codex", "hermes"]\n',
        );
        await rollout(speech, FRESH);
        expect(
            await runSweep({ ...io(), backfill: false, now: () => BEFORE }),
        ).toBe(0);
        expect(out.join("")).toBe(
            "codex: 2 events in 1 session\nhermes: 0 events in 0 sessions\n",
        );
        expect(await conversations()).toHaveLength(1);
    });

    it("leaves an old session to the backfill, which records it", async () => {
        await rollout(speech, STALE);
        await runSweep({ ...io(), backfill: false, now: () => AFTER });
        expect(out.join("")).toBe(
            "codex: 0 events in 0 sessions (1 waiting for the backfill)\n",
        );
        expect(await conversations()).toEqual([]);
        out.length = 0;
        expect(
            await runSweep({ ...io(), backfill: true, now: () => AFTER }),
        ).toBe(0);
        expect(out.join("")).toBe("codex: 2 events in 1 session\n");
        expect(await conversations()).toHaveLength(1);
    });

    it("rereads an old backfill halt without turning it live", async () => {
        await rollout([...speech, unknownBlock], STALE);
        await runSweep({ ...io(), backfill: true, now: () => AFTER });
        expect(await halts(env, "codex")).toHaveLength(1);
        // A repaired source remains old, with one more old event.
        await rollout(
            [...speech, message("user", "Synthetic recovered.", 3)],
            STALE,
        );
        expect(
            await runSweep({
                ...io(),
                backfill: false,
                reread: true,
                now: () => AFTER,
            }),
        ).toBe(0);
        expect(await halts(env, "codex")).toEqual([]);
        const [file] = await conversations();
        if (!file) throw new Error("missing backfill");
        const sidecar = await readSidecar(
            transcriptDir(env),
            file.slice(0, -6),
        );
        expect(sidecar).toMatchObject({
            kind: "ok",
            sidecar: { backfilled: true },
        });
        expect(out.join("")).toContain(`read codex ${SESSION} to its end`);
    });

    it("keeps a halt, which a reread resolves once the session reads", async () => {
        await rollout([...speech, unknownBlock], FRESH);
        await runSweep({ ...io(), backfill: false, now: () => BEFORE });
        const [kept] = await halts(env, "codex");
        expect(kept).toMatchObject({ session: SESSION, host: "codex" });
        out.length = 0;
        err.length = 0;
        expect(await runSweep({ ...io(), backfill: false, reread: true })).toBe(
            1,
        );
        expect(err.join("")).toContain(`codex ${SESSION} still can't be read`);
        await rollout(speech, FRESH);
        err.length = 0;
        expect(await runSweep({ ...io(), backfill: false, reread: true })).toBe(
            0,
        );
        expect(out.join("")).toContain(`read codex ${SESSION} to its end`);
        expect(await halts(env)).toEqual([]);
    });

    it("rereads the halted sessions alone, records no other, whatever is set", async () => {
        await rollout([...speech, unknownBlock], FRESH);
        await runSweep({ ...io(), backfill: false, now: () => BEFORE });
        expect(await conversations()).toHaveLength(1);
        // A new session, and the host no longer set.
        const other = "99999999-2222-4333-8444-555555555555";
        await rollout(
            speech.map((each) => each.replaceAll(SESSION, other)),
            FRESH,
            "two.jsonl",
        );
        await settings("[history]\nenabled = false\n");
        out.length = 0;
        err.length = 0;
        expect(await runSweep({ ...io(), backfill: false, reread: true })).toBe(
            1,
        );
        expect(out.join("")).toBe("codex: 0 events in 0 sessions (1 halted)\n");
        expect(await conversations()).toHaveLength(1);
        expect(await readRecord(env, other, "codex")).toBeNull();
    });

    it("rereads a Hermes halt by its session, in a database of others", async () => {
        await settings(
            '[history]\nenabled = false\n[recording]\nhosts = ["hermes"]\n',
        );
        const path = join(home, ".hermes", "state.db");
        await mkdir(dirname(path), { recursive: true });
        const db = new Database(path);
        try {
            db.exec(HERMES_SCHEMA);
            hermesSession(db, "halted-session");
            hermesMessage(db, 1, "user", "Synthetic question.", {
                session: "halted-session",
            });
            hermesMessage(db, 2, "user", "\0json:{", {
                session: "halted-session",
            });
            await runSweep({ ...io(), backfill: false, now: () => BEFORE });
            expect(await halts(env, "hermes")).toMatchObject([
                { session: "halted-session", host: "hermes", line: 2 },
            ]);
            expect(await conversations()).toHaveLength(1);
            // Another session arrives, and the halt is mended.
            hermesSession(db, "other-session");
            hermesMessage(db, 3, "user", "Synthetic other.", {
                session: "other-session",
            });
            out.length = 0;
            err.length = 0;
            expect(
                await runSweep({ ...io(), backfill: false, reread: true }),
            ).toBe(1);
            expect(err.join("")).toContain(
                "hermes halted-session still can't be read past row 2",
            );
            expect(await conversations()).toHaveLength(1);
            expect(await readRecord(env, "other-session", "hermes")).toBeNull();
            db.run("UPDATE messages SET content = ? WHERE id = 2", [
                "Synthetic mended.",
            ]);
        } finally {
            db.close();
        }
        out.length = 0;
        err.length = 0;
        expect(await runSweep({ ...io(), backfill: false, reread: true })).toBe(
            0,
        );
        expect(out.join("")).toContain("read hermes halted-session to its end");
        expect(await halts(env)).toEqual([]);
        // The other session was never visited by a reread.
        expect(await conversations()).toHaveLength(1);
    });

    it("has nothing to reread when nothing is kept", async () => {
        expect(await runSweep({ ...io(), backfill: false, reread: true })).toBe(
            0,
        );
        expect(out.join("")).toContain("no unreadable sessions are kept");
    });
});

describe("dorothy --sweep --dismiss", () => {
    it("stops telling a halt, keeping its lines", async () => {
        await rollout([...speech, unknownBlock], FRESH);
        await runSweep({ ...io(), backfill: false, now: () => BEFORE });
        expect(await runSweepDismiss("codex", SESSION, io())).toBe(0);
        expect(await readRecord(env, SESSION, "codex")).toMatchObject({
            dismissed: true,
        });
        expect(out.join("")).toContain(`${SESSION} will not be told again`);
    });

    it("says when there is none to dismiss", async () => {
        expect(await runSweepDismiss("codex", SESSION, io())).toBe(1);
        expect(err.join("")).toContain(
            `no unreadable codex session ${SESSION}`,
        );
    });
});
