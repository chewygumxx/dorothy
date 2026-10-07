// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/commands.test.ts
//
//

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import {
    appendFileSync,
    existsSync,
    readdirSync,
    readFileSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { EMPTY_SIDECAR } from "../memory/sidecar.js";
import { binaryRepo } from "./binary.js";
import {
    authorOf,
    commandHistory,
    isLocal,
    runCheck,
    runHistory,
    runMirror,
    runRecover,
    runRestore,
    runRollback,
} from "./commands.js";
import { newKey } from "./seal.js";
import { bareRepo, put, removeRoots, TEST_ENV, tempRoot } from "./testing.js";

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

let home = "";
let env: Record<string, string> = {};
let out = capture();
let err = capture();
beforeEach(() => {
    home = tempRoot();
    env = {
        XDG_DATA_HOME: home,
        XDG_CONFIG_HOME: home,
        XDG_CACHE_HOME: join(home, "cache"),
        HOME: home,
        PATH: process.env.PATH ?? "",
    };
    out = capture();
    err = capture();
});

const data = (path = "") => join(home, "dorothy", path);
const write = (path: string, text: string) => put(data(), path, text);
const read = (path: string) => readFileSync(data(path), "utf8");
const options = () => ({
    env,
    out,
    err,
    engine: "git" as const,
    hook: null,
    now: () => NOW,
    // Tests never reach dotenvx's set, which would write the real .env.
    setSecret: async () => {
        throw new Error("tests never save secrets");
    },
});
const repo = () => binaryRepo(data(), { env: TEST_ENV });
const messages = async () =>
    (await repo().log(undefined, 50)).map((commit) => commit.message);
// A command that sweeps, to commit what the test wrote.
const sweep = () => runHistory({ ...options(), out: capture() });

describe("commandHistory", () => {
    it("adopts and sweeps the data directory, and closes", async () => {
        write("tags.json", vocabulary(1));
        const handle = await commandHistory({ env, err, hook: null })(null);
        expect(handle).not.toBeNull();
        expect(await messages()).toEqual(["adopt: 2 files"]);
        write("tags.json", vocabulary(2));
        await handle?.sweep();
        expect((await messages())[0]).toBe("outside: tags.json");
        handle?.close();
        expect(err.text).toBe(
            "dorothy: memory has no mirror · dorothy --mirror <url>\n",
        );
    });

    it("is off when the config says so", async () => {
        put(home, "dorothy/config.toml", "[history]\nenabled = false\n");
        expect(await commandHistory({ env, hook: null })(null)).toBeNull();
    });

    it("says why when history can't be used, and goes on without", async () => {
        // The data directory is a file.
        writeFileSync(data(), "");
        expect(await commandHistory({ env, err, hook: null })(null)).toBeNull();
        expect(err.text).toStartWith("dorothy: history is off: ");
    });
});

describe("authorOf", () => {
    it("names who made a commit from its message", () => {
        expect(authorOf("review: x (dorothy, claude-test)")).toBe("dorothy");
        expect(authorOf("compaction: x (dorothy, claude-test)")).toBe(
            "dorothy",
        );
        expect(authorOf("title: x (prompt)")).toBe("dorothy");
        expect(authorOf("catch-up: tags.json")).toBe("dorothy");
        expect(authorOf("edit: x (user)")).toBe("user");
        expect(authorOf("edit-tags: 2 concepts (user)")).toBe("user");
        expect(authorOf("rollback: to 3f9a2c1 (user)")).toBe("user");
        expect(authorOf("turn: x #3")).toBe("turn");
        expect(authorOf("outside: tags.json")).toBe("outside");
        expect(authorOf("restore: tags.json from 3f9a2c1 (broken kept)")).toBe(
            "restore",
        );
        expect(authorOf("broken: tags.json kept, no good version")).toBe(
            "restore",
        );
        expect(authorOf("adopt: 3 files")).toBe("adopt");
        expect(authorOf("something else")).toBe("other");
    });
});

describe("runHistory", () => {
    it("lists commits newest first, for all or for one file", async () => {
        write("tags.json", vocabulary(1));
        write(SIDECAR, sidecar("One"));
        await sweep();
        write("tags.json", vocabulary(2));
        await sweep();
        expect(await runHistory(options())).toBe(0);
        const lines = out.text.trimEnd().split("\n");
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatch(
            /^\d{4}-\d\d-\d\d \d\d:\d\d {2}outside {2}outside: tags\.json$/,
        );
        expect(lines[1]).toMatch(/ {2}adopt {4}adopt: 3 files$/);
        out = capture();
        expect(await runHistory({ ...options(), path: SIDECAR })).toBe(0);
        expect(out.text).toContain("adopt: 3 files");
        expect(out.text).not.toContain("outside");
        out = capture();
        expect(await runHistory({ ...options(), count: 1 })).toBe(0);
        expect(out.text.trimEnd().split("\n")).toHaveLength(1);
    });

    it("reminds of a missing mirror, once", async () => {
        expect(await runHistory(options())).toBe(0);
        expect(err.text).toBe(
            "dorothy: memory has no mirror · dorothy --mirror <url>\n",
        );
    });

    it("exits 1 when history is off", async () => {
        put(home, "dorothy/config.toml", "[history]\nenabled = false\n");
        expect(await runHistory(options())).toBe(1);
        expect(err.text).toBe("dorothy: history is off in config.toml\n");
    });
});

describe("runRestore", () => {
    it("puts back a file as it was, keeping what it replaces", async () => {
        write("tags.json", vocabulary(1));
        await sweep();
        const first = (await repo().log())[0]?.sha as string;
        write("tags.json", vocabulary(2));
        await sweep();
        expect(
            await runRestore("tags.json", first.slice(0, 7), options()),
        ).toBe(0);
        expect(read("tags.json")).toBe(vocabulary(1));
        const copy = "broken/tags.json.2026-10-08T00-00-00-000Z";
        expect(read(copy)).toBe(vocabulary(2));
        expect(out.text).toBe(
            `Restored tags.json from ${first.slice(0, 7)}; what it replaced is in ${copy}\n`,
        );
        expect((await messages())[0]).toBe(
            `restore: tags.json from ${first.slice(0, 7)} (broken kept)`,
        );
    });

    it("brings back a deleted file from its newest good version", async () => {
        write("tags.json", vocabulary(1));
        await sweep();
        Bun.spawnSync(["rm", data("tags.json")]);
        expect(await runRestore(data("tags.json"), null, options())).toBe(0);
        expect(read("tags.json")).toBe(vocabulary(1));
    });

    it("says when the file is already as it was", async () => {
        write("tags.json", vocabulary(1));
        await sweep();
        const head = (await repo().log())[0]?.sha as string;
        expect(await runRestore("tags.json", head, options())).toBe(0);
        expect(out.text).toBe(
            `tags.json is already as it was at ${head.slice(0, 7)}\n`,
        );
    });

    it("refuses a revision without the file, or a path outside", async () => {
        write("tags.json", vocabulary(1));
        await sweep();
        expect(await runRestore(SIDECAR, "HEAD", options())).toBe(1);
        expect(err.text).toEndWith(`dorothy: no ${SIDECAR} at HEAD\n`);
        err = capture();
        expect(await runRestore("/etc/passwd", null, options())).toBe(1);
        expect(err.text).toEndWith(
            `dorothy: /etc/passwd is not in ${data()}\n`,
        );
    });
});

describe("runRollback", () => {
    it("puts notes and tags back as they were, transcripts aside", async () => {
        write("tags.json", vocabulary(1));
        write(SIDECAR, sidecar("One"));
        write(TRANSCRIPT, event("one"));
        await sweep();
        const first = (await repo().log())[0]?.sha as string;
        write("tags.json", vocabulary(2));
        write(SIDECAR, sidecar("Two"));
        appendFileSync(data(TRANSCRIPT), event("two"));
        await sweep();
        expect(await runRollback(first, options())).toBe(0);
        expect(read("tags.json")).toBe(vocabulary(1));
        expect(read(SIDECAR)).toBe(sidecar("One"));
        expect(read(TRANSCRIPT)).toBe(event("one") + event("two"));
        expect(out.text).toBe(`Rolled back 2 files to ${first.slice(0, 7)}\n`);
        expect((await messages())[0]).toBe(
            `rollback: to ${first.slice(0, 7)} (user)`,
        );
    });

    it("says when there is nothing to roll back, or no such revision", async () => {
        write("tags.json", vocabulary(1));
        await sweep();
        expect(await runRollback("HEAD", options())).toBe(0);
        expect(out.text).toMatch(
            /^Nothing to roll back: notes and tags are as at [0-9a-f]{7}\n$/,
        );
        expect(await runRollback("nonsense", options())).toBe(1);
        expect(err.text).toEndWith("dorothy: no revision nonsense\n");
    });
});

describe("runCheck", () => {
    it("lints every file and changes nothing", async () => {
        write("tags.json", vocabulary(1));
        write(TRANSCRIPT, event("one"));
        await sweep();
        expect(await runCheck(options())).toBe(0);
        expect(out.text).toBe("All 3 files pass.\n");
        write("tags.json", "{");
        writeFileSync(data(TRANSCRIPT), "");
        out = capture();
        expect(await runCheck(options())).toBe(1);
        expect(out.text).toContain(
            `${TRANSCRIPT}: it changed before its end, and a transcript only grows\n`,
        );
        expect(out.text).toMatch(/^tags\.json: /m);
        expect(read("tags.json")).toBe("{");
    });

    it("lints a directory with no history yet", async () => {
        write("tags.json", "{");
        write(SIDECAR, sidecar("One"));
        expect(await runCheck(options())).toBe(1);
        expect(out.text).toMatch(/^tags\.json: .+\n1 of 2 files broken\.\n$/);
        expect(existsSync(data(".git"))).toBe(false);
    });

    it("lints what is staged, for the pre-commit hook", async () => {
        write("tags.json", vocabulary(1));
        await sweep();
        write("tags.json", "{");
        Bun.spawnSync(["git", "add", "tags.json"], {
            cwd: data(),
            env: TEST_ENV,
        });
        expect(
            await runCheck({ ...options(), staged: true, root: data() }),
        ).toBe(1);
        expect(out.text).toMatch(/^tags\.json: /);
        write("tags.json", vocabulary(2));
        Bun.spawnSync(["git", "add", "tags.json"], {
            cwd: data(),
            env: TEST_ENV,
        });
        out = capture();
        expect(
            await runCheck({ ...options(), staged: true, root: data() }),
        ).toBe(0);
    });
});

describe("runMirror", () => {
    it("says when there is no mirror yet", async () => {
        expect(await runMirror(null, options())).toBe(0);
        expect(out.text).toBe(
            "No mirror yet; set one with dorothy --mirror <url-or-path>\n",
        );
    });

    it("sets a mirror, makes a key when there is none, and pushes", async () => {
        write("tags.json", vocabulary(1));
        const bare = await bareRepo();
        const saved: [string, string][] = [];
        const setSecret = async (name: string, value: string) => {
            saved.push([name, value]);
        };
        expect(await runMirror(bare, { ...options(), setSecret })).toBe(0);
        expect(saved.map(([name]) => name)).toEqual(["DOROTHY_MIRROR_KEY"]);
        expect(out.text).toContain("Made DOROTHY_MIRROR_KEY");
        expect(out.text).toContain(`Pushed to ${bare}\n`);
        expect(out.text).not.toContain("stored at");
        out = capture();
        expect(
            await runMirror(null, {
                ...options(),
                env: { ...env, DOROTHY_MIRROR_KEY: saved[0]?.[1] ?? "" },
            }),
        ).toBe(0);
        expect(out.text).toMatch(
            new RegExp(
                `^Mirror: ${bare}\\nSealed through: [0-9a-f]{7}\\nWaiting: no\\n$`,
            ),
        );
    });

    it("resolves a relative or home mirror from the cwd, not the data directory", async () => {
        write("tags.json", vocabulary(1));
        const elsewhere = tempRoot();
        const bare = await bareRepo();
        const wanted = join(elsewhere, "backup.git");
        Bun.spawnSync(["git", "clone", "--bare", "-q", bare, wanted], {
            env: TEST_ENV,
        });
        const keyed = {
            ...options(),
            env: { ...env, DOROTHY_MIRROR_KEY: newKey() },
            cwd: elsewhere,
        };
        expect(await runMirror("./backup.git", keyed)).toBe(0);
        expect(await repo().remote("mirror")).toBe(wanted);
        expect(out.text).toContain(`Pushed to ${wanted}\n`);
        expect(existsSync(data("backup.git"))).toBe(false);
        expect(await runMirror("~/home.git", keyed)).toBe(1);
        expect(await repo().remote("mirror")).toBe(join(home, "home.git"));
    });

    it("reads . and a bare name as paths from the cwd, never the data directory", async () => {
        write("tags.json", vocabulary(1));
        const elsewhere = tempRoot();
        const keyed = {
            ...options(),
            env: { ...env, DOROTHY_MIRROR_KEY: newKey() },
            cwd: elsewhere,
        };
        // The cwd is no repository, so the push fails; it is not made into
        // the data repository, which would succeed.
        expect(await runMirror(".", keyed)).toBe(1);
        expect(await repo().remote("mirror")).toBe(elsewhere);
        expect(out.text).not.toContain("stored at");
        expect(out.text).not.toContain("Pushed");
        await runMirror("backup.git", keyed);
        expect(await repo().remote("mirror")).toBe(
            join(elsewhere, "backup.git"),
        );
        expect(existsSync(data("backup.git"))).toBe(false);
    });

    it("refuses a url that git would read as an option", async () => {
        expect(await runMirror("-x", options())).toBe(1);
        expect(err.text).toBe("dorothy: -x is not a url or path\n");
        expect(existsSync(data(".git"))).toBe(false);
        err = capture();
        expect(
            await runRecover("--upload-pack=x", {
                ...options(),
                err,
                env: { ...env, DOROTHY_MIRROR_KEY: newKey() },
            }),
        ).toBe(1);
        expect(err.text).toBe(
            "dorothy: --upload-pack=x is not a url or path\n",
        );
    });

    it("never replaces a key that is set but malformed", async () => {
        const bare = await bareRepo();
        let saved = 0;
        const code = await runMirror(bare, {
            ...options(),
            env: { ...env, DOROTHY_MIRROR_KEY: "short" },
            setSecret: async () => {
                saved += 1;
            },
        });
        expect(code).toBe(1);
        expect(saved).toBe(0);
        expect(err.text).toBe(
            "dorothy: DOROTHY_MIRROR_KEY is set but is not 32 bytes of base64; it is left as it is, and no mirror is set\n",
        );
        expect(await repo().remote("mirror")).toBeNull();
    });

    it("knows a local mirror from a hosted one", () => {
        expect(isLocal("/mnt/backup/memory.git")).toBe(true);
        expect(isLocal("./memory.git")).toBe(true);
        expect(isLocal("~/memory.git")).toBe(true);
        expect(isLocal("file:///mnt/memory.git")).toBe(true);
        expect(isLocal(".")).toBe(true);
        expect(isLocal("..")).toBe(true);
        expect(isLocal("backup.git")).toBe(true);
        expect(isLocal("https://example.com/memory.git")).toBe(false);
        expect(isLocal("git@example.com:me/memory.git")).toBe(false);
    });
});

describe("runRecover", () => {
    it("rebuilds an empty data directory from a mirror", async () => {
        write("tags.json", vocabulary(1));
        write(TRANSCRIPT, event("one"));
        const key = newKey();
        const bare = await bareRepo();
        const keyed = {
            ...options(),
            env: { ...env, DOROTHY_MIRROR_KEY: key },
        };
        expect(await runMirror(bare, keyed)).toBe(0);
        const original = read("tags.json");
        const other = tempRoot();
        const fresh = {
            ...keyed,
            out: capture(),
            env: { ...keyed.env, XDG_DATA_HOME: other, HOME: other },
        };
        expect(await runRecover(bare, fresh)).toBe(0);
        expect(readFileSync(join(other, "dorothy", "tags.json"), "utf8")).toBe(
            original,
        );
        expect(fresh.out.text).toMatch(
            /^Recovered 1 of 1 bundles; main is at [0-9a-f]{7}\nAll 3 files pass\.\n$/,
        );
    });

    it("refuses a data directory that holds anything, or no key", async () => {
        write("tags.json", vocabulary(1));
        expect(
            await runRecover("/nowhere.git", {
                ...options(),
                env: { ...env, DOROTHY_MIRROR_KEY: newKey() },
            }),
        ).toBe(1);
        expect(err.text).toBe(
            `dorothy: ${data()} is not empty; --recover only fills an empty data directory\n`,
        );
        const other = tempRoot();
        err = capture();
        expect(
            await runRecover("/nowhere.git", {
                ...options(),
                err,
                env: { ...env, XDG_DATA_HOME: other },
            }),
        ).toBe(1);
        expect(err.text).toBe(
            "dorothy: --recover needs DOROTHY_MIRROR_KEY, the key the mirror was sealed with\n",
        );
        expect(existsSync(join(other, "dorothy"))).toBe(false);
    });

    it("leaves nothing behind when the mirror can't be read, so a retry is allowed", async () => {
        const other = tempRoot();
        const fresh = {
            ...options(),
            env: {
                ...env,
                XDG_DATA_HOME: other,
                HOME: other,
                DOROTHY_MIRROR_KEY: newKey(),
            },
        };
        const missing = join(other, "no-such-mirror.git");
        expect(await runRecover(missing, fresh)).toBe(1);
        const root = join(other, "dorothy");
        expect(existsSync(root) ? readdirSync(root) : []).toEqual([]);
        err = capture();
        expect(await runRecover(missing, { ...fresh, err })).toBe(1);
        expect(err.text).not.toContain("is not empty");
    });
});
