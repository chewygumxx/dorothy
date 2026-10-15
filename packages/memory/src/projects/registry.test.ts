// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/projects/registry.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    chooseMemoryDir,
    EMPTY_REGISTRY,
    memoryDirProblem,
    parseRegistry,
    type Registry,
    readRegistry,
    withProject,
    writeRegistry,
} from "./registry.js";

const ID = "github.com/chewygumxx/dorothy";
const HASH = "a".repeat(64);
const ROOT = "/home/u/dev/dorothy";
const record = (facts: Record<string, string>, dir = ".agents/memory") => ({
    dir,
    facts,
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
                    dir: ".agents/memory",
                    facts: { "likes-tea": HASH },
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
                synced: {
                    [ROOT]: { dir: "../x", facts: { "likes-tea": HASH } },
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

    it("takes .agents/memory, else .claude/memory, else .agents/memory", async () => {
        expect(await chooseMemoryDir(root)).toBe(".agents/memory");
        await mkdir(join(root, ".claude", "memory"), { recursive: true });
        expect(await chooseMemoryDir(root)).toBe(".claude/memory");
        await mkdir(join(root, ".agents", "memory"), { recursive: true });
        expect(await chooseMemoryDir(root)).toBe(".agents/memory");
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

    it("records the directory this root synced with", () => {
        const next = withProject(registry(), project, "docs/memory", {
            a: HASH,
        });
        expect(next.projects[ID]?.memoryDir).toBe("docs/memory");
        expect(next.projects[ID]?.synced[ROOT]).toEqual(
            record({ a: HASH }, "docs/memory"),
        );
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
