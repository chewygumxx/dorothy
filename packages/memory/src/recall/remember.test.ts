// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recall/remember.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RememberInput } from "@dorothy/core";
import type { Fact } from "../facts/file.js";
import {
    type FactStore,
    factPath,
    PERSONAL,
    putFact,
    readFactFile,
    type Scope,
} from "../facts/store.js";
import type { Lock } from "../memory/sidecar.js";
import { remember } from "./remember.js";

const AT = "2026-10-15T09:30:00.000Z";
const PROJECT = "github.com/u/here";
const HERE: Scope = { kind: "project", id: PROJECT };
const OPTIONS = { project: PROJECT, from: "bingo-overabundance-mazer-kasha" };

// Runs work one at a time, as the index's lock does.
function serial(): Lock {
    let chain: Promise<unknown> = Promise.resolve();
    return (work) => {
        const run = chain.then(work);
        chain = run.catch(() => {});
        return run;
    };
}

let root = "";
let commits: string[] = [];
let store: FactStore;
beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dorothy-remember-"));
    commits = [];
    store = {
        root,
        lock: serial(),
        recorder: async (_paths, message) => {
            commits.push(message);
        },
        now: () => new Date(AT),
    };
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

const write = (
    name: string,
    fields: Partial<RememberInput> = {},
): RememberInput => ({
    action: "write",
    name,
    scope: "personal",
    type: "user",
    title: "Tea at four",
    description: "She takes tea at four.",
    body: "Every day at four.",
    ...fields,
});
const read = async (scope: Scope, name: string) => {
    const got = await readFactFile(factPath(root, scope, name), name);
    if (got.kind !== "ok") {
        throw new Error(got.kind);
    }
    return got.fact;
};
const theirs = (origin: "user" | "repo"): Partial<Fact> => ({
    provenance: { origin, by: origin, at: AT, created: AT },
});
const fact = (name: string, fields: Partial<Fact> = {}): Fact => ({
    name,
    title: "Theirs",
    description: "Theirs.",
    type: "user",
    extra: {},
    tags: [],
    importance: null,
    provenance: { origin: "dorothy", by: "dorothy", at: AT, created: AT },
    retired: null,
    body: "Theirs.",
    ...fields,
});

describe("remember", () => {
    it("writes a fact as hers, from this conversation, and commits it", async () => {
        expect(await remember(store, write("tea"), OPTIONS)).toEqual({
            action: "written",
            id: "personal/tea",
        });
        const tea = await read(PERSONAL, "tea");
        expect(tea.provenance).toEqual({
            origin: "dorothy",
            by: "dorothy",
            at: AT,
            created: AT,
            from: "bingo-overabundance-mazer-kasha",
        });
        expect(tea.body).toBe("Every day at four.");
        expect(commits).toEqual(["fact: personal/tea"]);
    });

    it("corrects a fact of her own, and leaves from out where it is unknown", async () => {
        await remember(store, write("tea"), OPTIONS);
        expect(
            await remember(store, write("tea", { body: "At five now." }), {
                project: null,
                from: null,
            }),
        ).toEqual({ action: "corrected", id: "personal/tea" });
        const tea = await read(PERSONAL, "tea");
        expect(tea.body).toBe("At five now.");
        expect(tea.provenance.from).toBeUndefined();
    });

    it("writes to the server's project, and refuses one without", async () => {
        expect(
            await remember(
                store,
                write("gateway", { scope: "project" }),
                OPTIONS,
            ),
        ).toEqual({
            action: "written",
            id: `${PROJECT}/gateway`,
        });
        await expect(
            remember(store, write("gateway", { scope: "project" }), {
                project: null,
                from: null,
            }),
        ).rejects.toThrow("There is no project here");
    });

    it("refuses the user's facts and the repository's, saying why", async () => {
        await putFact(root, PERSONAL, fact("tea", theirs("user")));
        await putFact(root, HERE, fact("style", theirs("repo")));
        await expect(remember(store, write("tea"), OPTIONS)).rejects.toThrow(
            "personal/tea is the user's",
        );
        await expect(
            remember(
                store,
                {
                    action: "retire",
                    name: "style",
                    scope: "project",
                    why: "Old.",
                },
                OPTIONS,
            ),
        ).rejects.toThrow(`${PROJECT}/style is the repository's`);
        expect((await read(PERSONAL, "tea")).title).toBe("Theirs");
    });

    it("never raises an origin: an external fact she corrects stays external", async () => {
        await putFact(
            root,
            PERSONAL,
            fact("page", {
                provenance: {
                    origin: "external",
                    by: "dorothy",
                    at: AT,
                    created: AT,
                },
            }),
        );
        await remember(store, write("page"), OPTIONS);
        expect((await read(PERSONAL, "page")).provenance.origin).toBe(
            "external",
        );
    });

    it("retires her own fact, and revives none by writing", async () => {
        await remember(store, write("tea"), OPTIONS);
        expect(
            await remember(
                store,
                {
                    action: "retire",
                    name: "tea",
                    scope: "personal",
                    why: "She stopped.",
                },
                OPTIONS,
            ),
        ).toEqual({ action: "retired", id: "personal/tea" });
        expect((await read(PERSONAL, "tea")).retired?.why).toBe("She stopped.");
        await expect(remember(store, write("tea"), OPTIONS)).rejects.toThrow(
            "personal/tea is retired",
        );
    });

    it("refuses what the store would, with the reason", async () => {
        await expect(
            remember(store, write("Bad Name"), OPTIONS),
        ).rejects.toThrow("not a fact's name");
        await expect(
            remember(store, write("tea", { type: "mood" }), OPTIONS),
        ).rejects.toThrow(
            "type must be one of user, feedback, project, reference",
        );
        await expect(
            remember(store, write("tea", { body: " " }), OPTIONS),
        ).rejects.toThrow("Give the fact's title, description and body.");
        await expect(
            remember(
                store,
                { action: "retire", name: "tea", scope: "personal" },
                OPTIONS,
            ),
        ).rejects.toThrow("Say in why");
        await expect(
            remember(
                store,
                { action: "retire", name: "none", scope: "personal", why: "x" },
                OPTIONS,
            ),
        ).rejects.toThrow("There is no fact personal/none.");
    });

    it("checks the origin under the lock, so a user's write in between stands", async () => {
        const gate = Promise.withResolvers<void>();
        const held = store.lock(async () => {
            await putFact(root, PERSONAL, fact("tea", theirs("user")));
            await gate.promise;
        });
        const pending = remember(store, write("tea"), OPTIONS);
        gate.resolve();
        await held;
        await expect(pending).rejects.toThrow("personal/tea is the user's");
    });

    it("takes turns with a concurrent write, each committed", async () => {
        await Promise.all([
            remember(store, write("tea", { body: "One." }), OPTIONS),
            remember(store, write("tea", { body: "Two." }), OPTIONS),
        ]);
        expect((await read(PERSONAL, "tea")).body).toBe("Two.");
        expect(commits).toEqual(["fact: personal/tea", "fact: personal/tea"]);
    });
});
