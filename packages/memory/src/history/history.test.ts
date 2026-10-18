// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/history/history.test.ts
//
//

import {
    afterAll,
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from "bun:test";
import {
    appendFileSync,
    chmodSync,
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    statSync,
    utimesSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type Fact, parseFact, renderFact } from "../facts/file.js";
import {
    type FactStore,
    moveFact,
    PERSONAL,
    retireFact,
    retireFacts,
    reviveFact,
} from "../facts/store.js";
import { EMPTY_SIDECAR, type Lock } from "../memory/sidecar.js";
import { exportedForm, renderExported } from "../projects/export.js";
import { syncProject } from "../projects/sync.js";
import { binaryRepo } from "./binary.js";
import {
    HOOK_MARK,
    hookScript,
    MemoryHistory,
    maintainDaily,
    openHistory,
} from "./history.js";
import { isoRepo } from "./iso.js";
import { openRepo } from "./open.js";
import { put, removeRoots, TEST_ENV, tempRoot } from "./testing.js";

afterAll(removeRoots);

const NOW = new Date("2026-10-08T00:00:00.000Z");
const PHRASE = "a-b-c-d";
const SIDECAR = `transcripts/${PHRASE}.meta.json`;
const TRANSCRIPT = `transcripts/${PHRASE}.jsonl`;
const vocabulary = (rev: number) =>
    `${JSON.stringify({ v: 1, rev, concepts: {} })}\n`;
const sidecar = (title: string) =>
    `${JSON.stringify({ ...EMPTY_SIDECAR, rev: 1, title })}\n`;
const event = (text: string) =>
    `${JSON.stringify({ v: 1, kind: "user", at: NOW.toISOString(), text })}\n`;

let root = "";
let warnings: string[] = [];
const closers: (() => void)[] = [];

beforeEach(() => {
    root = join(tempRoot(), "data");
    warnings = [];
});
afterEach(() => {
    for (const close of closers.splice(0)) {
        close();
    }
});

async function open(
    options: { quiet?: boolean; hook?: { exec: string; script: string } } = {},
): Promise<MemoryHistory> {
    const opened = await openHistory({
        root,
        index: null,
        engine: "git",
        now: () => NOW,
        hook: options.hook ?? null,
        ...(options.quiet
            ? {}
            : { warn: (message: string) => warnings.push(message) }),
    });
    if (!opened.ok) {
        throw new Error(opened.reason);
    }
    closers.push(opened.close);
    return opened.history;
}

const messages = async (history: MemoryHistory) =>
    (await history.repo.log(undefined, 50)).map((commit) => commit.message);
const record = (history: MemoryHistory, paths: string[], message: string) =>
    history.lock(() =>
        history.record(
            paths.map((path) => join(root, path)),
            message,
        ),
    );

describe("adopting", () => {
    it("commits what the directory holds, once", async () => {
        put(root, "tags.json", vocabulary(1));
        put(root, TRANSCRIPT, event("hi"));
        const history = await open();
        expect(await messages(history)).toEqual(["adopt: 3 files"]);
        expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe("*.tmp\n");
        expect(await history.repo.files("HEAD")).toEqual([
            ".gitignore",
            "tags.json",
            TRANSCRIPT,
        ]);
        await open();
        expect(await messages(history)).toEqual(["adopt: 3 files"]);
    });

    it("keeps the directory and its repository the user's alone", async () => {
        put(root, "tags.json", vocabulary(1));
        chmodSync(root, 0o755);
        const mode = (path: string) => statSync(path).mode & 0o777;
        await open();
        expect(mode(root)).toBe(0o700);
        expect(mode(join(root, ".git"))).toBe(0o700);
        chmodSync(root, 0o755);
        chmodSync(join(root, ".git"), 0o755);
        await open();
        expect(mode(root)).toBe(0o700);
        expect(mode(join(root, ".git"))).toBe(0o700);
    });

    it("adopts a directory that is not there yet", async () => {
        const history = await open();
        expect(await messages(history)).toEqual(["adopt: 1 files"]);
    });

    it("moves a broken file aside, and says so", async () => {
        put(root, "tags.json", "{");
        const history = await open();
        expect(existsSync(join(root, "tags.json"))).toBe(false);
        const copy = "broken/tags.json.2026-10-08T00-00-00-000Z";
        expect(readFileSync(join(root, copy), "utf8")).toBe("{");
        expect(await history.repo.files("HEAD")).toContain(copy);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(
            /^history: tags\.json was broken \(.+\); it is kept in broken\/tags\.json\.2026-10-08T00-00-00-000Z$/,
        );
    });

    it("adopts a transcript with a damaged middle line in place", async () => {
        const text = `${event("one")}{"torn\n${event("two")}`;
        put(root, TRANSCRIPT, text);
        const history = await open();
        expect(readFileSync(join(root, TRANSCRIPT), "utf8")).toBe(text);
        expect(existsSync(join(root, "broken"))).toBe(false);
        expect(await history.repo.files("HEAD")).toEqual([
            ".gitignore",
            TRANSCRIPT,
        ]);
        expect(await messages(history)).toEqual(["adopt: 2 files"]);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(
            /^history: transcripts\/a-b-c-d\.jsonl has a damaged line \(.+\); adopted as it is$/,
        );
    });

    it("writes its pre-commit hook, and never replaces the user's", async () => {
        const hook = {
            exec: "/usr/bin/bun",
            script: "/opt/dorothy/src/index.ts",
        };
        await open({ hook });
        const path = join(root, ".git", "hooks", "pre-commit");
        expect(readFileSync(path, "utf8")).toBe(
            hookScript(hook.exec, hook.script),
        );
        expect(statSync(path).mode & 0o777).toBe(0o700);
        writeFileSync(path, "#!/bin/sh\nexit 0\n");
        await open({ hook });
        expect(readFileSync(path, "utf8")).toBe("#!/bin/sh\nexit 0\n");
    });

    it("hooks a lint that steps aside when Dorothy is gone", () => {
        const script = hookScript("/usr/bin/bun", "/it's/index.ts");
        expect(script).toContain(HOOK_MARK);
        expect(script).toContain(
            "exec '/usr/bin/bun' '/it'\\''s/index.ts' --check --staged",
        );
        expect(script).toContain("if [ ! -f '/it'\\''s/index.ts' ]; then");
    });

    it("rewrites a fact edited by hand as Dorothy writes one, and makes it the user's", async () => {
        const path = "knowledge/personal/likes-tea.md";
        const fact = {
            name: "likes-tea",
            title: "Likes tea",
            description: "Prefers tea.",
            type: "user" as const,
            extra: {},
            tags: [],
            importance: null,
            provenance: {
                origin: "dorothy" as const,
                by: "review" as const,
                at: "2026-10-01T00:00:00.000Z",
                created: "2026-10-01T00:00:00.000Z",
                model: "m",
            },
            retired: null,
            body: "Tea.",
        };
        put(root, path, renderFact(fact));
        const history = await open();
        put(
            root,
            path,
            renderFact(fact).replace(
                "title: >-\n  Likes tea",
                'title: "Likes  coffee"',
            ),
        );
        await history.sweep();
        const read = parseFact(
            readFileSync(join(root, path), "utf8"),
            "likes-tea",
        );
        expect(read).toEqual({
            kind: "ok",
            fact: {
                ...fact,
                title: "Likes coffee",
                provenance: {
                    origin: "user",
                    by: "user",
                    at: NOW.toISOString(),
                    created: "2026-10-01T00:00:00.000Z",
                },
            },
        });
        expect((await messages(history))[0]).toBe(`outside: ${path}`);
    });

    it("takes a fact added by hand without provenance as the user's", async () => {
        const history = await open();
        const path = "knowledge/personal/likes-tea.md";
        put(
            root,
            path,
            "---\ntype: user\ntitle: Likes tea\ndescription: Prefers tea.\n---\n\nTea.\n",
        );
        await history.sweep();
        const read = parseFact(
            readFileSync(join(root, path), "utf8"),
            "likes-tea",
        );
        expect(read.kind === "ok" && read.fact.provenance.by).toBe("user");
        expect((await messages(history))[0]).toBe(`outside: ${path}`);
    });

    it("leaves a fact that is not UTF-8 to the lint, unrewritten", async () => {
        const history = await open();
        const path = "knowledge/personal/likes-tea.md";
        const bytes = Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0x0a]);
        put(root, path, "");
        writeFileSync(join(root, path), bytes);
        await history.sweep();
        expect(readFileSync(join(root, path))).toEqual(bytes);
        expect((await messages(history))[0]).toBe(
            `broken: ${path} kept, no good version`,
        );
    });

    it("keeps a copy of a fact edited into something that is no fact", async () => {
        const history = await open();
        put(root, "knowledge/personal/likes-tea.md", "title: null\n");
        await history.sweep();
        expect(warnings[0]).toContain(
            "knowledge/personal/likes-tea.md is broken",
        );
        expect((await messages(history))[0]).toBe(
            "broken: knowledge/personal/likes-tea.md kept, no good version",
        );
    });
});

const TEA = {
    name: "likes-tea",
    title: "Likes tea",
    description: "Prefers tea.",
    type: "user" as const,
    extra: {},
    tags: [],
    importance: null,
    provenance: {
        origin: "dorothy" as const,
        by: "review" as const,
        at: "2026-10-01T00:00:00.000Z",
        created: "2026-10-01T00:00:00.000Z",
        model: "m",
    },
    retired: null,
    body: "Tea.",
};
const TEA_PATH = "knowledge/personal/likes-tea.md";
const provenanceOf = (path: string) => {
    const read = parseFact(readFileSync(join(root, path), "utf8"), "likes-tea");
    return read.kind === "ok" ? read.fact.provenance : null;
};

describe("facts in the sweep and in a record", () => {
    it("commits Dorothy's own uncommitted facts as they are", async () => {
        const history = await open();
        const repo = {
            ...TEA,
            name: "from-repo",
            provenance: {
                origin: "repo" as const,
                by: "repo" as const,
                at: "2026-10-02T00:00:00.000Z",
                created: "2026-10-02T00:00:00.000Z",
            },
        };
        put(root, TEA_PATH, renderFact(TEA));
        put(root, "knowledge/personal/from-repo.md", renderFact(repo));
        await history.sweep();
        expect(readFileSync(join(root, TEA_PATH), "utf8")).toBe(
            renderFact(TEA),
        );
        expect(
            readFileSync(join(root, "knowledge/personal/from-repo.md"), "utf8"),
        ).toBe(renderFact(repo));
        expect((await messages(history)).slice(0, 2).sort()).toEqual([
            "outside: knowledge/personal/from-repo.md",
            `outside: ${TEA_PATH}`,
        ]);
        expect(await history.repo.changed()).toEqual([]);
    });

    it("takes a canonical hand edit keeping its provenance as the user's", async () => {
        put(root, TEA_PATH, renderFact(TEA));
        const history = await open();
        put(root, TEA_PATH, renderFact({ ...TEA, body: "Coffee." }));
        await history.sweep();
        const read = parseFact(
            readFileSync(join(root, TEA_PATH), "utf8"),
            "likes-tea",
        );
        expect(read.kind === "ok" && read.fact.body).toBe("Coffee.");
        expect(provenanceOf(TEA_PATH)).toEqual({
            origin: "user",
            by: "user",
            at: NOW.toISOString(),
            created: TEA.provenance.created,
        });
    });

    it("keeps a hand-made fact under no project id as it was written", async () => {
        const history = await open();
        const path = "knowledge/projects/nohost/likes-tea.md";
        const text =
            "---\ntype: user\ntitle: Likes tea\ndescription: Prefers tea.\n---\n\nTea.\n";
        put(root, path, text);
        await history.sweep();
        const folder = join(root, "broken", "knowledge/projects/nohost");
        const copies = readdirSync(folder);
        expect(copies).toHaveLength(1);
        expect(readFileSync(join(folder, copies[0] as string), "utf8")).toBe(
            text,
        );
        expect(warnings[0]).toContain(
            "is broken (it is not under a project id)",
        );
    });

    it("leaves Dorothy's own fact in a record as she wrote it", async () => {
        const history = await open();
        const text = renderFact({
            ...TEA,
            provenance: { ...TEA.provenance, origin: "repo", by: "repo" },
        }).replace("title: >-\n  Likes tea", 'title: "Likes tea"');
        put(root, TEA_PATH, text);
        await history.lock(() =>
            history.record([TEA_PATH], "write: likes-tea"),
        );
        expect(readFileSync(join(root, TEA_PATH), "utf8")).toBe(text);
        expect((await messages(history))[0]).toBe("write: likes-tea");
        expect(provenanceOf(TEA_PATH)?.origin).toBe("repo");
    });

    it("rewrites a fact edited by hand during a record", async () => {
        put(root, TEA_PATH, renderFact(TEA));
        const history = await open();
        put(
            root,
            TEA_PATH,
            renderFact(TEA).replace(
                "title: >-\n  Likes tea",
                'title: "Likes coffee"',
            ),
        );
        put(root, "tags.json", vocabulary(1));
        await history.lock(() => history.record(["tags.json"], "tags: one"));
        expect(provenanceOf(TEA_PATH)?.by).toBe("user");
        expect(readFileSync(join(root, TEA_PATH), "utf8")).toContain(
            "title: >-\n  Likes coffee",
        );
        expect((await messages(history)).slice(0, 2)).toEqual([
            "tags: one",
            `outside: ${TEA_PATH}`,
        ]);
    });
});

describe("recording", () => {
    it("clears a lock a crashed git left, and only a stale one", async () => {
        const history = await open();
        const lock = join(root, ".git", "index.lock");
        writeFileSync(lock, "");
        put(root, "tags.json", vocabulary(1));
        await record(history, ["tags.json"], "fresh");
        // A minute's grace: a git of the user's may still hold it.
        expect(existsSync(lock)).toBe(true);
        expect((await messages(history))[0]).toBe("adopt: 1 files");
        const old = Date.now() / 1000 - 120;
        utimesSync(lock, old, old);
        put(root, SIDECAR, sidecar("One"));
        await record(history, [SIDECAR], "stale");
        expect(existsSync(lock)).toBe(false);
        expect((await messages(history)).slice(0, 2)).toEqual([
            "stale",
            "catch-up: tags.json",
        ]);
        expect(warnings).toContain(
            `history: removed ${lock}, a stale lock a stopped git left`,
        );
    });

    it("commits a change once, under its message", async () => {
        const history = await open();
        put(root, SIDECAR, sidecar("One"));
        put(root, "tags.json", vocabulary(1));
        const message = `review: ${PHRASE} (dorothy, claude-test)`;
        await record(history, [SIDECAR, "tags.json"], message);
        expect(await messages(history)).toEqual([message, "adopt: 1 files"]);
        await record(history, [SIDECAR], "again");
        await history.lock(() => history.record(["/elsewhere/file"], "away"));
        expect(await messages(history)).toEqual([message, "adopt: 1 files"]);
    });

    it("commits an outside change first, as its own", async () => {
        put(root, "tags.json", vocabulary(1));
        const history = await open();
        put(root, "tags.json", vocabulary(2));
        put(root, SIDECAR, sidecar("One"));
        await record(history, [SIDECAR], `edit: ${PHRASE} (user)`);
        expect(await messages(history)).toEqual([
            `edit: ${PHRASE} (user)`,
            "outside: tags.json",
            "adopt: 2 files",
        ]);
    });

    it("commits another chat's new turns as a turn, never as outside", async () => {
        put(root, TRANSCRIPT, event("one"));
        const history = await open();
        appendFileSync(join(root, TRANSCRIPT), event("two"));
        put(root, "tags.json", vocabulary(1));
        await record(history, ["tags.json"], "edit-tags: 1 concepts (user)");
        expect((await messages(history)).slice(0, 2)).toEqual([
            "edit-tags: 1 concepts (user)",
            `turn: ${PHRASE}`,
        ]);
    });

    it("restores a file an outside edit broke, and warns", async () => {
        put(root, "tags.json", vocabulary(1));
        const history = await open();
        put(root, "tags.json", "{");
        put(root, SIDECAR, sidecar("One"));
        await record(history, [SIDECAR], `edit: ${PHRASE} (user)`);
        expect(readFileSync(join(root, "tags.json"), "utf8")).toBe(
            vocabulary(1),
        );
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toMatch(
            /^Restored tags\.json from [0-9a-f]{7} \(\d{4}-\d\d-\d\d\); the broken copy is in broken\/$/,
        );
    });

    it("dates a restore in local time, as --history does", async () => {
        const zone = process.env.TZ;
        const pad = (value: number) => String(value).padStart(2, "0");
        try {
            // Twenty-six hours apart, so at any moment one of them is on
            // another day than UTC.
            for (const tz of ["Pacific/Kiritimati", "Etc/GMT+12"]) {
                process.env.TZ = tz;
                root = join(tempRoot(), "data");
                warnings = [];
                put(root, "tags.json", vocabulary(1));
                const history = await open();
                const [good] = await history.repo.log("tags.json");
                const at = new Date(good?.at ?? "");
                put(root, "tags.json", "{");
                await history.heal("tags.json");
                expect(warnings).toEqual([
                    `Restored tags.json from ${good?.sha.slice(0, 7)} (${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}); the broken copy is in broken/`,
                ]);
            }
        } finally {
            if (zone === undefined) {
                delete process.env.TZ;
            } else {
                process.env.TZ = zone;
            }
        }
    });

    it("restores rather than commits a named file that fails the lint", async () => {
        put(root, "tags.json", vocabulary(1));
        const history = await open();
        put(root, "tags.json", "{");
        await record(history, ["tags.json"], "edit-tags: 1 concepts (user)");
        expect(readFileSync(join(root, "tags.json"), "utf8")).toBe(
            vocabulary(1),
        );
        expect((await messages(history))[0]).toMatch(
            /^restore: tags\.json from /,
        );
    });

    it("commits a failed change with the next, as a catch-up", async () => {
        const history = await open();
        const commit = history.repo.commit;
        let fail = true;
        history.repo.commit = async (paths, message) => {
            if (fail) {
                fail = false;
                throw new Error("disk full");
            }
            return commit(paths, message);
        };
        put(root, "tags.json", vocabulary(1));
        await record(history, ["tags.json"], "edit-tags: 1 concepts (user)");
        expect(warnings).toEqual([
            "history: couldn't commit (disk full); it will be committed with the next change",
        ]);
        put(root, SIDECAR, sidecar("One"));
        await record(history, [SIDECAR], `edit: ${PHRASE} (user)`);
        expect(await messages(history)).toEqual([
            `edit: ${PHRASE} (user)`,
            "catch-up: tags.json",
            "adopt: 1 files",
        ]);
    });

    it("calls back after each commit", async () => {
        const history = await open();
        let commits = 0;
        history.afterCommit(() => {
            commits += 1;
        });
        put(root, "tags.json", vocabulary(1));
        await record(history, ["tags.json"], "edit-tags: 1 concepts (user)");
        await record(history, ["tags.json"], "unchanged");
        expect(commits).toBe(1);
    });

    it("gives memory a recorder, the lock and healing", async () => {
        const history = await open();
        let closed = false;
        const handle = history.handle(() => {
            closed = true;
        });
        put(root, "tags.json", vocabulary(1));
        await handle.lock(() =>
            handle.recorder(
                [join(root, "tags.json")],
                "edit-tags: 1 concepts (user)",
            ),
        );
        expect((await messages(history))[0]).toBe(
            "edit-tags: 1 concepts (user)",
        );
        handle.close();
        expect(closed).toBe(true);
    });
});

describe("taking the lock itself", () => {
    it("commits a turn with its count", async () => {
        const history = await open();
        put(root, TRANSCRIPT, event("one"));
        await history.turn(join(root, TRANSCRIPT), 3);
        expect((await messages(history))[0]).toBe(`turn: ${PHRASE} #3`);
    });

    it("heals a file found broken, and only a broken one", async () => {
        put(root, "tags.json", vocabulary(1));
        const history = await open();
        put(root, "tags.json", "{");
        expect(await history.heal(join(root, "tags.json"))).toBe(true);
        expect(readFileSync(join(root, "tags.json"), "utf8")).toBe(
            vocabulary(1),
        );
        expect(await history.heal(join(root, "tags.json"))).toBe(false);
        expect(await history.heal(join(root, "missing.json"))).toBe(false);
    });

    it("sweeps up what changed while Dorothy was away", async () => {
        put(root, "tags.json", vocabulary(1));
        const history = await open();
        put(root, "tags.json", vocabulary(2));
        await history.sweep();
        expect((await messages(history))[0]).toBe("outside: tags.json");
    });
});

describe("warnings", () => {
    it("wait for the first subscriber, and come once each", async () => {
        const history = await open({ quiet: true });
        put(root, `transcripts/${PHRASE}.meta.json`, "[]");
        await history.sweep();
        await history.sweep();
        const notices: unknown[] = [];
        history.subscribe((notice) => notices.push(notice));
        expect(notices).toEqual([
            {
                type: "warning",
                message: `history: ${SIDECAR} is broken (not a JSON object) and has no good version; a copy is in broken/`,
            },
        ]);
        expect(history.takeWarnings()).toEqual([]);
    });

    it("can be taken before anyone subscribes", async () => {
        const history = await open({ quiet: true });
        history.warn("one");
        history.warn("one");
        expect(history.takeWarnings()).toEqual(["one"]);
    });
});

describe("a lock that fails", () => {
    it("is a warning, never a rejection", async () => {
        let busy = false;
        const lock: Lock = (work) =>
            busy ? Promise.reject(new Error("busy")) : work();
        const history = await MemoryHistory.open({
            repo: await openRepo(root, { engine: "git" }),
            lock,
            warn: (message) => warnings.push(message),
        });
        put(root, TRANSCRIPT, event("one"));
        put(root, "tags.json", "{");
        busy = true;
        await history.sweep();
        await history.turn(join(root, TRANSCRIPT), 1);
        expect(await history.heal(join(root, "tags.json"))).toBe(false);
        expect(warnings).toEqual([
            "history: couldn't look for changes (busy)",
            "history: couldn't commit (busy); it will be committed with the next change",
            "history: couldn't restore tags.json (busy)",
        ]);
    });
});

describe("a store write left uncommitted", () => {
    // An external fact written with no recorder, as history off, a crash
    // or a recorder that threw leaves it, is still hers to the sweep.
    const FROM = "bingo-overabundance-mazer-kasha";
    const EXTERNAL: Fact = {
        ...TEA,
        provenance: {
            ...TEA.provenance,
            origin: "external",
            from: `${FROM}#1`,
        },
    };
    const TARGET = { scope: PERSONAL, name: "likes-tea" };
    const unrecorded = (): FactStore => ({
        root,
        lock: (work) => work(),
        recorder: null,
        now: () => NOW,
    });
    const swept = async (fact: Fact, write: () => Promise<unknown>) => {
        put(root, TEA_PATH, renderFact(fact));
        const history = await open();
        await write();
        await history.sweep();
        expect(await history.repo.changed()).toEqual([]);
        return provenanceOf(TEA_PATH);
    };

    it.each([
        [
            "retireFact",
            () =>
                retireFact(unrecorded(), TARGET, {
                    by: "user",
                    why: "stale",
                }),
        ],
        [
            "retireFacts",
            () => retireFacts(unrecorded(), FROM, { by: "user", why: "x" }),
        ],
    ])("keeps the origin after %s", async (_, write) => {
        const provenance = await swept(EXTERNAL, write);
        expect(provenance?.origin).toBe("external");
        expect(provenance?.by).toBe("user");
        expect(provenance?.at).toBe(NOW.toISOString());
    });

    it("keeps the origin after reviveFact", async () => {
        const retired: Fact = {
            ...EXTERNAL,
            retired: { at: TEA.provenance.at, by: "user", why: "stale" },
        };
        const provenance = await swept(retired, () =>
            reviveFact(unrecorded(), TARGET),
        );
        expect(provenance?.origin).toBe("external");
        expect(provenance?.at).toBe(NOW.toISOString());
    });

    it("keeps the origin after moveFact there and back", async () => {
        const project = { kind: "project" as const, id: "github.com/a/b" };
        const provenance = await swept(EXTERNAL, async () => {
            await moveFact(unrecorded(), TARGET, project);
            await moveFact(
                unrecorded(),
                { scope: project, name: "likes-tea" },
                PERSONAL,
            );
        });
        expect(provenance?.origin).toBe("external");
        expect(provenance?.at).toBe(NOW.toISOString());
    });

    it("keeps the origin of a fact sync retired", async () => {
        const repo = realpathSync(tempRoot());
        mkdirSync(join(repo, ".git"));
        writeFileSync(
            join(repo, ".git", "config"),
            '[remote "origin"]\n\turl = https://github.com/a/b\n',
        );
        const file = join(repo, ".agents", "memory", "likes-tea.md");
        mkdirSync(join(repo, ".agents", "memory"), { recursive: true });
        writeFileSync(file, renderExported(exportedForm(TEA)));
        const options = {
            root,
            lock: unrecorded().lock,
            recorder: null,
            now: () => NOW,
        };
        expect((await syncProject(repo, options)).kind).toBe("ok");
        const history = await open();
        rmSync(file);
        const result = await syncProject(repo, {
            ...options,
            now: () => new Date(NOW.getTime() + 1000),
        });
        expect(result.kind === "ok" && result.report.retired).toEqual([
            "likes-tea",
        ]);
        await history.sweep();
        const path = "knowledge/projects/github.com/a/b/likes-tea.md";
        expect(provenanceOf(path)).toMatchObject({
            origin: "repo",
            by: "repo",
        });
    });
});

describe("maintainDaily", () => {
    it("repacks under the binary at most once a day", async () => {
        const repo = binaryRepo(root, { env: TEST_ENV });
        await repo.init();
        put(root, "tags.json", vocabulary(1));
        await repo.commit(["tags.json"], "one");
        const now = Date.now();
        expect(await maintainDaily(repo, now)).toBe(true);
        expect(await maintainDaily(repo, now + 1000)).toBe(false);
        expect(await maintainDaily(repo, now + 2 * 86_400_000)).toBe(true);
    });

    it("leaves isomorphic-git alone, which cannot repack", async () => {
        expect(await maintainDaily(isoRepo(root))).toBe(false);
    });
});
