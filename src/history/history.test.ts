// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/history.test.ts
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
    existsSync,
    readFileSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { EMPTY_SIDECAR } from "../memory/sidecar.js";
import {
    HOOK_MARK,
    hookScript,
    type MemoryHistory,
    openHistory,
} from "./history.js";
import { put, removeRoots, tempRoot } from "./testing.js";

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
});

describe("recording", () => {
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
