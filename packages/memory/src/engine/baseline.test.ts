// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/engine/baseline.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Env, newPhrase } from "@dorothy/core";
import type { Fact } from "../facts/file.js";
import { dataRoot, PERSONAL, putFact, type Scope } from "../facts/store.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { transcriptDir, transcriptPath } from "../transcript.js";
import { baselineEngine } from "./baseline.js";
import { UNCONFIRMED } from "./engine.js";

const AT = "2026-10-15T09:30:00.000Z";
const fact = (name: string, fields: Partial<Fact> = {}): Fact => ({
    name,
    title: name.replaceAll("-", " "),
    description: `About ${name}.`,
    type: "user",
    extra: {},
    tags: [],
    importance: null,
    provenance: { origin: "user", by: "user", at: AT, created: AT },
    retired: null,
    body: `Body of ${name}.`,
    ...fields,
});
const line = (kind: string, minute: number, fields: object = {}) =>
    `${JSON.stringify({ v: 1, kind, at: new Date(Date.parse(AT) + minute * 60000).toISOString(), ...fields })}\n`;
// A conversation in the temporary root, of a project or none.
const converse = (seed: number, project: string | null, text: string) => {
    const phrase = newPhrase(() =>
        Uint8Array.from([seed, 1, 2, 3, 4, 5, 6, 7]),
    );
    mkdirSync(transcriptDir(env), { recursive: true });
    writeFileSync(
        transcriptPath(phrase, env),
        line("session", 0, {
            phrase: "p",
            sdkSessionId: "",
            model: "m",
            promptHash: "",
            resumed: false,
            ...(project === null ? {} : { project }),
        }) + line("user", 1, { text }),
    );
    return phrase;
};
const APP: Scope = { kind: "project", id: "github.com/me/app" };
const OTHER: Scope = { kind: "project", id: "github.com/me/other" };

let home: string;
let env: Env;
let index: RecallIndex;

beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "dorothy-engine-"));
    env = {
        HOME: home,
        XDG_DATA_HOME: join(home, "data"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_STATE_HOME: join(home, "state"),
    };
    mkdirSync(join(home, "cache", "dorothy"), { recursive: true });
    index = RecallIndex.open(indexPath(env));
    const root = dataRoot(env);
    await putFact(root, PERSONAL, fact("drinks-water", { type: "reference" }));
    await putFact(root, PERSONAL, fact("likes-tea"));
    await putFact(root, PERSONAL, fact("hates-noise", { type: "feedback" }));
    await putFact(root, APP, fact("uses-rust", { type: "project" }));
    await putFact(root, OTHER, fact("uses-go", { type: "project" }));
    await putFact(
        root,
        PERSONAL,
        fact("old-job", {
            retired: { at: AT, by: "user", why: "Left." },
        }),
    );
});
afterEach(() => {
    index.close();
    rmSync(home, { recursive: true, force: true });
});

const engine = (reviewed: string[] = []) =>
    baselineEngine({
        env,
        index,
        halfLifeDays: 30,
        reviewer: {
            review: async (phrase: string) => {
                reviewed.push(phrase);
                return { kind: "none" };
            },
        },
        now: () => Date.parse(AT),
    });

describe("rankKnowledge", () => {
    it("gives live personal knowledge, user and feedback first, then the project's", async () => {
        const items = await engine().rankKnowledge({
            project: "github.com/me/app",
        });
        expect(items.map((item) => item.id)).toEqual([
            "k:personal/likes-tea",
            "k:personal/hates-noise",
            "k:personal/drinks-water",
            "k:projects/github.com/me/app/uses-rust",
        ]);
    });

    it("gives personal knowledge alone outside a project", async () => {
        const items = await engine().rankKnowledge({ project: null });
        expect(items.every((item) => item.scope.kind === "personal")).toBe(
            true,
        );
    });
});

describe("search", () => {
    it("finds knowledge within the scopes allowed", async () => {
        const mine = await engine().search({
            query: "uses",
            within: ["personal", "github.com/me/app"],
            kind: "knowledge",
            limit: 10,
            project: "github.com/me/app",
        });
        expect(mine.map((hit) => hit.id)).toEqual([
            "k:projects/github.com/me/app/uses-rust",
        ]);
        const all = await engine().search({
            query: "uses",
            within: "all",
            kind: "knowledge",
            limit: 10,
            project: "github.com/me/app",
        });
        expect(all.map((hit) => hit.id).sort()).toEqual([
            "k:projects/github.com/me/app/uses-rust",
            "k:projects/github.com/me/other/uses-go",
        ]);
    });

    it("marks knowledge the user has not confirmed", async () => {
        await putFact(
            dataRoot(env),
            PERSONAL,
            fact("guesses-tea", {
                provenance: {
                    origin: "dorothy",
                    by: "dorothy",
                    at: AT,
                    created: AT,
                },
            }),
        );
        const hits = await engine().search({
            query: "tea",
            within: ["personal"],
            kind: "knowledge",
            limit: 10,
            project: null,
        });
        const marks = Object.fromEntries(
            hits.map((hit) => [hit.id, hit.unconfirmed ?? null]),
        );
        expect(marks).toEqual({
            "k:personal/guesses-tea": UNCONFIRMED,
            "k:personal/likes-tea": null,
        });
    });
});

describe("search before its cut", () => {
    it("scopes to a project beyond the limit's worth of others", async () => {
        const root = dataRoot(env);
        for (let at = 0; at < 12; at++) {
            await putFact(root, PERSONAL, fact(`widget-${at}`));
        }
        await putFact(root, OTHER, fact("widget-go"));
        const hits = await engine().search({
            query: "widget",
            within: ["github.com/me/other"],
            kind: "knowledge",
            limit: 10,
            project: "github.com/me/app",
        });
        expect(hits.map((hit) => hit.id)).toEqual([
            "k:projects/github.com/me/other/widget-go",
        ]);
    });

    it("scopes conversations to a project among others", async () => {
        for (let at = 0; at < 12; at++) {
            converse(at + 1, "github.com/me/app", "kumquat");
        }
        const mine = converse(
            100,
            "github.com/me/other",
            "kumquat among many other words that dilute the match here",
        );
        const hits = await engine().search({
            query: "kumquat",
            within: ["github.com/me/other"],
            kind: "episodes",
            limit: 10,
            project: "github.com/me/app",
        });
        expect(hits.map((hit) => hit.id)).toEqual([`c:${mine}`]);
        expect(hits[0]?.scope).toBe("github.com/me/other");
    });

    it("never gives a retired fact as live", async () => {
        const hits = await engine().search({
            query: "old",
            within: "all",
            kind: "knowledge",
            limit: 10,
            project: null,
        });
        expect(hits).toEqual([]);
    });
});

describe("extract", () => {
    it("reviews the conversation and proposes nothing yet", async () => {
        const reviewed: string[] = [];
        const proposals = await engine(reviewed).extract(
            "bingo-overabundance-mazer-kasha",
            new AbortController().signal,
        );
        expect(proposals).toEqual([]);
        expect(reviewed).toEqual(["bingo-overabundance-mazer-kasha"]);
    });
});

describe("rankEpisodes", () => {
    it("gives none without conversations", async () => {
        expect(await engine().rankEpisodes({ project: null })).toEqual([]);
    });
});
