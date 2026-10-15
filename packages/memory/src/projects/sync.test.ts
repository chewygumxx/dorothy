// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/projects/sync.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    chmod,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    realpath,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Fact } from "../facts/file.js";
import {
    factPath,
    listFacts,
    PERSONAL,
    putFact,
    type Scope,
    scopeDir,
} from "../facts/store.js";
import { RecallIndex } from "../recall/store.js";
import { projectsPath } from "./registry.js";
import {
    type SyncOptions,
    type SyncReport,
    type SyncResult,
    syncProject,
} from "./sync.js";

const NOW = new Date("2026-10-15T09:30:00.000Z");
const ID = "github.com/chewygumxx/dorothy";
const SCOPE: Scope = { kind: "project", id: ID };

let base = "";
let data = "";
let repo = "";
let commits: { paths: string[]; message: string }[] = [];

const options = (fields: Partial<SyncOptions> = {}): SyncOptions => ({
    root: data,
    lock: (work) => work(),
    recorder: async (paths, message) => {
        commits.push({ paths: [...paths], message });
    },
    now: () => NOW,
    ...fields,
});

beforeEach(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), "dorothy-sync-")));
    data = join(base, "data");
    repo = join(base, "repo");
    await mkdir(join(repo, ".git"), { recursive: true });
    await writeFile(
        join(repo, ".git", "config"),
        '[remote "origin"]\n\turl = git@github.com:chewygumxx/dorothy.git\n',
    );
    commits = [];
});
afterEach(async () => {
    await rm(base, { recursive: true, force: true });
});

const memory = (file: string) => join(repo, ".agents", "memory", file);
const putRepo = async (file: string, text: string) => {
    await mkdir(join(repo, ".agents", "memory"), { recursive: true });
    await writeFile(memory(file), text);
};
const repoFact = (name: string, description: string, body = "Body.") =>
    [
        "---",
        `name: ${name}`,
        `description: "${description}"`,
        "metadata:",
        "  type: project",
        "---",
        "",
        body,
        "",
    ].join("\n");
const storeFact = (name: string, fields: Partial<Fact> = {}): Fact => ({
    name,
    title: name,
    description: `About ${name}.`,
    type: "project",
    extra: {},
    tags: [],
    importance: null,
    provenance: {
        origin: "dorothy",
        by: "dorothy",
        at: NOW.toISOString(),
        created: NOW.toISOString(),
    },
    retired: null,
    body: "Body.",
    ...fields,
});
const facts = async () =>
    (await listFacts(data, SCOPE)).facts.map(({ fact }) => fact);
const files = async () =>
    (await readdir(join(repo, ".agents", "memory"))).sort();

async function sync(): Promise<SyncReport> {
    const result = await syncProject(repo, options());
    if (result.kind !== "ok") {
        throw new Error(JSON.stringify(result));
    }
    return result.report;
}
const moved = (report: SyncReport) => ({
    imported: report.imported,
    exported: report.exported,
    removed: report.removed,
    retired: report.retired,
    conflicts: report.conflicts,
});
const ok = async (result: Promise<SyncResult>): Promise<SyncReport> => {
    const done = await result;
    if (done.kind !== "ok") {
        throw new Error(JSON.stringify(done));
    }
    return done.report;
};
const NOTHING = {
    imported: [],
    exported: [],
    removed: [],
    retired: [],
    conflicts: [],
};

describe("syncProject", () => {
    it("adopts a repository's memory whole, with MEMORY.md's titles and order", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await putRepo("b.md", repoFact("b", "Second fact."));
        await putRepo(
            "MEMORY.md",
            "- [Bee](./b.md)\n  second\n- [Ay](./a.md)\n  first\n",
        );
        const report = await sync();
        expect(moved(report)).toEqual({ ...NOTHING, imported: ["a", "b"] });
        const [a, b] = await facts();
        expect([
            a?.title,
            a?.provenance.origin,
            b?.title,
            b?.provenance.by,
        ]).toEqual(["Ay", "repo", "Bee", "repo"]);
        expect(
            (b?.provenance.created ?? "") < (a?.provenance.created ?? ""),
        ).toBe(true);
        expect(await readFile(memory("MEMORY.md"), "utf8")).toBe(
            "- [Bee](./b.md)\n  Second fact.\n- [Ay](./a.md)\n  First fact.\n",
        );
        expect(report.index).toBe("written");
        expect(commits).toEqual([
            {
                paths: [
                    factPath(data, SCOPE, "a"),
                    factPath(data, SCOPE, "b"),
                    projectsPath(data),
                ],
                message: `sync: ${ID}: 2 in, 0 out`,
            },
        ]);
    });

    it("does nothing the second time", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        commits = [];
        const report = await sync();
        expect(moved(report)).toEqual(NOTHING);
        expect(report.index).toBe("unchanged");
        expect(commits).toEqual([]);
    });

    it("exports a project's fact from the store, in the exported form", async () => {
        await putFact(data, SCOPE, storeFact("likes-tea", { importance: 7 }));
        const report = await sync();
        expect(moved(report)).toEqual({ ...NOTHING, exported: ["likes-tea"] });
        expect(await readFile(memory("likes-tea.md"), "utf8")).toBe(
            [
                "---",
                "name: likes-tea",
                "description: >-",
                "  About likes-tea.",
                "metadata:",
                "  type: project",
                "---",
                "",
                "Body.",
                "",
            ].join("\n"),
        );
        expect(commits[0]?.message).toBe(`sync: ${ID}: 0 in, 1 out`);
    });

    it("exports what changed in the store since the last sync", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        const [a] = await facts();
        await putFact(data, SCOPE, {
            ...(a as Fact),
            description: "First, revised.",
        });
        expect(moved(await sync())).toEqual({ ...NOTHING, exported: ["a"] });
        expect(await readFile(memory("a.md"), "utf8")).toContain(
            "First, revised.",
        );
    });

    it("imports what changed in the repository, keeping the store's own fields", async () => {
        await putFact(
            data,
            SCOPE,
            storeFact("a", { importance: 7, tags: ["k1a2b3c4d"] }),
        );
        await sync();
        await putRepo("a.md", repoFact("a", "Edited in the repository."));
        expect(moved(await sync())).toEqual({ ...NOTHING, imported: ["a"] });
        expect((await facts())[0]).toMatchObject({
            description: "Edited in the repository.",
            importance: 7,
            tags: ["k1a2b3c4d"],
            provenance: {
                origin: "repo",
                by: "repo",
                created: NOW.toISOString(),
            },
        });
    });

    it("keeps the repository's version when both changed, and never touches its file", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        const [a] = await facts();
        await putFact(data, SCOPE, {
            ...(a as Fact),
            description: "Changed in the store.",
        });
        const edit = repoFact("a", "Changed in the working tree.");
        await putRepo("a.md", edit);
        expect(moved(await sync())).toEqual({
            ...NOTHING,
            imported: ["a"],
            conflicts: ["a"],
        });
        expect(await readFile(memory("a.md"), "utf8")).toBe(edit);
        expect((await facts())[0]?.description).toBe(
            "Changed in the working tree.",
        );
    });

    it("removes a fact retired in the store from the repository, and keeps it in the store", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await putRepo("b.md", repoFact("b", "Second fact."));
        await sync();
        const [a] = await facts();
        await putFact(data, SCOPE, {
            ...(a as Fact),
            retired: { at: NOW.toISOString(), by: "user", why: "Wrong." },
        });
        expect(moved(await sync())).toEqual({ ...NOTHING, removed: ["a"] });
        expect(await files()).toEqual(["MEMORY.md", "b.md"]);
        expect(await readFile(memory("MEMORY.md"), "utf8")).not.toContain(
            "./a.md",
        );
        expect(
            (await facts()).map((fact) => [fact.name, fact.retired !== null]),
        ).toEqual([
            ["a", true],
            ["b", false],
        ]);
    });

    it("retires a fact deleted in the repository", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        await rm(memory("a.md"));
        expect(moved(await sync())).toEqual({ ...NOTHING, retired: ["a"] });
        expect((await facts())[0]?.retired).toEqual({
            at: NOW.toISOString(),
            by: "repo",
            why: "deleted in the repository",
        });
    });

    it("revives a retired fact the repository writes again", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        await rm(memory("a.md"));
        await sync();
        await putRepo("a.md", repoFact("a", "Back again."));
        expect(moved(await sync())).toEqual({ ...NOTHING, imported: ["a"] });
        expect((await facts())[0]).toMatchObject({
            description: "Back again.",
            retired: null,
        });
    });

    it("takes a repository file written another way as unchanged", async () => {
        await putFact(data, SCOPE, storeFact("a"));
        await sync();
        const restyled = [
            "---",
            "name: a",
            "metadata:",
            "  type: project",
            'description: "About a."',
            "---",
            "",
            "Body.",
            "",
        ].join("\n");
        await putRepo("a.md", restyled);
        expect(moved(await sync())).toEqual(NOTHING);
        expect(await readFile(memory("a.md"), "utf8")).toBe(restyled);
    });

    it("skips and names what is no fact, and imports, overwrites and retires none of it", async () => {
        await putFact(data, SCOPE, storeFact("trap"));
        const trap = [
            "---",
            "name: trap",
            "description: 1e3",
            "metadata:",
            "  type: project",
            "---",
            "",
            "x",
            "",
        ].join("\n");
        await putRepo("trap.md", trap);
        await putRepo("notes.md", "Just notes.\n");
        await putRepo("big.md", `---\nname: big\n---\n${"x".repeat(70_000)}\n`);
        await writeFile(
            join(base, "elsewhere.md"),
            repoFact("linked", "Elsewhere."),
        );
        await symlink(join(base, "elsewhere.md"), memory("linked.md"));
        await putRepo("MEMORY.md", "kept by hand\n");
        const report = await sync();
        expect(moved(report)).toEqual(NOTHING);
        expect(report.skipped).toEqual([
            { name: "big", reason: "it is over 64 KiB" },
            { name: "linked", reason: "it is a symlink" },
            { name: "notes", reason: "it has no frontmatter" },
            { name: "trap", reason: "description is not text" },
        ]);
        expect(await readFile(memory("trap.md"), "utf8")).toBe(trap);
        expect(report.index).toBe("left");
        expect(await readFile(memory("MEMORY.md"), "utf8")).toBe(
            "kept by hand\n",
        );
        expect(
            (await facts()).map((fact) => [fact.name, fact.retired]),
        ).toEqual([["trap", null]]);
    });

    it("leaves a hand-kept MEMORY.md alone when there is nothing to list", async () => {
        const kept = "- [Gone](./gone.md)\n  kept by hand\n";
        await putRepo("MEMORY.md", kept);
        expect((await sync()).index).toBe("left");
        expect(await readFile(memory("MEMORY.md"), "utf8")).toBe(kept);
    });

    it("refuses a memory directory that leaves the repository, and writes nothing", async () => {
        await putFact(data, SCOPE, storeFact("a"));
        await writeFile(
            projectsPath(data),
            JSON.stringify({
                v: 1,
                projects: {
                    [ID]: {
                        name: "dorothy",
                        roots: [repo],
                        memoryDir: "../outside",
                        synced: {},
                    },
                },
            }),
        );
        expect(await syncProject(repo, options())).toEqual({
            kind: "failed",
            reason: `${projectsPath(data)}: project 1's memory directory: ../outside leaves the repository or names it oddly`,
        });
        expect((await readdir(base)).sort()).toEqual(["data", "repo"]);
        expect(commits).toEqual([]);
    });

    it("refuses a memory directory reached through a symlink", async () => {
        await putFact(data, SCOPE, storeFact("a"));
        await mkdir(join(base, "outside"));
        await symlink(join(base, "outside"), join(repo, ".agents"));
        expect(await syncProject(repo, options())).toEqual({
            kind: "failed",
            reason: `.agents/memory passes through a symlink, ${join(repo, ".agents")}`,
        });
        expect(await readdir(join(base, "outside"))).toEqual([]);
    });

    it("never writes a personal fact into a repository", async () => {
        for (let seed = 0; seed < 20; seed++) {
            const name = `fact-${seed}`;
            await putFact(
                data,
                PERSONAL,
                storeFact(name, { type: "user", body: "Personal." }),
            );
            if (seed % 3 === 0) {
                await putFact(data, SCOPE, storeFact(name));
            }
            await sync();
            const written = (await files()).filter(
                (file) => file !== "MEMORY.md",
            );
            expect(written).toEqual(
                (await facts()).map((fact) => `${fact.name}.md`).sort(),
            );
            for (const file of written) {
                expect(await readFile(memory(file), "utf8")).not.toContain(
                    "Personal.",
                );
            }
        }
    });

    it("imports what it can when the memory directory cannot be written", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await putFact(data, SCOPE, storeFact("b"));
        const dir = join(repo, ".agents", "memory");
        await chmod(dir, 0o555);
        try {
            const report = await sync();
            expect(report.imported).toEqual(["a"]);
            expect(report.exported).toEqual([]);
            expect(report.skipped.map(({ name }) => name)).toEqual(["b"]);
            expect(report.index).toBe("left");
        } finally {
            await chmod(dir, 0o755);
        }
    });

    it("says when a path is in no repository", async () => {
        expect(await syncProject(base, options())).toEqual({
            kind: "not-a-repository",
        });
    });

    it("keeps credentials in the origin out of the registry and the commit", async () => {
        await writeFile(
            join(repo, ".git", "config"),
            '[remote "origin"]\n\turl = https://u:ghp_abcdefghijklmnopqrstuvwxyz0123@github.com/chewygumxx/dorothy.git\n',
        );
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        expect(await readFile(projectsPath(data), "utf8")).not.toContain(
            "ghp_",
        );
        expect(JSON.stringify(commits)).not.toContain("ghp_");
        expect(commits[0]?.message).toBe(`sync: ${ID}: 1 in, 0 out`);
    });

    it("syncs once when two run at once under one lock", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await putRepo("b.md", repoFact("b", "Second fact."));
        const index = RecallIndex.open(join(base, "index", "recall.sqlite"));
        try {
            const results = await Promise.all([
                syncProject(repo, options({ lock: index.lock })),
                syncProject(repo, options({ lock: index.lock })),
            ]);
            const imported = results.flatMap((result) =>
                result.kind === "ok" ? result.report.imported : ["failed"],
            );
            expect(imported.sort()).toEqual(["a", "b"]);
            expect(commits).toHaveLength(1);
        } finally {
            index.close();
        }
    });

    it("never removes a file edited in the working tree that the store retired", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        const [a] = await facts();
        await putFact(data, SCOPE, {
            ...(a as Fact),
            retired: { at: NOW.toISOString(), by: "user", why: "Wrong." },
        });
        const edit = repoFact("a", "Edited, uncommitted.");
        await putRepo("a.md", edit);
        expect(moved(await sync())).toEqual({
            ...NOTHING,
            imported: ["a"],
            conflicts: ["a"],
        });
        expect(await readFile(memory("a.md"), "utf8")).toBe(edit);
        expect((await facts())[0]).toMatchObject({
            description: "Edited, uncommitted.",
            retired: null,
        });
    });

    it("skips a file with a title key or a null, and leaves it", async () => {
        const nulled =
            "---\nname: nulled\ntitle: null\ndescription: x\n---\nBody\n";
        const bare = "---\nname: bare\ndescription: null\n---\nBody\n";
        await putRepo("nulled.md", nulled);
        await putRepo("bare.md", bare);
        await putRepo("MEMORY.md", "kept by hand\n");
        const report = await sync();
        expect(moved(report)).toEqual(NOTHING);
        expect(report.skipped.map(({ name }) => name)).toEqual([
            "bare",
            "nulled",
        ]);
        expect(await readFile(memory("nulled.md"), "utf8")).toBe(nulled);
        expect(await readFile(memory("bare.md"), "utf8")).toBe(bare);
        expect(await readFile(memory("MEMORY.md"), "utf8")).toBe(
            "kept by hand\n",
        );
        expect(await facts()).toEqual([]);
    });

    it("skips and names a file it cannot read, and goes on", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await putRepo("b.md", repoFact("b", "Second fact."));
        await putRepo("MEMORY.md", "kept by hand\n");
        await chmod(memory("b.md"), 0o000);
        try {
            const report = await sync();
            expect(report.imported).toEqual(["a"]);
            expect(report.skipped).toEqual([
                { name: "b", reason: "it cannot be read, EACCES" },
            ]);
            expect(report.index).toBe("left");
            expect(await readFile(memory("MEMORY.md"), "utf8")).toBe(
                "kept by hand\n",
            );
        } finally {
            await chmod(memory("b.md"), 0o644);
        }
    });

    it("leaves a MEMORY.md that is a symlink, and what it points at", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await writeFile(join(base, "elsewhere.md"), "outside\n");
        await symlink(join(base, "elsewhere.md"), memory("MEMORY.md"));
        const report = await sync();
        expect(report.imported).toEqual(["a"]);
        expect(report.index).toBe("left");
        expect(await readFile(join(base, "elsewhere.md"), "utf8")).toBe(
            "outside\n",
        );
    });

    it("refuses a memory directory that is itself a symlink", async () => {
        await putFact(data, SCOPE, storeFact("a"));
        await mkdir(join(repo, ".agents"));
        await mkdir(join(base, "outside"));
        await symlink(join(base, "outside"), memory(""));
        const result = await syncProject(repo, options());
        expect(result).toEqual({
            kind: "failed",
            reason: `.agents/memory passes through a symlink, ${join(repo, ".agents", "memory")}`,
        });
        expect(await readdir(join(base, "outside"))).toEqual([]);
        expect(commits).toEqual([]);
    });

    it("names a hostile file without its control characters", async () => {
        await putRepo("a\u001b[31mb.md", "Just notes.\n");
        const report = await sync();
        expect(report.skipped).toEqual([
            { name: "a?[31mb", reason: "its name is not a fact's" },
        ]);
    });

    it("leaves a MEMORY.md with a hand's lines, and names why", async () => {
        const kept = "# Memory\n\nSome prose.\n- [Ay](./a.md)\n  first\n";
        await putRepo("a.md", repoFact("a", "First fact."));
        await putRepo("MEMORY.md", kept);
        const report = await sync();
        expect(report.imported).toEqual(["a"]);
        expect(report.index).toBe("left");
        expect(report.indexReason).toBe("it holds lines sync did not write");
        expect(await readFile(memory("MEMORY.md"), "utf8")).toBe(kept);
    });

    it("regenerates MEMORY.md past a skipped file it does not link", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await putRepo("README.md", "Read me.\n");
        await putRepo("feedback_testing.md", "---\nname: x\n---\nNotes\n");
        await putRepo("MEMORY.md", "- [Ay](./a.md)\n  old\n");
        const report = await sync();
        expect(report.skipped.map(({ name }) => name)).toEqual([
            "README",
            "feedback_testing",
        ]);
        expect(report.index).toBe("written");
        expect(await readFile(memory("MEMORY.md"), "utf8")).toBe(
            "- [Ay](./a.md)\n  First fact.\n",
        );
    });

    it("leaves MEMORY.md when it links a skipped file", async () => {
        const kept = "- [Ay](./a.md)\n  first\n- [Trap](./trap.md)\n  hidden\n";
        await putRepo("a.md", repoFact("a", "First fact."));
        await putRepo("trap.md", "---\nname: trap\ndescription: 1e3\n---\nx\n");
        await putRepo("MEMORY.md", kept);
        const report = await sync();
        expect(report.index).toBe("left");
        expect(report.indexReason).toBe("it links trap, which was skipped");
        expect(await readFile(memory("MEMORY.md"), "utf8")).toBe(kept);
    });

    it("takes an imported fact's title from its index entry, else the store's", async () => {
        await putFact(data, SCOPE, storeFact("a", { title: "Old" }));
        await sync();
        await putRepo("a.md", repoFact("a", "Edited once."));
        await putRepo("MEMORY.md", "- [New title](./a.md)\n  hand\n");
        await sync();
        expect((await facts())[0]?.title).toBe("New title");
        await rm(memory("MEMORY.md"));
        await putFact(data, SCOPE, {
            ...((await facts())[0] as Fact),
            title: "Store's",
        });
        await putRepo("a.md", repoFact("a", "Edited twice."));
        await sync();
        expect((await facts())[0]).toMatchObject({
            description: "Edited twice.",
            title: "Store's",
        });
    });

    it("keeps each checkout's own record, so a stale one is brought up to date", async () => {
        const second = join(base, "second");
        await mkdir(join(second, ".git"), { recursive: true });
        await writeFile(
            join(second, ".git", "config"),
            await readFile(join(repo, ".git", "config")),
        );
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        expect(moved(await ok(syncProject(second, options())))).toEqual({
            ...NOTHING,
            exported: ["a"],
        });
        const [a] = await facts();
        await putFact(data, SCOPE, {
            ...(a as Fact),
            description: "Newer, in the store.",
        });
        expect(moved(await sync())).toEqual({ ...NOTHING, exported: ["a"] });
        // The second checkout last synced the old version: it is brought
        // up to date, and its old version is not imported over the new.
        expect(moved(await ok(syncProject(second, options())))).toEqual({
            ...NOTHING,
            exported: ["a"],
        });
        expect(
            await readFile(join(second, ".agents", "memory", "a.md"), "utf8"),
        ).toContain("Newer, in the store.");
        expect((await facts())[0]?.description).toBe("Newer, in the store.");
        const registry = JSON.parse(await readFile(projectsPath(data), "utf8"));
        expect(Object.keys(registry.projects[ID].synced).sort()).toEqual(
            [repo, second].sort(),
        );
        expect(registry.projects[ID].synced[repo]).toMatchObject({
            dir: ".agents/memory",
        });
        expect(Object.keys(registry.projects[ID].synced[repo].facts)).toEqual([
            "a",
        ]);
    });

    it("takes an edited memory directory as a first sync, retiring nothing", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await putFact(data, SCOPE, storeFact("b"));
        expect(moved(await sync())).toEqual({
            ...NOTHING,
            imported: ["a"],
            exported: ["b"],
        });
        const registry = JSON.parse(await readFile(projectsPath(data), "utf8"));
        registry.projects[ID].memoryDir = "docs/memory";
        await writeFile(projectsPath(data), JSON.stringify(registry));
        await mkdir(join(repo, "docs", "memory"), { recursive: true });
        await writeFile(
            join(repo, "docs", "memory", "c.md"),
            repoFact("c", "Third fact."),
        );
        const report = await sync();
        expect(report.memoryDir).toBe("docs/memory");
        expect(moved(report)).toEqual({
            ...NOTHING,
            imported: ["c"],
            exported: ["a", "b"],
        });
        expect((await facts()).map((fact) => fact.retired)).toEqual([
            null,
            null,
            null,
        ]);
        expect((await readdir(join(repo, "docs", "memory"))).sort()).toEqual([
            "MEMORY.md",
            "a.md",
            "b.md",
            "c.md",
        ]);
        const after = JSON.parse(await readFile(projectsPath(data), "utf8"));
        expect(after.projects[ID].synced[repo].dir).toBe("docs/memory");
        expect(moved(await sync())).toEqual(NOTHING);
    });

    it("retires every fact when the memory directory it synced is gone", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await putRepo("b.md", repoFact("b", "Second fact."));
        await sync();
        await rm(join(repo, ".agents", "memory"), { recursive: true });
        expect(moved(await sync())).toEqual({
            ...NOTHING,
            retired: ["a", "b"],
        });
    });

    it("skips and names a directory called like a fact, and retires nothing", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        await rm(memory("a.md"));
        await mkdir(memory("a.md"));
        const report = await sync();
        expect(moved(report)).toEqual(NOTHING);
        expect(report.skipped).toEqual([
            { name: "a", reason: "it is not a regular file" },
        ]);
        expect((await facts())[0]?.retired).toBeNull();
    });

    it("lists a failed import as skipped, not as a conflict", async () => {
        await putRepo("a.md", repoFact("a", "First fact."));
        await sync();
        const [a] = await facts();
        await putFact(data, SCOPE, {
            ...(a as Fact),
            description: "Changed in the store.",
        });
        await putRepo("a.md", repoFact("a", "Changed in the working tree."));
        const store = scopeDir(data, SCOPE);
        await chmod(store, 0o500);
        try {
            const report = await sync();
            expect(report.conflicts).toEqual([]);
            expect(report.imported).toEqual([]);
            expect(report.skipped.map(({ name }) => name)).toEqual(["a"]);
        } finally {
            await chmod(store, 0o700);
        }
    });
});
