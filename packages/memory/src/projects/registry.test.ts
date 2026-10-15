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
const registry = (fields: object = {}): Registry => ({
    v: 1,
    projects: {
        [ID]: {
            name: "dorothy",
            roots: ["/home/u/dev/dorothy"],
            memoryDir: ".agents/memory",
            synced: { "likes-tea": HASH },
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
        ["a hash that is none", registry({ synced: { "likes-tea": "x" } })],
        [
            "a synced name that is no fact's",
            registry({ synced: { "Bad Name": HASH } }),
        ],
    ])("refuses %s", (_, value) => {
        expect(parseRegistry(JSON.stringify(value)).kind).toBe("unparseable");
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
                    synced: { a: HASH, b: HASH },
                },
            },
        });
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
