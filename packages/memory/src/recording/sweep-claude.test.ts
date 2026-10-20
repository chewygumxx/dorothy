// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recording/sweep-claude.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
    assistantLine,
    SESSION,
    text,
    result as toolResult,
    use,
    userLine,
} from "../bodies/fixtures.js";
import type { SessionReport } from "../bodies/record.js";
import { copyPath, readRecord } from "../bodies/unread.js";
import { sessionPhrase } from "../recall/sync.js";
import { sweepPath } from "./state.js";
import { HOUR, NOW, type Rig, rig } from "./sweep-testing.js";

let r: Rig;
beforeEach(async () => {
    r = await rig();
});
afterEach(async () => {
    await r.close();
});

const transcript = () =>
    join(r.home, ".claude/projects/-work", `${SESSION}.jsonl`);
const lines = (...each: string[]) => `${each.join("\n")}\n`;
const hello = [
    userLine("u1", 0, "Synthetic question."),
    assistantLine("a1", 1, [text("Synthetic answer.")]),
];
const report = (over: Partial<SessionReport> = {}): SessionReport => ({
    session: SESSION,
    transcript: transcript(),
    dir: dirname(transcript()),
    since: null,
    ended: false,
    ...over,
});
const uuids = (events: Record<string, unknown>[]) =>
    events.filter((event) => event.kind !== "session").map((e) => e.sourceUuid);
const only = (result: Awaited<ReturnType<Rig["run"]>>) => {
    const found = result.find((each) => each.host === "claude-code");
    if (!found) throw new Error("no result for claude-code");
    return found;
};
const claude = (options = {}) => r.run({ hosts: ["claude-code"], ...options });

describe("sweeping Claude Code", () => {
    it("records a session as one conversation through its recorder", async () => {
        await r.file(transcript(), lines(...hello), 0);
        const result = only(await claude());
        expect(result).toMatchObject({ sessions: 1, events: 2, error: null });
        const [conversation, ...more] = await r.conversations();
        expect(more).toEqual([]);
        expect(conversation?.[0]).toMatchObject({
            kind: "session",
            source: "claude-code",
            sourceSession: SESSION,
        });
        expect(uuids(conversation ?? [])).toEqual(["u1", "a1"]);
        expect(r.recorded).toMatchObject([
            { host: "claude-code", session: SESSION, accepted: 2 },
        ]);
    });

    it("skips an unchanged session and reads an appended one again", async () => {
        await r.file(transcript(), lines(...hello), 0);
        await claude();
        expect(only(await claude())).toMatchObject({ skipped: 1, events: 0 });
        await r.append(
            transcript(),
            lines(userLine("u2", 2, "Synthetic more.")),
        );
        expect(only(await claude())).toMatchObject({ sessions: 1, events: 1 });
        expect(uuids((await r.conversations())[0] ?? [])).toEqual([
            "u1",
            "a1",
            "u2",
        ]);
    });

    it("leaves a session older than the watermark to the backfill", async () => {
        await r.file(transcript(), lines(...hello), 3 * HOUR);
        expect(only(await claude())).toMatchObject({ waiting: 1, sessions: 0 });
        const filled = only(await claude({ backfill: true }));
        expect(filled).toMatchObject({ sessions: 1, events: 2 });
        expect(r.recorded.at(-1)).toMatchObject({ backfilled: true });
    });

    it("names the project from the session's directory", async () => {
        const repo = join(r.home, "work/app");
        await mkdir(join(repo, ".git"), { recursive: true });
        await writeFile(
            join(repo, ".git/config"),
            '[remote "origin"]\n\turl = git@github.com:me/app.git\n',
        );
        await r.file(
            transcript(),
            lines(userLine("u1", 0, "Synthetic.", { cwd: repo })),
            0,
        );
        await claude();
        expect(r.recorded[0]).toMatchObject({ project: "github.com/me/app" });
        const [conversation] = await r.conversations();
        expect(conversation?.[0]).toMatchObject({
            project: "github.com/me/app",
        });
    });

    it("hands the recorder a session still young as running, an old one as over", async () => {
        const seen: boolean[] = [];
        const spy = (report: SessionReport, project: string | null) => {
            seen.push(report.ended);
            return r.claude(report, project);
        };
        await r.file(transcript(), lines(...hello), 0);
        await claude({ recordClaude: spy });
        await r.append(
            transcript(),
            lines(userLine("u2", 2, "Synthetic more.")),
        );
        await claude({
            recordClaude: spy,
            now: () => new Date(NOW.getTime() + 2 * HOUR),
        });
        expect(seen).toEqual([false, true]);
    });

    it("does not remember a read holding a call, and records it once the session is over", async () => {
        await r.file(
            transcript(),
            lines(
                userLine("u1", 0, "go"),
                assistantLine("a1", 1, [
                    text("Running."),
                    use("t1", "Bash", { command: "sleep" }),
                ]),
            ),
            0,
        );
        expect(only(await claude())).toMatchObject({ sessions: 1, events: 1 });
        const hints = JSON.parse(await readFile(sweepPath(r.env), "utf8"));
        expect(hints.sessions).toEqual({});
        const later = only(
            await claude({ now: () => new Date(NOW.getTime() + 2 * HOUR) }),
        );
        expect(later).toMatchObject({ sessions: 1, events: 2, skipped: 0 });
        const [conversation] = await r.conversations();
        expect(conversation?.map((event) => event.kind)).toEqual([
            "session",
            "user",
            "assistant",
            "tool",
        ]);
        // Over and read to its end, it is remembered at last.
        expect(
            only(
                await claude({ now: () => new Date(NOW.getTime() + 3 * HOUR) }),
            ),
        ).toMatchObject({ skipped: 1 });
    });

    it("does not fail a Claude call still running during a backfill", async () => {
        await r.file(
            transcript(),
            lines(
                userLine("u1", 0, "Go."),
                assistantLine("a1", 1, [use("active", "Bash", {})]),
            ),
            0,
        );
        await claude({ backfill: true });
        expect(
            JSON.parse(await readFile(sweepPath(r.env), "utf8")).sessions,
        ).toEqual({});
        expect(
            (await r.conversations())
                .flat()
                .filter((event) => event.kind === "tool"),
        ).toEqual([]);
        await r.append(
            transcript(),
            lines(userLine("r1", 2, [toolResult("active", "Done.")])),
        );
        await claude({ backfill: true });
        expect(
            (await r.conversations())
                .flat()
                .filter((event) => event.kind === "tool"),
        ).toMatchObject([{ ok: true, output: "Done." }]);
    });

    it("never records a private session", async () => {
        await r.file(transcript(), lines(...hello), 0);
        const result = only(await claude({ isPrivate: () => true }));
        expect(result).toMatchObject({ private: 1, sessions: 0 });
        expect(await r.conversations()).toEqual([]);
    });

    it("skips a session that vanished before it was recorded", async () => {
        await r.file(transcript(), lines(...hello), 0);
        const result = only(
            await claude({
                recordClaude: async () => ({ kind: "missing", reason: "gone" }),
            }),
        );
        expect(result).toMatchObject({ skipped: 1, error: null });
        const hints = JSON.parse(await readFile(sweepPath(r.env), "utf8"));
        expect(hints.sessions).toEqual({});
    });

    it("stops the host when the store cannot be locked, remembering nothing", async () => {
        await r.file(transcript(), lines(...hello), 0);
        const result = only(
            await claude({ recordClaude: async () => ({ kind: "unlocked" }) }),
        );
        expect(result.error).toBe("the store could not be locked");
        expect(only(await claude())).toMatchObject({ sessions: 1 });
    });

    it("halts at a bad line, keeps the rest aside, and does not remember the read", async () => {
        await r.file(
            transcript(),
            lines(
                userLine("u1", 0, "fine"),
                "{torn but whole",
                userLine("u2", 1, "after"),
            ),
            0,
        );
        expect(only(await claude())).toMatchObject({
            sessions: 1,
            events: 1,
            halted: 1,
        });
        expect(await readRecord(r.env, SESSION)).toMatchObject({ line: 2 });
        expect(await readFile(copyPath(r.env, SESSION), "utf8")).toBe(
            `{torn but whole\n${userLine("u2", 1, "after")}\n`,
        );
        // Not remembered: read again, and now whole.
        await r.file(
            transcript(),
            lines(
                userLine("u1", 0, "fine"),
                userLine("u3", 0, "mended"),
                userLine("u2", 1, "after"),
            ),
            0,
        );
        expect(only(await claude())).toMatchObject({ events: 2, halted: 0 });
        expect(await readRecord(r.env, SESSION)).toBeNull();
    });

    it("keeps a halt of a first line, though nothing was recorded", async () => {
        await r.file(transcript(), lines("{torn but whole"), 0);
        expect(only(await claude())).toMatchObject({ sessions: 0, halted: 1 });
        const hints = JSON.parse(await readFile(sweepPath(r.env), "utf8"));
        expect(hints.sessions).toEqual({});
    });
});

describe("a session dorothy --claude recorded", () => {
    it("continues its conversation when swept, each event once", async () => {
        await r.file(transcript(), lines(...hello), 0);
        const hooked = await r.claude(report(), null);
        if (hooked.kind !== "recorded") throw new Error(hooked.kind);
        await r.append(
            transcript(),
            lines(userLine("u2", 2, "Synthetic more.")),
        );
        const swept = only(await claude());
        expect(swept).toMatchObject({ sessions: 1, events: 1 });
        const found = await r.conversations();
        expect(found).toHaveLength(1);
        expect(uuids(found[0] ?? [])).toEqual(["u1", "a1", "u2"]);
        expect(sessionPhrase(r.index, SESSION)).toBe(hooked.phrase);
        expect(r.recorded[0]?.phrase).toBe(hooked.phrase);
    });

    it("adds nothing when the hooks already recorded it all", async () => {
        await r.file(transcript(), lines(...hello), 0);
        await r.claude(report(), null);
        expect(only(await claude())).toMatchObject({
            sessions: 0,
            events: 0,
            error: null,
        });
        const found = await r.conversations();
        expect(found).toHaveLength(1);
        expect(uuids(found[0] ?? [])).toEqual(["u1", "a1"]);
    });

    it("is continued by the hooks after the sweep recorded it", async () => {
        await r.file(transcript(), lines(...hello), 0);
        await claude();
        await r.append(
            transcript(),
            lines(userLine("u2", 2, "Synthetic more.")),
        );
        const hooked = await r.claude(report(), null);
        expect(hooked).toMatchObject({ kind: "recorded", appended: 1 });
        await claude();
        const found = await r.conversations();
        expect(found).toHaveLength(1);
        expect(uuids(found[0] ?? [])).toEqual(["u1", "a1", "u2"]);
        expect(
            found[0]?.filter((event) => event.kind === "session"),
        ).toHaveLength(1);
    });
});
