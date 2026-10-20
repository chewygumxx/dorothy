// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/facts/commands.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    chmod,
    mkdir,
    mkdtemp,
    realpath,
    rm,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { buildBlock } from "../contract/block.js";
import { baselineEngine } from "../engine/baseline.js";
import { authorOf } from "../history/commands.js";
import type { HistoryHandle, OpenHistory } from "../memory/sidecar.js";
import type { SyncReport } from "../projects/sync.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import {
    formatReport,
    runFacts,
    runProjects,
    runRetire,
    runRetireFrom,
    runRevive,
    runSync,
    runVerify,
} from "./commands.js";
import { type Fact, isConfirmed } from "./file.js";
import {
    dataRoot,
    factPath,
    PERSONAL,
    putFact,
    readFactFile,
    type Scope,
} from "./store.js";

const NOW = new Date("2026-10-15T09:30:00.000Z");
const PHRASE = "bingo-overabundance-mazer-kasha";
const PROJECT: Scope = { kind: "project", id: "github.com/chewygumxx/dorothy" };

function capture() {
    let text = "";
    return {
        write: (chunk: string) => {
            text += chunk;
        },
        get text() {
            return text;
        },
    };
}

let dir = "";
let env: Record<string, string> = {};
let out = capture();
let err = capture();
let commits: string[] = [];
beforeEach(async () => {
    dir = await realpath(
        await mkdtemp(join(tmpdir(), "dorothy-fact-commands-")),
    );
    env = {
        XDG_DATA_HOME: dir,
        XDG_CACHE_HOME: join(dir, "cache"),
        XDG_CONFIG_HOME: dir,
        HOME: dir,
    };
    out = capture();
    err = capture();
    commits = [];
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

const history: OpenHistory = async (index) => {
    const handle: HistoryHandle = {
        recorder: async (_, message) => {
            commits.push(message);
        },
        lock: index?.lock ?? ((work) => work()),
        sweep: async () => {},
        heal: async () => false,
        close: () => {},
    };
    return handle;
};
const options = () => ({ env, out, err, now: () => NOW, openHistory: history });
const fact = (name: string, fields: Partial<Fact> = {}): Fact => ({
    name,
    title: name,
    description: `About ${name}.`,
    type: "user",
    extra: {},
    tags: [],
    importance: null,
    provenance: {
        origin: "user",
        by: "dorothy",
        at: NOW.toISOString(),
        created: NOW.toISOString(),
    },
    retired: null,
    body: "Body.",
    ...fields,
});

describe("runFacts", () => {
    it("lists facts by scope, says which are retired, and names broken ones", async () => {
        const root = dataRoot(env);
        await putFact(
            root,
            PERSONAL,
            fact("likes-tea", {
                title: "Likes tea",
                description: "Prefers tea.",
            }),
        );
        await putFact(
            root,
            PROJECT,
            fact("gateway", {
                type: "project",
                title: "The gateway",
                description: "Rewrites the prompt.",
                retired: { at: NOW.toISOString(), by: "user", why: "Done." },
            }),
        );
        await writeFile(
            join(root, "knowledge", "personal", "broken.md"),
            "x\n",
        );
        expect(await runFacts(options())).toBe(0);
        expect(out.text).toBe(
            [
                "personal",
                "  user       likes-tea  Likes tea",
                "             Prefers tea.",
                "github.com/chewygumxx/dorothy",
                "  project    gateway  The gateway (retired)",
                "             Rewrites the prompt.",
                "",
            ].join("\n"),
        );
        expect(err.text).toBe(
            `dorothy: ${join(root, "knowledge", "personal", "broken.md")}: it has no frontmatter\n`,
        );
    });

    it("says when there are none", async () => {
        expect(await runFacts(options())).toBe(0);
        expect(out.text).toBe("No facts yet.\n");
    });
});

describe("retiring and reviving", () => {
    it("retires a fact as the user's choice, records it, and revives it", async () => {
        await putFact(dataRoot(env), PERSONAL, fact("likes-tea"));
        expect(await runRetire("personal/likes-tea", options())).toBe(0);
        expect(out.text).toBe("Retired personal/likes-tea.\n");
        const read = await readFactFile(
            factPath(dataRoot(env), PERSONAL, "likes-tea"),
            "likes-tea",
        );
        expect(read.kind === "ok" && read.fact.retired?.by).toBe("user");
        expect(await runRetire("personal/likes-tea", options())).toBe(0);
        expect(out.text).toEndWith("personal/likes-tea was retired already.\n");
        expect(await runRevive("personal/likes-tea", options())).toBe(0);
        expect(out.text).toEndWith("Revived personal/likes-tea.\n");
        expect(commits).toEqual([
            "retire: personal/likes-tea",
            "revive: personal/likes-tea",
        ]);
    });

    it("refuses a target that names no fact, and one that is missing", async () => {
        expect(await runRetire("likes-tea", options())).toBe(1);
        expect(err.text).toBe(
            "dorothy: likes-tea names no fact; give personal/<name> or <project id>/<name>\n",
        );
        expect(await runRevive("personal/nothing", options())).toBe(1);
        expect(err.text).toEndWith(
            "dorothy: there is no fact personal/nothing\n",
        );
    });

    it("retires what one conversation gave", async () => {
        await putFact(
            dataRoot(env),
            PERSONAL,
            fact("a", {
                provenance: {
                    origin: "dorothy",
                    by: "review",
                    at: NOW.toISOString(),
                    created: NOW.toISOString(),
                    from: `${PHRASE}#2`,
                },
            }),
        );
        expect(await runRetireFrom(PHRASE, options())).toBe(0);
        expect(out.text).toBe(`Retired 1 fact from ${PHRASE}.\n`);
    });
});

describe("retiring what one conversation gave, and finding none", () => {
    it("says there is none, and fails", async () => {
        await putFact(dataRoot(env), PERSONAL, fact("a"));
        expect(await runRetireFrom(PHRASE, options())).toBe(1);
        expect(out.text).toBe("");
        expect(err.text).toBe(
            `dorothy: no live fact came from ${PHRASE}; nothing was retired\n`,
        );
    });

    it.each([false, true])(
        "names completed retirements after recorder failure (partial: %s)",
        async (partial) => {
            for (const [name, scope] of [
                ["a", PERSONAL],
                ["b", PROJECT],
            ] as const) {
                await putFact(
                    dataRoot(env),
                    scope,
                    fact(name, {
                        provenance: {
                            origin: "external",
                            by: "review",
                            at: NOW.toISOString(),
                            created: NOW.toISOString(),
                            from: `${PHRASE}#2`,
                        },
                    }),
                );
            }
            const directory = dirname(factPath(dataRoot(env), PROJECT, "b"));
            if (partial) {
                await chmod(directory, 0o500);
            }
            try {
                expect(
                    await runRetireFrom(PHRASE, {
                        ...options(),
                        openHistory: async (index) => ({
                            ...((await history(index)) as HistoryHandle),
                            recorder: async () => {
                                throw new Error("recorder unavailable");
                            },
                        }),
                    }),
                ).toBe(1);
            } finally {
                await chmod(directory, 0o700);
            }
            expect(err.text).toContain("recorder unavailable");
            expect(err.text).toContain(
                partial
                    ? "retired before it failed: personal/a\n"
                    : "retired before it failed: personal/a, github.com/chewygumxx/dorothy/b\n",
            );
            expect(out.text).toBe("");
            expect(
                (
                    await readFactFile(
                        factPath(dataRoot(env), PERSONAL, "a"),
                        "a",
                    )
                ).kind,
            ).toBe("ok");
        },
    );

    it("names the facts retired before a write failed", async () => {
        const given = (name: string, scope: Scope) =>
            putFact(
                dataRoot(env),
                scope,
                fact(name, {
                    provenance: {
                        origin: "dorothy",
                        by: "review",
                        at: NOW.toISOString(),
                        created: NOW.toISOString(),
                        from: `${PHRASE}#2`,
                    },
                }),
            );
        await given("a", PERSONAL);
        await given("b", PROJECT);
        const project = dirname(factPath(dataRoot(env), PROJECT, "b"));
        await chmod(project, 0o500);
        try {
            expect(await runRetireFrom(PHRASE, options())).toBe(1);
        } finally {
            await chmod(project, 0o700);
        }
        expect(err.text).toContain("retired before it failed: personal/a\n");
        expect(commits).toEqual([`retire: 1 fact from ${PHRASE}`]);
    });
});

describe("runVerify", () => {
    const MODEL = {
        origin: "dorothy" as const,
        by: "dorothy" as const,
        at: NOW.toISOString(),
        created: NOW.toISOString(),
    };
    const LATER = new Date("2026-10-16T09:30:00.000Z");
    const read = async (scope: Scope, name: string) => {
        const found = await readFactFile(
            factPath(dataRoot(env), scope, name),
            name,
        );
        return found.kind === "ok" ? found.fact : null;
    };

    it("confirms a model's knowledge as the user's, and says so", async () => {
        await putFact(
            dataRoot(env),
            PROJECT,
            fact("uses-bun", { provenance: MODEL }),
        );
        const id = "k:projects/github.com/chewygumxx/dorothy/uses-bun";
        expect(await runVerify(id, { ...options(), now: () => LATER })).toBe(0);
        expect(out.text).toBe(`Verified ${id}: it is confirmed now.\n`);
        const verified = await read(PROJECT, "uses-bun");
        expect(verified?.foreign).toEqual({
            verified: [{ by: "human:owner", at: LATER.toISOString() }],
        });
        expect(verified?.provenance).toEqual(MODEL);
        expect(verified !== null && isConfirmed(verified)).toBe(true);
        expect(commits).toEqual([
            "verify: github.com/chewygumxx/dorothy/uses-bun (user)",
        ]);
        expect(authorOf(commits[0] as string)).toBe("user");
    });

    it("confirms knowledge a repository's file gave", async () => {
        await putFact(
            dataRoot(env),
            PERSONAL,
            fact("synced", {
                provenance: { ...MODEL, origin: "repo", by: "repo" },
            }),
        );
        expect(await runVerify("k:personal/synced", options())).toBe(0);
        expect(out.text).toBe(
            "Verified k:personal/synced: it is confirmed now.\n",
        );
        const verified = await read(PERSONAL, "synced");
        expect(verified !== null && isConfirmed(verified)).toBe(true);
    });

    it("keeps verifications another hand made", async () => {
        await putFact(
            dataRoot(env),
            PERSONAL,
            fact("likes-tea", {
                provenance: MODEL,
                foreign: { verified: [{ by: "agent:x", at: "then" }] },
            }),
        );
        expect(await runVerify("k:personal/likes-tea", options())).toBe(0);
        expect((await read(PERSONAL, "likes-tea"))?.foreign).toEqual({
            verified: [
                { by: "agent:x", at: "then" },
                { by: "human:owner", at: NOW.toISOString() },
            ],
        });
    });

    it("changes nothing on confirmed knowledge, and says why", async () => {
        const root = dataRoot(env);
        await putFact(root, PERSONAL, fact("mine"));
        await putFact(
            root,
            PERSONAL,
            fact("checked", {
                provenance: MODEL,
                foreign: {
                    verified: [{ by: "human:owner", at: NOW.toISOString() }],
                },
            }),
        );
        await putFact(
            root,
            PERSONAL,
            fact("vouched", {
                provenance: MODEL,
                foreign: {
                    verified: [{ by: "human:alice", at: NOW.toISOString() }],
                },
            }),
        );
        const names = ["mine", "checked", "vouched"];
        const before = await Promise.all(
            names.map((name) =>
                Bun.file(factPath(root, PERSONAL, name)).text(),
            ),
        );
        for (const name of names) {
            expect(await runVerify(`k:personal/${name}`, options())).toBe(0);
        }
        expect(out.text).toBe(
            [
                "k:personal/mine is confirmed already: it is yours.",
                "k:personal/checked is confirmed already: you verified it.",
                "k:personal/vouched is confirmed already: human:alice verified it.",
                "",
            ].join("\n"),
        );
        const after = await Promise.all(
            names.map((name) =>
                Bun.file(factPath(root, PERSONAL, name)).text(),
            ),
        );
        expect(after).toEqual(before);
        expect(commits).toEqual([]);
    });

    it("refuses an unknown id, and one that is no knowledge's", async () => {
        expect(await runVerify("k:personal/nothing", options())).toBe(1);
        expect(err.text).toBe(
            "dorothy: there is no knowledge k:personal/nothing\n",
        );
        for (const id of ["personal/likes-tea", `c:${PHRASE}`, "k:x"]) {
            expect(await runVerify(id, options())).toBe(1);
            expect(err.text).toEndWith(
                `dorothy: ${id} is no knowledge's id; give k:personal/<name> or k:projects/<project id>/<name>\n`,
            );
        }
        expect(commits).toEqual([]);
    });

    it("shows the piece as confirmed in the next block", async () => {
        await putFact(
            dataRoot(env),
            PERSONAL,
            fact("likes-tea", { provenance: MODEL }),
        );
        const block = async () => {
            const index = RecallIndex.open(indexPath(env));
            try {
                const engine = baselineEngine({
                    env,
                    index,
                    halfLifeDays: 30,
                    reviewer: null,
                });
                return (
                    await buildBlock({ project: null, budget: 10_000 }, engine)
                ).text;
            } finally {
                index.close();
            }
        };
        const fenced = await block();
        expect(fenced.indexOf("<unconfirmed-knowledge>")).toBeLessThan(
            fenced.indexOf("k:personal/likes-tea"),
        );
        expect(await runVerify("k:personal/likes-tea", options())).toBe(0);
        const confirmed = await block();
        expect(confirmed).not.toContain("<unconfirmed-knowledge>");
        expect(confirmed).toContain(
            '<knowledge scope="personal">\n- likes-tea (k:personal/likes-tea)',
        );
    });
});

describe("runSync and runProjects", () => {
    it("syncs the repository the working directory is in, and lists it", async () => {
        const repo = join(dir, "repo");
        await mkdir(join(repo, ".git"), { recursive: true });
        await writeFile(
            join(repo, ".git", "config"),
            '[remote "origin"]\n\turl = git@github.com:chewygumxx/dorothy.git\n',
        );
        await mkdir(join(repo, ".agents", "memory"), { recursive: true });
        await writeFile(
            join(repo, ".agents", "memory", "a.md"),
            '---\nname: a\ndescription: "First."\nmetadata:\n  type: project\n---\n\nBody.\n',
        );
        expect(await runSync(null, { ...options(), cwd: repo })).toBe(0);
        expect(out.text).toBe(
            "github.com/chewygumxx/dorothy: 1 in, 0 out (.agents/memory)\nimported: a\n",
        );
        expect(commits).toEqual([
            "sync: github.com/chewygumxx/dorothy: 1 in, 0 out",
        ]);
        const listed = capture();
        expect(await runProjects({ ...options(), out: listed })).toBe(0);
        expect(listed.text).toBe(
            `github.com/chewygumxx/dorothy  .agents/memory  ${repo}\n`,
        );
    });

    it("says when the path is a file, not a directory", async () => {
        const file = join(dir, "notes.md");
        await writeFile(file, "x\n");
        expect(await runSync(file, { ...options(), cwd: dir })).toBe(1);
        expect(err.text).toBe(`dorothy: ${file} is not a directory\n`);
    });

    it("says when the path is in no repository", async () => {
        expect(await runSync(null, { ...options(), cwd: dir })).toBe(1);
        expect(err.text).toBe(`dorothy: ${dir} is not in a git repository\n`);
    });

    it("says when the path does not exist", async () => {
        expect(await runSync("elsewhere", { ...options(), cwd: dir })).toBe(1);
        expect(err.text).toBe(
            `dorothy: ${join(dir, "elsewhere")} does not exist\n`,
        );
    });

    it("says when there are no projects", async () => {
        expect(await runProjects(options())).toBe(0);
        expect(out.text).toBe("No projects yet.\n");
    });
});

describe("formatReport", () => {
    const report: SyncReport = {
        project: { root: "/r", id: "github.com/o/r", name: "r" },
        memoryDir: ".agents/memory",
        imported: ["a", "b"],
        renamed: [],
        exported: ["c"],
        removed: [],
        retired: ["d"],
        conflicts: ["a"],
        skipped: [{ name: "x", reason: "it has no frontmatter" }],
        index: "left",
        indexReason: "it holds lines sync did not write",
        omitted: 2,
    };

    it("names what moved, conflicts, skips, why MEMORY.md was left and what it omits", () => {
        expect(formatReport(report)).toBe(
            [
                "github.com/o/r: 3 in, 1 out (.agents/memory)",
                "imported: a, b",
                "exported: c",
                "retired: d",
                "conflict: a; the repository's version was kept",
                "skipped: x (it has no frontmatter)",
                "MEMORY.md left as it is: it holds lines sync did not write",
                "MEMORY.md leaves out 2 facts, past what Claude Code loads",
                "",
            ].join("\n"),
        );
    });

    it("names the facts that files in snake case became, and an unrecorded sync", () => {
        const text = formatReport({
            ...report,
            imported: ["feedback-testing"],
            renamed: [
                { file: "feedback_testing.md", name: "feedback-testing" },
            ],
            exported: [],
            retired: [],
            conflicts: [],
            skipped: [],
            omitted: 0,
            index: "written",
            indexReason: undefined,
            unrecorded: "history is busy",
        });
        expect(text).toBe(
            [
                "github.com/o/r: 1 in, 0 out (.agents/memory)",
                "imported: feedback-testing",
                "named: feedback_testing.md as the fact feedback-testing",
                "history was not told of this, and will find it next time: history is busy",
                "",
            ].join("\n"),
        );
    });

    it("says nothing of MEMORY.md when it was written", () => {
        const text = formatReport({
            ...report,
            skipped: [],
            conflicts: [],
            omitted: 0,
            index: "written",
            indexReason: undefined,
        });
        expect(text).toBe(
            "github.com/o/r: 3 in, 1 out (.agents/memory)\nimported: a, b\nexported: c\nretired: d\n",
        );
    });

    it("names what was removed, and leaves out one fact in the singular", () => {
        const text = formatReport({
            ...report,
            imported: [],
            exported: [],
            retired: [],
            removed: ["e", "f"],
            conflicts: [],
            skipped: [],
            index: "written",
            indexReason: undefined,
            omitted: 1,
        });
        expect(text).toBe(
            [
                "github.com/o/r: 0 in, 2 out (.agents/memory)",
                "removed: e, f",
                "MEMORY.md leaves out 1 fact, past what Claude Code loads",
                "",
            ].join("\n"),
        );
    });
});
