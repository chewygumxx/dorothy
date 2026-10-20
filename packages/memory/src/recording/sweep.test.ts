// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/sweep.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { copyPath, readRecord } from "../bodies/unread.js";
import {
    call,
    context,
    line,
    message,
    meta,
    output,
    SESSION,
} from "./fixtures.js";
import { hermesMessage, hermesSession } from "./hermes-fixtures.js";
import { sweepPath } from "./state.js";
import { HOUR, NOW, type Rig, rig } from "./sweep-testing.js";

let r: Rig;
beforeEach(async () => {
    r = await rig();
});
afterEach(async () => {
    await r.close();
});

const rollout = (name = "rollout-one.jsonl") =>
    join(r.home, ".codex/sessions/2026/10/20", name);
const text = (...lines: string[]) => `${lines.join("\n")}\n`;
const speech = [
    meta(),
    context(),
    message("user", "Synthetic question.", 1),
    message("assistant", "Synthetic answer.", 2),
];
const only = (result: Awaited<ReturnType<Rig["run"]>>, host: string) => {
    const found = result.find((each) => each.host === host);
    if (!found) throw new Error(`no result for ${host}`);
    return found;
};
const speakers = (events: Record<string, unknown>[]) =>
    events
        .filter((event) => event.kind !== "session")
        .map((event) => event.sourceUuid);

describe("sweeping hosts that send events", () => {
    it("records a new Codex session as one conversation, each event once", async () => {
        await r.file(rollout(), text(...speech), 0);
        const result = await r.run({ hosts: ["codex"] });
        expect(only(result, "codex")).toMatchObject({
            sessions: 1,
            events: 2,
            error: null,
        });
        const [conversation, ...more] = await r.conversations();
        expect(more).toEqual([]);
        expect(conversation?.[0]).toMatchObject({
            kind: "session",
            source: "codex",
            sourceSession: `codex:${SESSION}`,
        });
        expect(conversation?.slice(1)).toMatchObject([
            { kind: "user", text: "Synthetic question.", sourceUuid: "3" },
            { kind: "assistant", text: "Synthetic answer.", sourceUuid: "4" },
        ]);
    });

    it("names a session's project from its working directory", async () => {
        const repo = join(r.home, "work/app");
        await mkdir(join(repo, ".git"), { recursive: true });
        await writeFile(
            join(repo, ".git/config"),
            '[remote "origin"]\n\turl = git@github.com:me/app.git\n',
        );
        await r.file(
            rollout(),
            text(meta(), context(repo), message("user", "Synthetic.", 1)),
            0,
        );
        await r.run({ hosts: ["codex"] });
        expect(r.requests[0]).toMatchObject({ project: "github.com/me/app" });
        expect(r.recorded[0]).toMatchObject({ project: "github.com/me/app" });
        const [conversation] = await r.conversations();
        expect(conversation?.[0]).toMatchObject({
            project: "github.com/me/app",
        });
    });

    it("leaves a session with no known directory personal", async () => {
        await r.file(
            rollout(),
            text(
                meta(),
                context("/fixture/missing"),
                message("user", "Synthetic.", 1),
            ),
            0,
        );
        await r.run({ hosts: ["codex"] });
        expect(r.requests[0]?.project).toBeUndefined();
    });

    it("skips an unchanged session at the next sweep", async () => {
        await r.file(rollout(), text(...speech), 0);
        await r.run({ hosts: ["codex"] });
        r.requests.length = 0;
        const again = only(await r.run({ hosts: ["codex"] }), "codex");
        expect(again).toMatchObject({ sessions: 0, events: 0, skipped: 1 });
        expect(r.requests).toEqual([]);
    });

    it("reads an appended session whole and stores only what is new", async () => {
        const path = await r.file(rollout(), text(...speech), 0);
        await r.run({ hosts: ["codex"] });
        await r.append(path, text(message("user", "Synthetic follow-up.", 5)));
        const again = only(await r.run({ hosts: ["codex"] }), "codex");
        expect(again).toMatchObject({ sessions: 1, events: 1 });
        expect(r.requests.at(-1)?.events).toHaveLength(3);
        const [conversation, ...more] = await r.conversations();
        expect(more).toEqual([]);
        expect(speakers(conversation ?? [])).toEqual(["3", "4", "5"]);
    });

    it("causes no duplicate when sweep.json is lost", async () => {
        await r.file(rollout(), text(...speech), 0);
        await r.run({ hosts: ["codex"] });
        await rm(sweepPath(r.env));
        r.logs.length = 0;
        const again = only(await r.run({ hosts: ["codex"] }), "codex");
        expect(again).toMatchObject({ sessions: 0, events: 0, skipped: 0 });
        expect(r.logs.some((log) => log.includes("sweep state missing"))).toBe(
            true,
        );
        const [conversation, ...more] = await r.conversations();
        expect(more).toEqual([]);
        expect(speakers(conversation ?? [])).toEqual(["3", "4"]);
    });

    it("records a Hermes session with its parent and its directory", async () => {
        const repo = join(r.home, "work/herm");
        await mkdir(join(repo, ".git"), { recursive: true });
        await writeFile(
            join(repo, ".git/config"),
            '[remote "origin"]\n\turl = https://example.com/me/herm.git\n',
        );
        await r.hermes((db) => {
            hermesSession(db, "parent-one", { cwd: repo });
            hermesMessage(db, 1, "user", "Synthetic question.", {
                session: "parent-one",
            });
            hermesSession(db, "child-one", { cwd: repo });
            db.run(
                "UPDATE sessions SET parent_session_id = 'parent-one' WHERE id = 'child-one'",
            );
            hermesMessage(db, 2, "assistant", "Synthetic answer.", {
                session: "child-one",
            });
        });
        await r.run({ hosts: ["hermes"] });
        expect(
            r.requests.find((each) => each.session === "child-one"),
        ).toMatchObject({
            host: "hermes",
            parent: "parent-one",
            project: "example.com/me/herm",
        });
        const found = await r.conversations();
        expect(found).toHaveLength(2);
        expect(
            found
                .flat()
                .find((event) => event.sourceSession === "hermes:child-one"),
        ).toMatchObject({
            parentSession: "hermes:parent-one",
        });
    });

    it("leaves a Hermes session from a chat platform personal", async () => {
        await r.hermes((db) => {
            hermesSession(db, "chat-one", { source: "telegram" });
            hermesMessage(db, 1, "user", "Synthetic question.", {
                session: "chat-one",
            });
        });
        await r.run({ hosts: ["hermes"] });
        expect(r.requests[0]?.project).toBeUndefined();
        expect(r.recorded[0]).toMatchObject({ project: null });
    });

    it("visits only the hosts it is given", async () => {
        await r.file(rollout(), text(...speech), 0);
        const result = await r.run({ hosts: [] });
        expect(result).toEqual([]);
        expect(r.requests).toEqual([]);
    });
});

describe("what is remembered and when", () => {
    it("does not remember a read the archive refused, and tries again", async () => {
        await r.file(rollout(), text(...speech), 0);
        const failing = await r.run({
            hosts: ["codex"],
            record: async () => {
                throw new Error("the store could not be locked");
            },
        });
        expect(only(failing, "codex").error).toBe(
            "the store could not be locked",
        );
        expect(await r.conversations()).toEqual([]);
        const hints = JSON.parse(await readFile(sweepPath(r.env), "utf8"));
        expect(hints.sessions).toEqual({});
        const retried = await r.run({ hosts: ["codex"] });
        expect(only(retried, "codex")).toMatchObject({
            sessions: 1,
            events: 2,
            error: null,
        });
    });

    it("stops one host and goes on to the next", async () => {
        await r.file(rollout(), text(...speech), 0);
        await r.hermes((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Synthetic question.");
        });
        const result = await r.run({
            hosts: ["codex", "hermes"],
            record: async (request) => {
                if (request.host === "codex")
                    throw new Error("codex store down");
                return {
                    accepted: 1,
                    duplicates: 0,
                    through: "1",
                    phrase: "a-b-c-d",
                };
            },
        });
        expect(only(result, "codex").error).toBe("codex store down");
        expect(only(result, "hermes")).toMatchObject({
            error: null,
            sessions: 1,
        });
        expect(
            r.logs.some((log) =>
                log.startsWith("error recording: codex stopped"),
            ),
        ).toBe(true);
    });

    it("skips a session that vanishes after listing, not its host", async () => {
        const gone = await r.file(
            rollout("rollout-gone.jsonl"),
            text(...speech),
            0,
        );
        await r.file(
            rollout("rollout-kept.jsonl"),
            text(meta(), message("user", "Synthetic.", 1)),
            0,
        );
        const { codexSource } = await import("./sources.js");
        const source = codexSource(r.env);
        const result = await r.run({
            hosts: ["codex"],
            sources: {
                codex: {
                    host: "codex",
                    list: async () => {
                        const listed = await source.list();
                        await rm(gone);
                        return listed;
                    },
                },
            },
        });
        expect(only(result, "codex")).toMatchObject({
            sessions: 1,
            skipped: 1,
            error: null,
            failed: 0,
        });
    });

    it("counts a session it cannot read and goes on to the others", async () => {
        const { codexSource } = await import("./sources.js");
        const source = codexSource(r.env);
        await r.file(rollout("rollout-a.jsonl"), text(...speech), 0);
        await r.file(
            rollout("rollout-b.jsonl"),
            text(meta(), message("user", "Synthetic.", 1)),
            0,
        );
        const result = await r.run({
            hosts: ["codex"],
            sources: {
                codex: {
                    host: "codex",
                    list: async () =>
                        (await source.list()).map((each, index) => ({
                            ...each,
                            read: async (previous) => {
                                if (index === 0) throw new Error("denied");
                                return each.read(previous);
                            },
                        })),
                },
            },
        });
        expect(only(result, "codex")).toMatchObject({
            failed: 1,
            sessions: 1,
            error: null,
        });
    });

    it("forgets the hints of a session no longer listed", async () => {
        const path = await r.file(rollout(), text(...speech), 0);
        await r.run({ hosts: ["codex"] });
        await rm(path);
        await r.run({ hosts: ["codex"] });
        const hints = JSON.parse(await readFile(sweepPath(r.env), "utf8"));
        expect(hints.sessions).toEqual({});
    });

    it("does not remember a read that was torn, nor keep anything aside", async () => {
        const path = rollout();
        await r.file(
            path,
            `${text(...speech)}{"timestamp":"2026-10-20T09:00:03.000Z","ty`,
            0,
        );
        const first = only(await r.run({ hosts: ["codex"] }), "codex");
        expect(first).toMatchObject({ sessions: 1, events: 2, halted: 0 });
        expect(
            await readdir(join(r.home, "state/dorothy")).catch(() => []),
        ).not.toContain("unread");
        r.requests.length = 0;
        await r.run({ hosts: ["codex"] });
        expect(r.requests).toHaveLength(1);
    });

    it("holds the events behind an unanswered call until it ages, then records it failed", async () => {
        await r.file(
            rollout(),
            text(
                meta(),
                context(),
                message("user", "Synthetic.", 1),
                call("function_call", "c1", "tool", "{}", 2),
                message("assistant", "Synthetic after.", 4),
            ),
            0,
        );
        const young = only(await r.run({ hosts: ["codex"] }), "codex");
        expect(young.events).toBe(1);
        r.requests.length = 0;
        // Unremembered, so read again; two hours on, the call is over.
        const later = only(
            await r.run({
                hosts: ["codex"],
                now: () => new Date(NOW.getTime() + 2 * HOUR),
            }),
            "codex",
        );
        expect(later.events).toBe(2);
        const [conversation] = await r.conversations();
        expect(conversation?.map((event) => event.kind)).toEqual([
            "session",
            "user",
            "tool",
            "assistant",
        ]);
        expect(conversation?.[2]).toMatchObject({ ok: false });
    });

    it("pairs a call with its output when it arrives", async () => {
        const path = await r.file(
            rollout(),
            text(
                meta(),
                context(),
                call("function_call", "c1", "tool", "{}", 2),
            ),
            0,
        );
        expect(only(await r.run({ hosts: ["codex"] }), "codex").events).toBe(0);
        await r.append(
            path,
            text(output("function_call_output", "c1", "Synthetic result.", 3)),
        );
        expect(only(await r.run({ hosts: ["codex"] }), "codex").events).toBe(1);
    });
});

describe("a session that halts", () => {
    const bad = line(
        "response_item",
        { type: "message", role: "user", content: "not blocks" },
        3,
    );

    it("records what precedes the bad record and keeps the rest aside", async () => {
        const lines = [...speech, bad, message("user", "Synthetic after.", 4)];
        await r.file(rollout(), text(...lines), 0);
        const first = only(await r.run({ hosts: ["codex"] }), "codex");
        expect(first).toMatchObject({
            sessions: 1,
            events: 2,
            halted: 1,
            error: null,
        });
        const record = await readRecord(r.env, SESSION, "codex");
        expect(record).toMatchObject({
            host: "codex",
            line: 5,
            conversation: expect.any(String),
        });
        expect(await readFile(copyPath(r.env, SESSION, "codex"), "utf8")).toBe(
            `${bad}\n${lines[5]}\n`,
        );
        expect(
            r.logs.filter(
                (log) => log.startsWith("error") && log.includes("halted"),
            ),
        ).toHaveLength(1);
    });

    it("is never remembered, is read again, and is told only once", async () => {
        await r.file(rollout(), text(...speech, bad), 0);
        await r.run({ hosts: ["codex"] });
        r.requests.length = 0;
        const again = only(await r.run({ hosts: ["codex"] }), "codex");
        expect(again).toMatchObject({ halted: 1, skipped: 0, events: 0 });
        expect(r.requests).toHaveLength(1);
        expect(r.logs.filter((log) => log.includes("halted"))).toHaveLength(1);
    });

    it("resolves once the session reads to its end", async () => {
        const path = await r.file(rollout(), text(...speech, bad), 0);
        await r.run({ hosts: ["codex"] });
        await r.file(
            path,
            text(...speech, message("user", "Synthetic repaired.", 3)),
            0,
        );
        const fixed = only(await r.run({ hosts: ["codex"] }), "codex");
        expect(fixed).toMatchObject({ halted: 0, events: 1 });
        expect(await readRecord(r.env, SESSION, "codex")).toBeNull();
        const hints = JSON.parse(await readFile(sweepPath(r.env), "utf8"));
        expect(Object.keys(hints.sessions)).toHaveLength(1);
    });

    it("keeps a Hermes halt by its row, filed under its host", async () => {
        await r.hermes((db) => {
            hermesSession(db);
            hermesMessage(db, 1, "user", "Synthetic question.");
            hermesMessage(db, 2, "user", "\0json:{");
            hermesMessage(db, 3, "user", "Synthetic after.");
        });
        const result = only(await r.run({ hosts: ["hermes"] }), "hermes");
        expect(result.halted).toBe(1);
        expect(
            await readRecord(r.env, "fixture-session", "hermes"),
        ).toMatchObject({
            host: "hermes",
            session: "fixture-session",
        });
    });

    it("keeps one example of an unknown type and says so once", async () => {
        await r.file(
            rollout(),
            text(...speech, line("future_type", { x: 1 }, 3)),
            0,
        );
        await r.run({ hosts: ["codex"] });
        await r.append(rollout(), text(message("user", "Synthetic more.", 6)));
        await r.run({ hosts: ["codex"] });
        const types = await readdir(join(r.home, "state/dorothy/unread/types"));
        expect(types).toHaveLength(1);
        expect(r.logs.filter((log) => log.includes("new type"))).toHaveLength(
            1,
        );
        expect((await r.conversations())[0]).toHaveLength(4);
    });
});
