// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/engine/archive.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcriptPath } from "../transcript.js";
import { type Archive, openArchive } from "./archive.js";
import { fixturePhrase, writeArchive } from "./fixture.js";

let root: string;
let env: Record<string, string>;
let archive: Archive | null = null;
const [tea, reader, secret, peeker, lost] = [1, 2, 3, 4, 5].map(
    fixturePhrase,
) as [string, string, string, string, string];
const at = "2026-10-15T09:30:00.000Z";

beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "dorothy-archive-"));
    env = {
        HOME: root,
        XDG_DATA_HOME: join(root, "data"),
        XDG_CACHE_HOME: join(root, "cache"),
        XDG_STATE_HOME: join(root, "state"),
        XDG_CONFIG_HOME: join(root, "config"),
    };
    await writeArchive(env, {
        conversations: [
            {
                phrase: tea,
                project: "github.com/me/app",
                title: "Tea",
                turns: [
                    { role: "user", text: "I like green tea.", at },
                    { role: "assistant", text: "Noted.", at },
                ],
            },
            {
                phrase: reader,
                title: "Asking",
                turns: [
                    { role: "user", text: "What tea do I like?", at },
                    { role: "assistant", text: "Green tea.", at },
                ],
                reads: [
                    {
                        id: "t1",
                        target: { conversation: tea },
                        purpose: "which tea the user likes",
                        served: "essential",
                    },
                    {
                        id: "t2",
                        target: { fact: "personal/likes-tea" },
                        purpose: "the user's tea",
                        served: "useful",
                    },
                    {
                        id: "t3",
                        target: { conversation: tea },
                        purpose: "an idle look",
                        served: "none",
                    },
                    {
                        id: "t4",
                        target: { fact: "github.com/me/app/pot" },
                        purpose: "the app's teapot",
                        served: "useful",
                    },
                ],
            },
            {
                phrase: secret,
                hidden: true,
                turns: [{ role: "user", text: "Hidden.", at }],
            },
            {
                phrase: peeker,
                hidden: true,
                turns: [
                    { role: "user", text: "Peeking.", at },
                    { role: "assistant", text: "Peeked.", at },
                ],
                reads: [
                    {
                        id: "p1",
                        target: { conversation: tea },
                        purpose: "what a hidden reader wanted",
                        served: "essential",
                    },
                ],
            },
            {
                phrase: lost,
                turns: [
                    { role: "user", text: "Soon lost.", at },
                    { role: "assistant", text: "Lost.", at },
                ],
                reads: [
                    {
                        id: "l1",
                        target: { conversation: tea },
                        purpose: "what a lost transcript wanted",
                        served: "useful",
                    },
                ],
            },
        ],
        knowledge: [
            {
                scope: "personal",
                name: "likes-tea",
                title: "Likes tea",
                body: "The user likes green tea.",
                at,
            },
            {
                scope: "github.com/me/app",
                name: "pot",
                title: "The teapot",
                body: "The app brews in a teapot.",
                at,
            },
            {
                scope: "personal",
                name: "likes-coffee",
                title: "Likes coffee",
                body: "The user likes coffee.",
                at,
                retired: { at, why: "No longer true." },
            },
        ],
    });
    archive = await openArchive(env, { now: () => Date.parse(at) });
    // Gone since the index was built: its reads are passed over.
    rmSync(transcriptPath(lost, env));
});
afterEach(() => {
    archive?.close();
    archive = null;
    rmSync(root, { recursive: true, force: true });
});

describe("an archive", () => {
    it("lists the visible conversations with their turns", () => {
        const found = archive?.conversations() ?? [];
        expect(found.map((each) => each.id).sort()).toEqual(
            [`c:${tea}`, `c:${reader}`, `c:${lost}`].sort(),
        );
        const first = found.find((each) => each.phrase === tea);
        expect(first?.project).toBe("github.com/me/app");
        expect(first?.title).toBe("Tea");
        expect(first?.turns.map((turn) => [turn.role, turn.text])).toEqual([
            ["user", "I like green tea."],
            ["assistant", "Noted."],
        ]);
        expect(first?.turns[0]?.at).toBe(at);
    });

    it("lists knowledge, the retired included", async () => {
        const found = (await archive?.knowledge()) ?? [];
        const byId = new Map(found.map((each) => [each.id, each]));
        expect(byId.get("k:personal/likes-tea")?.retired).toBeNull();
        expect(byId.get("k:personal/likes-tea")?.scope).toBe("personal");
        expect(byId.get("k:projects/github.com/me/app/pot")?.scope).toBe(
            "github.com/me/app",
        );
        expect(byId.get("k:personal/likes-coffee")?.retired?.why).toBe(
            "No longer true.",
        );
    });

    it("gives the reads appraised useful or essential, with purposes", async () => {
        expect((await archive?.appraisedReads())?.reads).toEqual([
            {
                reader,
                target: `c:${tea}`,
                purpose: "which tea the user likes",
                served: "essential",
                at,
            },
            {
                reader,
                target: "k:personal/likes-tea",
                purpose: "the user's tea",
                served: "useful",
                at,
            },
            {
                reader,
                target: "k:projects/github.com/me/app/pot",
                purpose: "the app's teapot",
                served: "useful",
                at,
            },
        ]);
    });

    it("counts, and gives no purpose of, a hidden reader's reads", async () => {
        const found = await archive?.appraisedReads();
        expect(found?.hidden).toBe(1);
        expect(JSON.stringify(found?.reads)).not.toContain("hidden reader");
    });

    it("says which transcript it could not read", async () => {
        const found = await archive?.appraisedReads();
        expect(found?.unreadable).toEqual([{ reader: lost, code: "ENOENT" }]);
        expect(JSON.stringify(found?.reads)).not.toContain("lost transcript");
    });

    it("makes every directory it creates private", () => {
        const dirs = [join(root, "cache"), join(root, "cache", "dorothy")];
        for (const dir of dirs) {
            expect(statSync(dir).mode & 0o777).toBe(0o700);
        }
    });

    it("builds the opening block from live knowledge", async () => {
        const block = await archive?.block({
            project: null,
            budget: 8000,
            exclude: null,
        });
        expect(block?.ids).toContain("k:personal/likes-tea");
        expect(block?.ids).not.toContain("k:personal/likes-coffee");
        expect(block?.text).toContain("<memory>");
    });

    it("searches through its engine", async () => {
        const hits = await archive?.engine.search({
            query: "green tea",
            within: "all",
            kind: "all",
            limit: 10,
            project: null,
        });
        expect(hits?.map((hit) => hit.id)).toContain(`c:${tea}`);
    });
});
