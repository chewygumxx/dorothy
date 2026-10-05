// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/catalogue.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newPhrase } from "../session-id.js";
import { scanCatalogue, visitsOf } from "./catalogue.js";
import { EMPTY_SIDECAR, sidecarPath } from "./sidecar.js";

const phrase = (seed: number) =>
    newPhrase(() => Uint8Array.from([seed, 1, 2, 3, 4, 5, 6, 7]));
const event = (kind: string, at: string, fields: object = {}) =>
    JSON.stringify({ v: 1, kind, at, ...fields });
const session = (at: string) =>
    event("session", at, {
        phrase: "p",
        sdkSessionId: "s",
        model: "m",
        promptSha256: "h",
        resumed: false,
    });
const user = (at: string, text = "hi") => event("user", at, { text });
const reply = (at: string, text = "hello") =>
    event("assistant", at, { text, interrupted: false });

const T1 = "2026-10-01T00:00:00.000Z";
const T2 = "2026-10-01T00:01:00.000Z";
const T3 = "2026-10-01T00:01:05.000Z";
const T4 = "2026-10-02T00:00:00.000Z";

describe("visitsOf", () => {
    it("counts a visit per session the user spoke in", () => {
        const text = [
            session(T1),
            user(T2),
            reply(T3),
            user("2026-10-01T00:02:00.000Z"),
            session(T4),
            session("2026-10-03T00:00:00.000Z"),
            user("2026-10-03T00:05:00.000Z"),
        ].join("\n");
        expect(visitsOf(text)).toEqual([
            { userTurns: 2, lastAt: Date.parse("2026-10-01T00:02:00.000Z") },
            { userTurns: 1, lastAt: Date.parse("2026-10-03T00:05:00.000Z") },
        ]);
    });

    it("counts a message sent before the session was ready in its first visit", () => {
        const text = [user(T1), session(T2), user(T3)].join("\n");
        expect(visitsOf(text)).toEqual([
            { userTurns: 2, lastAt: Date.parse(T3) },
        ]);
    });

    it("skips malformed lines, and a visit with no time it can read", () => {
        const text = [
            "not json",
            session(T1),
            event("user", "yesterday", { text: "hi" }),
        ].join("\n");
        expect(visitsOf(text)).toEqual([]);
    });
});

describe("scanCatalogue", () => {
    let dir = "";
    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "dorothy-catalogue-"));
    });
    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("lists each transcript the user spoke in, with its sidecar", async () => {
        const [a, b, c, d] = [phrase(1), phrase(2), phrase(3), phrase(4)];
        await writeFile(
            join(dir, `${a}.jsonl`),
            [session(T1), user(T2), reply(T3)].join("\n"),
        );
        await writeFile(join(dir, `${b}.jsonl`), session(T1));
        await writeFile(
            join(dir, `${c}.jsonl`),
            [session(T1), user(T2)].join("\n"),
        );
        await writeFile(sidecarPath(dir, c), "{ broken");
        await writeFile(
            join(dir, `${d}.jsonl`),
            [session(T1), user(T4)].join("\n"),
        );
        await writeFile(
            sidecarPath(dir, d),
            JSON.stringify({ v: 1, title: "Hi" }),
        );
        await writeFile(join(dir, "notes.txt"), "");
        await writeFile(join(dir, "not-a-phrase.jsonl"), user(T2));

        const { entries, warnings } = await scanCatalogue(dir).load();
        const byPhrase = new Map(entries.map((entry) => [entry.phrase, entry]));
        expect([...byPhrase.keys()].sort()).toEqual([a, c, d].sort());
        expect(byPhrase.get(a)).toEqual({
            phrase: a,
            sidecar: { kind: "none" },
            visits: [{ userTurns: 1, lastAt: Date.parse(T2) }],
            reads: [],
            turns: 2,
            lastActive: Date.parse(T2),
        });
        expect(byPhrase.get(c)?.sidecar.kind).toBe("unparseable");
        expect(byPhrase.get(d)?.sidecar).toEqual({
            kind: "ok",
            sidecar: { ...EMPTY_SIDECAR, title: "Hi" },
        });
        expect(warnings).toEqual([
            expect.stringContaining(sidecarPath(dir, c)),
        ]);
    });

    it("is empty, quietly, before the first chat", async () => {
        expect(await scanCatalogue(join(dir, "none")).load()).toEqual({
            entries: [],
            warnings: [],
        });
    });

    it("warns of a transcript it cannot read and carries on", async () => {
        const a = phrase(1);
        await mkdir(join(dir, `${a}.jsonl`));
        const loaded = await scanCatalogue(dir).load();
        expect(loaded.entries).toEqual([]);
        expect(loaded.warnings).toEqual([
            expect.stringContaining(`${a}.jsonl`),
        ]);
    });
});
