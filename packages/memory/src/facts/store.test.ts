// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/facts/store.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    mkdir,
    mkdtemp,
    readFile,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Fact, parseFact } from "./file.js";
import {
    type FactInput,
    type FactStore,
    factFiles,
    factPath,
    listFacts,
    moveFact,
    PERSONAL,
    parseTarget,
    retireFact,
    retireFacts,
    reviveFact,
    type Scope,
    scopeDir,
    writeFact,
} from "./store.js";

const NOW = new Date("2026-10-15T09:30:00.000Z");
const LATER = new Date("2026-10-16T09:30:00.000Z");
const PHRASE = "bingo-overabundance-mazer-kasha";
const OTHER = "anabolic-gat-sangh-autodidact";
const PROJECT: Scope = { kind: "project", id: "github.com/chewygumxx/dorothy" };

let root = "";
let commits: { paths: string[]; message: string }[] = [];
let clock = NOW;
const store = (): FactStore => ({
    root,
    lock: (work) => work(),
    recorder: async (paths, message) => {
        commits.push({ paths: [...paths], message });
    },
    now: () => clock,
});
const input = (fields: Partial<FactInput> = {}): FactInput => ({
    scope: PERSONAL,
    name: "likes-tea",
    title: "Likes tea",
    description: "Prefers tea to coffee.",
    type: "user",
    body: "Asked for tea twice.",
    origin: "user",
    by: "dorothy",
    ...fields,
});

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dorothy-facts-"));
    commits = [];
    clock = NOW;
});
afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

const read = async (scope: Scope, name: string) => {
    const result = parseFact(
        await readFile(factPath(root, scope, name), "utf8"),
        name,
    );
    if (result.kind !== "ok") {
        throw new Error(result.reason);
    }
    return result.fact;
};

describe("writeFact", () => {
    it("refuses a write its guard refuses, checked under the lock", async () => {
        const seen: (Fact | null)[] = [];
        const result = await writeFact(
            store(),
            input({ name: "tea" }),
            (current) => {
                seen.push(current);
                return "not now";
            },
        );
        expect(result).toEqual({ kind: "refused", reason: "not now" });
        expect(seen).toEqual([null]);
    });

    it("writes a personal fact and records it", async () => {
        const result = await writeFact(store(), input());
        expect(result.kind).toBe("written");
        expect(factPath(root, PERSONAL, "likes-tea")).toBe(
            join(root, "knowledge", "personal", "likes-tea.md"),
        );
        expect(await read(PERSONAL, "likes-tea")).toMatchObject({
            title: "Likes tea",
            provenance: {
                origin: "user",
                by: "dorothy",
                at: NOW.toISOString(),
            },
            retired: null,
        });
        expect(commits).toEqual([
            {
                paths: [factPath(root, PERSONAL, "likes-tea")],
                message: "fact: personal/likes-tea",
            },
        ]);
    });

    it("writes a project's fact under its id", async () => {
        await writeFact(store(), input({ scope: PROJECT, type: "project" }));
        expect(factPath(root, PROJECT, "likes-tea")).toBe(
            join(
                root,
                "knowledge",
                "projects",
                "github.com",
                "chewygumxx",
                "dorothy",
                "likes-tea.md",
            ),
        );
        expect((await read(PROJECT, "likes-tea")).type).toBe("project");
    });

    it("keeps creation, metadata and tags, and lowers the origin", async () => {
        await writeFact(store(), input({ tags: ["k1a2b3c4d"], importance: 6 }));
        clock = LATER;
        await writeFact(
            store(),
            input({
                description: "Tea, always.",
                origin: "external",
                by: "review",
            }),
        );
        expect(await read(PERSONAL, "likes-tea")).toMatchObject({
            description: "Tea, always.",
            tags: ["k1a2b3c4d"],
            importance: 6,
            provenance: {
                origin: "external",
                by: "review",
                at: LATER.toISOString(),
                created: NOW.toISOString(),
            },
        });
        await writeFact(store(), input({ origin: "dorothy", by: "dorothy" }));
        expect((await read(PERSONAL, "likes-tea")).provenance.origin).toBe(
            "external",
        );
        await writeFact(store(), input({ origin: "dorothy", by: "user" }));
        expect((await read(PERSONAL, "likes-tea")).provenance.origin).toBe(
            "user",
        );
    });

    it("revives a retired fact it writes again", async () => {
        await writeFact(store(), input());
        await retireFact(
            store(),
            { scope: PERSONAL, name: "likes-tea" },
            {
                by: "user",
                why: "Not true.",
            },
        );
        await writeFact(store(), input());
        expect((await read(PERSONAL, "likes-tea")).retired).toBeNull();
    });

    it("refuses a name that is not a fact's, and writes nothing", async () => {
        const result = await writeFact(store(), input({ name: "../escape" }));
        expect(result).toEqual({
            kind: "failed",
            reason: "../escape is not a fact's name",
        });
        expect(await factFiles(root)).toEqual([]);
        expect(commits).toEqual([]);
    });

    it("refuses to write over a fact that is broken", async () => {
        const path = factPath(root, PERSONAL, "likes-tea");
        await mkdir(join(root, "knowledge", "personal"), { recursive: true });
        await writeFile(path, "not a fact\n");
        const result = await writeFact(store(), input());
        expect(result).toEqual({
            kind: "failed",
            reason: "it is broken: it has no frontmatter",
        });
        expect(await readFile(path, "utf8")).toBe("not a fact\n");
    });
});

describe("a directory other than knowledge/", () => {
    it("lists and names scopes under the one passed", async () => {
        await writeFact(store(), input());
        await writeFact(store(), input({ scope: PROJECT }));
        const old = join(root, "facts");
        const copy = async (scope: Scope) => {
            const dir = scopeDir(root, scope, "facts");
            await mkdir(dir, { recursive: true });
            await writeFile(
                join(dir, "likes-tea.md"),
                await readFile(factPath(root, scope, "likes-tea")),
            );
        };
        await copy(PERSONAL);
        await copy(PROJECT);
        expect(scopeDir(root, PERSONAL, "facts")).toBe(join(old, "personal"));
        const listed = await factFiles(root, undefined, "facts");
        expect(
            listed.map(({ scope, name, path }) => ({
                scope,
                name,
                path: path.slice(root.length + 1),
            })),
        ).toEqual([
            {
                scope: PERSONAL,
                name: "likes-tea",
                path: "facts/personal/likes-tea.md",
            },
            {
                scope: PROJECT,
                name: "likes-tea",
                path: "facts/projects/github.com/chewygumxx/dorothy/likes-tea.md",
            },
        ]);
        expect(await factFiles(root, PROJECT, "facts")).toHaveLength(1);
        // Neither listing reads the other's directory.
        expect(
            (await factFiles(root)).every(({ path }) =>
                path.startsWith(join(root, "knowledge")),
            ),
        ).toBe(true);
    });
});

describe("moveFact", () => {
    it("moves a fact to another scope in one commit, provenance and all", async () => {
        await writeFact(store(), input());
        commits = [];
        const result = await moveFact(
            store(),
            { scope: PERSONAL, name: "likes-tea" },
            PROJECT,
        );
        expect(result.kind).toBe("written");
        expect((await read(PROJECT, "likes-tea")).provenance.created).toBe(
            NOW.toISOString(),
        );
        expect(await factFiles(root, PERSONAL)).toEqual([]);
        expect(commits).toEqual([
            {
                paths: [
                    factPath(root, PERSONAL, "likes-tea"),
                    factPath(root, PROJECT, "likes-tea"),
                ],
                message:
                    "move: personal/likes-tea to github.com/chewygumxx/dorothy",
            },
        ]);
    });

    it("refuses to move over a fact already there", async () => {
        await writeFact(store(), input());
        await writeFact(store(), input({ scope: PROJECT }));
        expect(
            await moveFact(
                store(),
                { scope: PERSONAL, name: "likes-tea" },
                PROJECT,
            ),
        ).toEqual({
            kind: "failed",
            reason: "there is already a fact github.com/chewygumxx/dorothy/likes-tea",
        });
    });
});

describe("retiring", () => {
    it("retires a fact in place, so it is still listed and read", async () => {
        await writeFact(store(), input());
        const result = await retireFact(
            store(),
            { scope: PERSONAL, name: "likes-tea" },
            { by: "user", why: "  No longer  true. " },
        );
        expect(result.kind).toBe("written");
        expect((await read(PERSONAL, "likes-tea")).retired).toEqual({
            at: NOW.toISOString(),
            by: "user",
            why: "No longer true.",
        });
        const { facts } = await listFacts(root);
        expect(facts.map(({ fact }) => fact.name)).toEqual(["likes-tea"]);
        expect(commits.at(-1)?.message).toBe("retire: personal/likes-tea");
    });

    it("says when a fact is retired already, or missing", async () => {
        await writeFact(store(), input());
        const target = { scope: PERSONAL, name: "likes-tea" };
        const why = { by: "user" as const, why: "x" };
        await retireFact(store(), target, why);
        expect((await retireFact(store(), target, why)).kind).toBe("unchanged");
        expect(
            (
                await retireFact(
                    store(),
                    { scope: PERSONAL, name: "nothing" },
                    why,
                )
            ).kind,
        ).toBe("missing");
    });

    it("revives a retired fact, and leaves a live one alone", async () => {
        await writeFact(store(), input());
        const target = { scope: PERSONAL, name: "likes-tea" };
        expect((await reviveFact(store(), target)).kind).toBe("unchanged");
        await retireFact(store(), target, { by: "user", why: "x" });
        expect((await reviveFact(store(), target)).kind).toBe("written");
        expect((await read(PERSONAL, "likes-tea")).retired).toBeNull();
        expect(commits.at(-1)?.message).toBe("revive: personal/likes-tea");
    });

    it("retires every live fact one conversation gave, in one commit", async () => {
        await writeFact(store(), input({ name: "a", from: `${PHRASE}#3` }));
        await writeFact(
            store(),
            input({ name: "b", from: PHRASE, scope: PROJECT }),
        );
        await writeFact(store(), input({ name: "c", from: `${OTHER}#1` }));
        await writeFact(store(), input({ name: "d" }));
        commits = [];
        const result = await retireFacts(store(), PHRASE, {
            by: "user",
            why: "That conversation was wrong.",
        });
        expect(result).toEqual({
            kind: "done",
            retired: ["personal/a", "github.com/chewygumxx/dorothy/b"],
        });
        expect(commits).toHaveLength(1);
        expect(commits[0]?.message).toBe(`retire: 2 facts from ${PHRASE}`);
        expect((await read(PERSONAL, "c")).retired).toBeNull();
    });
});

describe("listFacts", () => {
    it("lists personal facts first, then each project's, and names broken ones", async () => {
        await writeFact(store(), input({ name: "b", scope: PROJECT }));
        await writeFact(store(), input({ name: "a" }));
        await writeFile(
            join(root, "knowledge", "personal", "z.md"),
            "broken\n",
        );
        const { facts, broken } = await listFacts(root);
        expect(facts.map(({ scope, fact }) => [scope, fact.name])).toEqual([
            [PERSONAL, "a"],
            [PROJECT, "b"],
        ]);
        expect(broken).toEqual([
            {
                path: join(root, "knowledge", "personal", "z.md"),
                reason: "it has no frontmatter",
            },
        ]);
    });

    it("ignores symlinks, files that are not facts, and files outside a scope", async () => {
        await writeFact(store(), input());
        const outside = join(root, "outside.md");
        await writeFile(outside, "x\n");
        await symlink(
            outside,
            join(root, "knowledge", "personal", "linked.md"),
        );
        await writeFile(
            join(root, "knowledge", "personal", "notes.txt"),
            "x\n",
        );
        await mkdir(join(root, "knowledge", "projects"), { recursive: true });
        await writeFile(join(root, "knowledge", "projects", "loose.md"), "x\n");
        expect((await factFiles(root)).map(({ name }) => name)).toEqual([
            "likes-tea",
        ]);
    });
});

describe("parseTarget", () => {
    it("reads personal/<name> and <project id>/<name>", () => {
        expect(parseTarget("personal/likes-tea")).toEqual({
            scope: PERSONAL,
            name: "likes-tea",
        });
        expect(parseTarget("github.com/chewygumxx/dorothy/likes-tea")).toEqual({
            scope: PROJECT,
            name: "likes-tea",
        });
        expect(parseTarget("local-0123456789ab/x")).toEqual({
            scope: { kind: "project", id: "local-0123456789ab" },
            name: "x",
        });
    });

    it.each([
        "likes-tea",
        "personal/",
        "/x",
        "personal/Bad",
        "host/../x/y",
        "github.com/x",
    ])("refuses %p", (target) => {
        expect(parseTarget(target)).toBeNull();
    });
});
