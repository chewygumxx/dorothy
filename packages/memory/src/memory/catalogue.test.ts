// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/catalogue.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newPhrase } from "@dorothy/core";
import { RecallIndex } from "../recall/store.js";
import { indexCatalogue } from "./catalogue.js";
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
        promptHash: "h",
        resumed: false,
    });
const user = (at: string, text = "hi") => event("user", at, { text });
const reply = (at: string, text = "hello") =>
    event("assistant", at, { text, interrupted: false });

const T1 = "2026-10-01T00:00:00.000Z";
const T2 = "2026-10-01T00:01:00.000Z";
const T3 = "2026-10-01T00:01:05.000Z";
const T4 = "2026-10-02T00:00:00.000Z";

let dir = "";
let index: RecallIndex;
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-catalogue-"));
    index = RecallIndex.open(join(dir, "index", "recall.sqlite"));
});
afterEach(async () => {
    index.close();
    await rm(dir, { recursive: true, force: true });
});

const transcript = (of: string, lines: string[]) =>
    writeFile(join(dir, `${of}.jsonl`), `${lines.join("\n")}\n`);
const opened = (at: string, id: string, target: string) =>
    event("recall", at, {
        id,
        ok: true,
        offset: 0,
        tool: "open",
        conversation: target,
        name: target,
        purpose: "p",
        turns: [1, 1],
    });

describe("indexCatalogue", () => {
    it("lists each transcript the user spoke in, with its sidecar", async () => {
        const a = phrase(1);
        const silent = phrase(2);
        await transcript(a, [
            session(T1),
            user(T2),
            reply(T3),
            session(T4),
            user(T4),
        ]);
        await transcript(silent, [session(T1)]);
        await writeFile(
            sidecarPath(dir, a),
            JSON.stringify({ ...EMPTY_SIDECAR, title: "Hello" }),
        );
        const { entries, warnings } = await indexCatalogue(index, dir).load();
        expect(warnings).toEqual([]);
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({
            phrase: a,
            visits: [
                { userTurns: 1, lastAt: Date.parse(T2) },
                { userTurns: 1, lastAt: Date.parse(T4) },
            ],
            reads: [],
            turns: 3,
            lastActive: Date.parse(T4),
        });
        expect(entries[0]?.sidecar).toMatchObject({
            kind: "ok",
            sidecar: { title: "Hello" },
        });
    });

    it("warns of a sidecar it cannot parse", async () => {
        const a = phrase(1);
        await transcript(a, [session(T1), user(T2)]);
        await writeFile(sidecarPath(dir, a), "{");
        const { entries, warnings } = await indexCatalogue(index, dir).load();
        expect(entries[0]?.sidecar.kind).toBe("unparseable");
        expect(warnings).toEqual([
            expect.stringContaining(`memory: ${sidecarPath(dir, a)}: `),
        ]);
    });

    // Root ignores file modes, so there is nothing to make unreadable.
    const unreadable = process.getuid?.() === 0 ? it.skip : it;

    unreadable(
        "lists the readable conversations and warns of one it cannot read",
        async () => {
            const a = phrase(1);
            const b = phrase(2);
            const c = phrase(3);
            await transcript(a, [session(T1), user(T2)]);
            await transcript(b, [session(T1), user(T2)]);
            await transcript(c, [session(T1), user(T2)]);
            await chmod(join(dir, `${b}.jsonl`), 0o000);
            const { entries, warnings } = await indexCatalogue(
                index,
                dir,
            ).load();
            expect(entries.map((entry) => entry.phrase)).toEqual([a, c]);
            expect(warnings).toEqual([
                expect.stringContaining(`memory: ${join(dir, `${b}.jsonl`)}: `),
            ]);
        },
    );

    it("gives each conversation its appraised reads by others", async () => {
        const a = phrase(1);
        const b = phrase(2);
        await transcript(b, [session(T1), user(T1)]);
        await transcript(a, [
            session(T2),
            user(T2),
            opened(T3, "toolu_1", b),
            reply(T3),
        ]);
        await writeFile(
            sidecarPath(dir, a),
            JSON.stringify({
                ...EMPTY_SIDECAR,
                appraisals: {
                    toolu_1: { served: "essential", at: T4, model: "m" },
                },
            }),
        );
        const { entries } = await indexCatalogue(index, dir).load();
        expect(entries.find((entry) => entry.phrase === b)?.reads).toEqual([
            { at: Date.parse(T3), served: "essential" },
        ]);
    });

    it("is empty, quietly, before the first chat", async () => {
        expect(
            await indexCatalogue(index, join(dir, "missing")).load(),
        ).toEqual({ entries: [], warnings: [] });
    });

    it("warns when the index cannot be brought up to date", async () => {
        const file = join(dir, "not-a-directory");
        await writeFile(file, "");
        const { entries, warnings } = await indexCatalogue(index, file).load();
        expect(entries).toEqual([]);
        expect(warnings).toEqual([expect.stringMatching(/^memory: /)]);
    });

    it("reads the index through its queue, in a transaction", async () => {
        const a = phrase(1);
        await transcript(a, [session(T1), user(T2)]);
        const inTransaction: boolean[] = [];
        const query = index.db.query.bind(index.db);
        spyOn(index.db, "query").mockImplementation(((sql: string) => {
            if (sql.includes("SELECT phrase, sidecar, turns")) {
                inTransaction.push(index.db.inTransaction);
            }
            return query(sql);
        }) as typeof index.db.query);
        const { entries } = await indexCatalogue(index, dir).load();
        expect(entries).toHaveLength(1);
        expect(inTransaction).toEqual([true]);
    });

    it("warns when the index cannot be read", async () => {
        const a = phrase(1);
        await transcript(a, [session(T1), user(T2)]);
        const query = index.db.query.bind(index.db);
        spyOn(index.db, "query").mockImplementation(((sql: string) => {
            if (sql.includes("SELECT phrase, sidecar, turns")) {
                throw new Error("disk image is malformed");
            }
            return query(sql);
        }) as typeof index.db.query);
        const { entries, warnings } = await indexCatalogue(index, dir).load();
        expect(entries).toEqual([]);
        expect(warnings).toEqual(["memory: disk image is malformed"]);
        // The failed read left no transaction open behind it.
        expect(index.db.inTransaction).toBe(false);
    });
});
