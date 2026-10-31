// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/evidence.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { baselineEngine } from "../engine/baseline.js";
import { fixturePhrase, writeArchive } from "../engine/fixture.js";
import { dataRoot } from "../facts/store.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { indexEvidence } from "./evidence.js";

let root: string;
let env: Record<string, string>;
let index: RecallIndex;
const [tea, secret] = [1, 3].map(fixturePhrase) as [string, string];
const at = "2026-10-15T09:30:00.000Z";

beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "dorothy-evidence-"));
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
                phrase: secret,
                hidden: true,
                turns: [{ role: "user", text: "A secret.", at }],
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
        ],
    });
    mkdirSync(dirname(indexPath(env)), { recursive: true });
    index = RecallIndex.open(indexPath(env));
    await baselineEngine({
        env,
        index,
        halfLifeDays: 30,
        reviewer: null,
    }).index();
});
afterEach(() => {
    index.close();
    rmSync(root, { recursive: true, force: true });
});

describe("indexEvidence", () => {
    it("gives a visible conversation's turns in order", async () => {
        const found = await indexEvidence(index, dataRoot(env)).conversation(
            `c:${tea}`,
        );
        expect(found).toMatchObject({
            id: `c:${tea}`,
            phrase: tea,
            project: "github.com/me/app",
            title: "Tea",
        });
        expect(found?.turns.map((turn) => turn.text)).toEqual([
            "I like green tea.",
            "Noted.",
        ]);
        expect(found?.turns[0]?.at).toBe(at);
    });

    it("gives nothing for a hidden, unknown or malformed id", async () => {
        const evidence = indexEvidence(index, dataRoot(env));
        expect(await evidence.conversation(`c:${secret}`)).toBeUndefined();
        expect(await evidence.conversation("c:nothing-here")).toBeUndefined();
        expect(
            await evidence.conversation("k:personal/likes-tea"),
        ).toBeUndefined();
    });

    it("gives knowledge by its id", async () => {
        const evidence = indexEvidence(index, dataRoot(env));
        expect(await evidence.knowledge("k:personal/likes-tea")).toMatchObject({
            title: "Likes tea",
            scope: "personal",
            body: "The user likes green tea.",
            retired: null,
        });
        expect(await evidence.knowledge("k:personal/nothing")).toBeUndefined();
        expect(await evidence.knowledge("c:nothing")).toBeUndefined();
    });

    it("gives a project's knowledge by its id", async () => {
        await writeArchive(env, {
            conversations: [],
            knowledge: [
                {
                    scope: "github.com/me/app",
                    name: "uses-rust",
                    title: "Uses Rust",
                    body: "The app is in Rust.",
                    at,
                },
            ],
        });
        expect(
            await indexEvidence(index, dataRoot(env)).knowledge(
                "k:projects/github.com/me/app/uses-rust",
            ),
        ).toMatchObject({ scope: "github.com/me/app", title: "Uses Rust" });
    });
});
