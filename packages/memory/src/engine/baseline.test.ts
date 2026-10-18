// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/engine/baseline.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env } from "@dorothy/core";
import type { Fact } from "../facts/file.js";
import { dataRoot, PERSONAL, putFact, type Scope } from "../facts/store.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { baselineEngine } from "./baseline.js";

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
