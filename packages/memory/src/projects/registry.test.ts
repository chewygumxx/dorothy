// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/memory/src/projects/registry.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    chooseMemoryDir,
    EMPTY_REGISTRY,
    memoryDirProblem,
    type ProjectEntry,
    parseRegistry,
    type Registry,
    readRegistry,
    resolveMemoryDir,
    syncRecord,
    withProject,
    writeRegistry,
} from "./registry.js";

const ID = "github.com/chewygumxx/dorothy";
const HASH = "a".repeat(64);
const ROOT = "/home/u/dev/dorothy";
const record = (facts: Record<string, string>, dir = ".agents/memory") => ({
    last: dir,
    dirs: { [dir]: facts },
});
const registry = (fields: object = {}): Registry => ({
    v: 1,
    projects: {
        [ID]: {
            name: "dorothy",
            roots: ["/home/u/dev/dorothy"],
            memoryDir: ".agents/memory",
            synced: {
                "/home/u/dev/dorothy": {
                    last: ".agents/memory",
                    dirs: { ".agents/memory": { "likes-tea": HASH } },
                },
            },
            ...fields,
        },
    },
});

describe("parseRegistry", () => {
    it("reads what writeRegistry writes", async () => {
        const dir = await mkdtemp(join(tmpdir(), "dorothy-registry-"));
        try {
            const path = join(dir, "projects.json");
            expect(await readRegistry(path)).toEqual({ kind: "none" });
            await writeRegistry(path, registry());
            expect(await readFile(path, "utf8")).toEndWith("}\n");
            expect(await readRegistry(path)).toEqual({
                kind: "ok",
                registry: registry(),
            });
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    it("reads the form removed for a fact retired in the store", () => {
        const kept = registry({
            synced: {
                [ROOT]: record({ "likes-tea": `removed:${HASH}` }),
            },
        });
        expect(parseRegistry(JSON.stringify(kept))).toEqual({
            kind: "ok",
            registry: kept,
        });
    });

    it.each([
        ["no version", { projects: {} }],
        [
            "an id that is none",
            { v: 1, projects: { "not an id": registry().projects[ID] } },
        ],
        [
            "a memory directory that escapes",
            registry({ memoryDir: "../outside" }),
        ],
        ["an absolute memory directory", registry({ memoryDir: "/etc" })],
        ["a relative root", registry({ roots: ["dev/dorothy"] })],
        [
            "a hash that is none",
            registry({ synced: { [ROOT]: record({ "likes-tea": "x" }) } }),
        ],
        [
            "a synced name that is no fact's",
            registry({ synced: { [ROOT]: record({ "Bad Name": HASH }) } }),
        ],
        [
            "hashes not kept by root",
            registry({ synced: { "likes-tea": HASH } }),
        ],
        [
            "hashes of a relative root",
            registry({ synced: { dorothy: record({ "likes-tea": HASH }) } }),
        ],
        [
            "hashes with no directory",
            registry({ synced: { [ROOT]: { "likes-tea": HASH } } }),
        ],
        [
            "hashes of a directory that escapes",
            registry({
                synced: { [ROOT]: record({ "likes-tea": HASH }, "../x") },
            }),
        ],
        [
            "hashes of a directory with a hidden character",
            registry({
                synced: { [ROOT]: record({ "likes-tea": HASH }, "a\u202eb") },
            }),
        ],
        [
            "records with no last directory",
            registry({
                synced: { [ROOT]: { ".agents/memory": { "likes-tea": HASH } } },
            }),
        ],
        [
            "a last directory with no record",
            registry({
                synced: {
                    [ROOT]: {
                        last: "docs/memory",
                        dirs: { ".agents/memory": { "likes-tea": HASH } },
                    },
                },
            }),
        ],
        [
            "the record of the old shape",
            registry({
                synced: {
                    [ROOT]: {
                        dir: ".agents/memory",
                        facts: { "likes-tea": HASH },
                    },
                },
            }),
        ],
    ])("refuses %s", (_, value) => {
        expect(parseRegistry(JSON.stringify(value)).kind).toBe("unparseable");
    });

    it("names a bad project by its place, never by its key", () => {
        const key = "https://user:ghp_secret0123456789@github.com/o/r";
        const value = {
            v: 1,
            projects: {
                ...registry().projects,
                [key]: registry().projects[ID],
            },
        };
        const read = parseRegistry(JSON.stringify(value));
        expect(read).toEqual({
            kind: "unparseable",
            reason: "project 2's id is not a project id",
        });
        const named = parseRegistry(JSON.stringify(registry({ name: 1 })));
        expect(named).toEqual({
            kind: "unparseable",
            reason: "project 1 has no name",
        });
    });
});

describe("memoryDirProblem", () => {
    it("allows a relative path inside the repository, and nothing else", () => {
        expect(memoryDirProblem(".agents/memory")).toBeNull();
        expect(memoryDirProblem("docs/memory")).toBeNull();
        for (const dir of [
            "",
            "/etc",
            "../x",
            "a/../../x",
            "./x",
            "a//b",
            "a\\b",
            ".git",
            ".git/hooks",
            "x/.GIT/y",
        ]) {
            expect(memoryDirProblem(dir)).not.toBeNull();
        }
    });

    it("refuses a control character or NUL, without repeating the path", () => {
        for (const dir of [
            "a\u0000b",
            "docs/\u001b[2Jmemory",
            "a\nb",
            "a\u0085",
        ]) {
            expect(memoryDirProblem(dir)).toBe(
                "the path holds a control character",
            );
        }
        const read = parseRegistry(
            JSON.stringify(registry({ memoryDir: "docs/\u001b[2Jm" })),
        );
        expect(read.kind === "unparseable" && read.reason).toBe(
            "project 1's memory directory: the path holds a control character",
        );
    });

    it.each([
        ["a bidirectional override", "docs/\u202ememory", "U+202E"],
        ["a zero width space", "docs/mem\u200bory", "U+200B"],
        ["a line separator", "docs/\u2028memory", "U+2028"],
    ])("refuses %s, naming it and not the path", (_, dir, code) => {
        expect(memoryDirProblem(dir)).toBe(
            `the path holds a hidden character, ${code}`,
        );
    });
});

describe("chooseMemoryDir", () => {
    let root = "";
    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "dorothy-choose-"));
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("takes docs/memory, else .agents/memory, else .claude/memory, else .agents/memory", async () => {
        expect(await chooseMemoryDir(root)).toBe(".agents/memory");
        await mkdir(join(root, ".claude", "memory"), { recursive: true });
        expect(await chooseMemoryDir(root)).toBe(".claude/memory");
        await mkdir(join(root, ".agents", "memory"), { recursive: true });
        expect(await chooseMemoryDir(root)).toBe(".agents/memory");
        await mkdir(join(root, "docs", "memory"), { recursive: true });
        await writeFile(join(root, "docs", "memory", "MEMORY.md"), "");
        expect(await chooseMemoryDir(root)).toBe("docs/memory");
    });

    it("passes over a docs/memory without MEMORY.md, documentation's", async () => {
        await mkdir(join(root, "docs", "memory"), { recursive: true });
        await writeFile(join(root, "docs", "memory", "design.md"), "");
        expect(await chooseMemoryDir(root)).toBe(".agents/memory");
        await mkdir(join(root, ".claude", "memory"), { recursive: true });
        expect(await chooseMemoryDir(root)).toBe(".claude/memory");
    });
});

describe("resolveMemoryDir", () => {
    let root = "";
    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "dorothy-resolve-"));
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    // A memory directory holding MEMORY.md and a file for each stem.
    const holding = async (dir: string, ...stems: string[]) => {
        await mkdir(join(root, dir), { recursive: true });
        await writeFile(join(root, dir, "MEMORY.md"), "");
        for (const stem of stems) {
            await writeFile(join(root, dir, `${stem}.md`), "");
        }
    };
    // The project as this root last synced it, with these facts' hashes
    // recorded for that directory; none, a root it has never synced.
    const entry = (
        memoryDir: string,
        last?: string,
        facts: Record<string, string> = {},
    ): ProjectEntry => ({
        name: "dorothy",
        roots: [root],
        memoryDir,
        synced:
            last === undefined
                ? {}
                : { [root]: { last, dirs: { [last]: facts } } },
    });
    const both = { a: HASH, b: HASH };

    it("chooses when nothing is recorded", async () => {
        await mkdir(join(root, ".claude", "memory"), { recursive: true });
        expect(await resolveMemoryDir(root, undefined)).toBe(".claude/memory");
    });

    it("takes the project's directory for a root it never synced, while present", async () => {
        await holding(".agents/memory");
        await holding("docs/memory");
        expect(await resolveMemoryDir(root, entry(".agents/memory"))).toBe(
            ".agents/memory",
        );
        await rm(join(root, ".agents"), { recursive: true });
        expect(await resolveMemoryDir(root, entry(".agents/memory"))).toBe(
            "docs/memory",
        );
    });

    it("keeps the recorded directory holding the facts, though another is present", async () => {
        await holding(".agents/memory", "a", "b");
        await holding("docs/memory", "c");
        expect(
            await resolveMemoryDir(
                root,
                entry(".agents/memory", ".agents/memory", both),
            ),
        ).toBe(".agents/memory");
    });

    it("takes the directory holding the facts over a recorded one holding none", async () => {
        await holding("docs/memory", "a", "b");
        const recorded = entry(".agents/memory", ".agents/memory", both);
        await mkdir(join(root, ".agents", "memory"), { recursive: true });
        expect(await resolveMemoryDir(root, recorded)).toBe("docs/memory");
        await writeFile(join(root, ".agents", "memory", "stray.md"), "");
        expect(await resolveMemoryDir(root, recorded)).toBe("docs/memory");
    });

    it("takes the root's own record over the project's directory", async () => {
        await holding("docs/memory", "a", "b");
        await holding(".agents/memory");
        expect(
            await resolveMemoryDir(
                root,
                entry(".agents/memory", "docs/memory", both),
            ),
        ).toBe("docs/memory");
    });

    it("counts a snake-case file as its fact", async () => {
        await holding("docs/memory", "feedback_testing");
        await holding(".agents/memory");
        expect(
            await resolveMemoryDir(
                root,
                entry(".agents/memory", ".agents/memory", {
                    "feedback-testing": HASH,
                }),
            ),
        ).toBe("docs/memory");
    });

    it("keeps the recorded directory on a tie, then MEMORY_DIRS' order", async () => {
        await holding(".agents/memory", "a");
        await holding(".claude/memory", "a", "b");
        await holding("docs/memory", "a");
        expect(
            await resolveMemoryDir(
                root,
                entry(".agents/memory", ".agents/memory", both),
            ),
        ).toBe(".claude/memory");
        await holding("docs/memory", "a", "b");
        expect(
            await resolveMemoryDir(
                root,
                entry(".claude/memory", ".claude/memory", both),
            ),
        ).toBe(".claude/memory");
        await rm(join(root, ".claude"), { recursive: true });
        await holding(".agents/memory", "a", "b");
        expect(
            await resolveMemoryDir(
                root,
                entry("other/memory", "other/memory", both),
            ),
        ).toBe("docs/memory");
    });

    it("keeps a recorded directory gone when no other holds its facts", async () => {
        expect(
            await resolveMemoryDir(
                root,
                entry("docs/memory", "docs/memory", both),
            ),
        ).toBe("docs/memory");
        await holding(".agents/memory", "c");
        expect(
            await resolveMemoryDir(
                root,
                entry("docs/memory", "docs/memory", both),
            ),
        ).toBe("docs/memory");
    });

    it("passes over a docs/memory without MEMORY.md", async () => {
        await mkdir(join(root, "docs", "memory"), { recursive: true });
        await writeFile(join(root, "docs", "memory", "a.md"), "");
        expect(
            await resolveMemoryDir(
                root,
                entry(".agents/memory", ".agents/memory", both),
            ),
        ).toBe(".agents/memory");
        expect(await resolveMemoryDir(root, entry(".agents/memory"))).toBe(
            ".agents/memory",
        );
    });

    it("follows the memory as before with no live fact to judge by", async () => {
        await holding("docs/memory", "a");
        const nothingLive: Record<string, string>[] = [
            {},
            { a: `removed:${HASH}` },
        ];
        for (const facts of nothingLive) {
            expect(
                await resolveMemoryDir(
                    root,
                    entry(".agents/memory", ".agents/memory", facts),
                ),
            ).toBe("docs/memory");
        }
        await mkdir(join(root, ".agents", "memory"), { recursive: true });
        expect(
            await resolveMemoryDir(
                root,
                entry(".agents/memory", ".agents/memory", {}),
            ),
        ).toBe(".agents/memory");
    });
});

describe("syncRecord", () => {
    const entry = registry({
        synced: {
            [ROOT]: {
                last: ".agents/memory",
                dirs: {
                    ".agents/memory": { "likes-tea": HASH },
                    "docs/memory": { a: HASH },
                },
            },
        },
    }).projects[ID];

    it("finds the record of a root and directory, and none for another", () => {
        expect(syncRecord(entry, ROOT, ".agents/memory", true)).toEqual({
            "likes-tea": HASH,
        });
        expect(syncRecord(entry, ROOT, "docs/memory", true)).toEqual({
            a: HASH,
        });
        for (const dir of ["other/memory", "constructor", "__proto__"]) {
            expect(syncRecord(entry, ROOT, dir, true)).toBeUndefined();
        }
        expect(
            syncRecord(entry, "/home/u/work/dorothy", ".agents/memory", true),
        ).toBeUndefined();
        expect(
            syncRecord(undefined, ROOT, ".agents/memory", true),
        ).toBeUndefined();
    });

    it("counts an absent directory's record only if it was synced last", () => {
        expect(syncRecord(entry, ROOT, ".agents/memory", false)).toEqual({
            "likes-tea": HASH,
        });
        expect(syncRecord(entry, ROOT, "docs/memory", false)).toBeUndefined();
    });
});

describe("withProject", () => {
    const project = { root: "/home/u/dev/dorothy", id: ID, name: "dorothy" };

    it("registers a project with its root, memory directory and hashes", () => {
        expect(
            withProject(EMPTY_REGISTRY, project, ".agents/memory", {
                b: HASH,
                a: HASH,
            }),
        ).toEqual({
            v: 1,
            projects: {
                [ID]: {
                    name: "dorothy",
                    roots: ["/home/u/dev/dorothy"],
                    memoryDir: ".agents/memory",
                    synced: { [ROOT]: record({ a: HASH, b: HASH }) },
                },
            },
        });
    });

    it("sets only this root's hashes, and keeps the others'", () => {
        const other = { ...project, root: "/home/u/work/dorothy" };
        const next = withProject(registry(), other, ".agents/memory", {
            a: HASH,
        });
        expect(next.projects[ID]?.synced).toEqual({
            [ROOT]: record({ "likes-tea": HASH }),
            "/home/u/work/dorothy": record({ a: HASH }),
        });
        expect(
            Object.keys(
                withProject(next, project, ".agents/memory", {}).projects[ID]
                    ?.synced ?? {},
            ),
        ).toEqual(["/home/u/dev/dorothy", "/home/u/work/dorothy"]);
    });

    it("sets only this directory's record, and keeps the others'", () => {
        const next = withProject(registry(), project, "docs/memory", {
            a: HASH,
        });
        expect(next.projects[ID]?.memoryDir).toBe("docs/memory");
        expect(next.projects[ID]?.synced[ROOT]).toEqual({
            last: "docs/memory",
            dirs: {
                ".agents/memory": { "likes-tea": HASH },
                "docs/memory": { a: HASH },
            },
        });
        const back = withProject(next, project, ".agents/memory", {
            b: HASH,
        });
        expect(back.projects[ID]?.memoryDir).toBe(".agents/memory");
        expect(back.projects[ID]?.synced[ROOT]).toEqual({
            last: ".agents/memory",
            dirs: {
                ".agents/memory": { b: HASH },
                "docs/memory": { a: HASH },
            },
        });
        expect(
            Object.keys(back.projects[ID]?.synced[ROOT]?.dirs ?? {}),
        ).toEqual([".agents/memory", "docs/memory"]);
    });

    it("adds a root it has not seen, once", () => {
        const other = { ...project, root: "/home/u/work/dorothy" };
        const once = withProject(registry(), other, ".agents/memory", {});
        const twice = withProject(once, other, ".agents/memory", {});
        expect(twice.projects[ID]?.roots).toEqual([
            "/home/u/dev/dorothy",
            "/home/u/work/dorothy",
        ]);
    });
});
