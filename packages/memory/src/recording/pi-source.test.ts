// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/memory/src/recording/pi-source.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    realpath,
    rm,
    stat,
    symlink,
    truncate,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Env } from "@dorothy/core";
import { piSessionRoot } from "../hosts/pi-root.js";
import { eventId } from "./pi.js";
import {
    assistant,
    entry,
    forkLines,
    header,
    PARENT_LINES,
    PI_FORK,
    PI_SESSION,
    piText,
    text,
    user,
} from "./pi-fixtures.js";
import { PI_MAX_BYTES, piSource, readPiSession } from "./pi-source.js";
import { segmentId } from "./pi-tree.js";
import type { SourceRead, SourceSession } from "./sources.js";
import { piSidecarPath } from "./state.js";

let home = "";
let env: Env;
let root = "";
let dir = "";
beforeEach(async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), "dorothy-pi-source-")));
    env = {
        HOME: home,
        XDG_DATA_HOME: join(home, "data"),
        XDG_STATE_HOME: join(home, "state"),
    };
    root = piSessionRoot(env);
    dir = join(root, "digest", "--fixture-project--");
    await mkdir(dir, { recursive: true });
});
afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

const write = async (path: string, lines: readonly string[]) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, piText(lines));
    return path;
};
const listed = async () => await piSource(env).list();
const pick = async (path: string): Promise<SourceSession> => {
    const found = (await listed()).find((session) => session.path === path);
    if (!found) throw new Error(`not listed: ${path}`);
    return found;
};
type PiFile = Extract<SourceRead, { kind: "pi" }>;
const readOf = async (path: string, ended = false): Promise<PiFile> => {
    const read = await (await pick(path)).read(undefined, { ended });
    if (read?.kind !== "pi") throw new Error("no Pi read");
    return read;
};
const sourceIds = (read: PiFile) =>
    read.read.segments.flatMap((segment) =>
        segment.events.map((event) => event.sourceId),
    );
const sidecars = async () =>
    await readdir(join(home, "state/dorothy/pi/recording")).catch(() => []);
const ROOT_SEGMENT = segmentId(PI_SESSION, "user0001");
const forkSpeech = [
    eventId(PI_FORK, "user0002", "user", 0),
    eventId(PI_FORK, "asst0002", "assistant", 0),
];

describe("piSessionRoot", () => {
    it("is Dorothy's own Pi sessions, from the injected XDG roots", () => {
        expect(piSessionRoot(env)).toBe(join(home, "data/dorothy/pi/sessions"));
        expect(piSessionRoot({ HOME: home })).toBe(
            join(home, ".local/share/dorothy/pi/sessions"),
        );
        expect(piSessionRoot({ HOME: home, XDG_DATA_HOME: "relative" })).toBe(
            join(home, ".local/share/dorothy/pi/sessions"),
        );
    });
});

describe("piSource", () => {
    it("lists regular .jsonl files below its root alone, no symlink", async () => {
        const outside = join(home, "outside");
        await write(join(outside, "elsewhere.jsonl"), PARENT_LINES);
        const kept = await write(join(dir, "a.jsonl"), PARENT_LINES);
        await writeFile(join(dir, "notes.txt"), "not a session\n");
        await symlink(
            join(outside, "elsewhere.jsonl"),
            join(dir, "linked.jsonl"),
        );
        await symlink(outside, join(root, "linked-dir"));
        await write(join(home, "data/dorothy/pi/stray.jsonl"), PARENT_LINES);
        const found = await listed();
        expect(found.map((session) => session.path)).toEqual([kept]);
        expect(found[0]).toMatchObject({
            host: "pi",
            key: JSON.stringify(["pi", kept]),
        });
    });

    it("lists nothing when the root is absent", async () => {
        await rm(root, { recursive: true });
        expect(await listed()).toEqual([]);
    });

    it("reads segments, and nothing for an unchanged file", async () => {
        const path = await write(join(dir, "a.jsonl"), PARENT_LINES);
        const read = await readOf(path);
        expect(read.orphan).toBe(false);
        expect(read.stable).toBe(true);
        expect(read.lines).toHaveLength(3);
        expect(read.read.segments).toMatchObject([
            { session: ROOT_SEGMENT, parent: null, anchor: null },
        ]);
        expect(sourceIds(read)).toEqual([
            eventId(PI_SESSION, "user0001", "user", 0),
            eventId(PI_SESSION, "asst0001", "assistant", 0),
        ]);
        const session = await pick(path);
        expect(await session.read(read.fingerprint)).toBeNull();
    });

    it("resolves a parent listed after its fork, copying no speech", async () => {
        const parent = join(dir, "b-parent.jsonl");
        const child = await write(
            join(dir, "a-child.jsonl"),
            forkLines(parent),
        );
        await write(parent, PARENT_LINES);
        expect((await listed()).map((session) => session.path)).toEqual([
            child,
            parent,
        ]);
        const read = await readOf(child);
        expect(read.orphan).toBe(false);
        expect(read.read.pending).toBe(false);
        expect(sourceIds(read)).toEqual(forkSpeech);
        expect(read.read.segments[0]?.parent).toBe(ROOT_SEGMENT);
    });

    it("resolves a grandparent in order, through each named file", async () => {
        const first = await write(join(dir, "c.jsonl"), PARENT_LINES);
        const second = await write(join(dir, "b.jsonl"), forkLines(first));
        const third = "88888888-9999-4aaa-8bbb-cccccccccccc";
        const grandchild = await write(join(dir, "a.jsonl"), [
            header(third, second),
            ...forkLines(first).slice(1),
            user("user0003", "asst0002", "Synthetic third question.", 5),
        ]);
        const read = await readOf(grandchild);
        expect(sourceIds(read)).toEqual([
            eventId(third, "user0003", "user", 0),
        ]);
        expect(read.read.segments[0]?.parent).toBe(
            segmentId(PI_FORK, "user0002"),
        );
    });

    describe("holds a fork it cannot resolve, guessing nothing", () => {
        const held = (read: PiFile) => {
            expect(read.orphan).toBe(true);
            expect(read.read.pending).toBe(true);
            expect(read.read.segments).toEqual([]);
            expect(read.read.halt).toBeNull();
        };

        it("never reads a parent outside its root", async () => {
            const outside = await write(
                join(home, "outside", "parent.jsonl"),
                PARENT_LINES,
            );
            await symlink(join(home, "outside"), join(root, "linked-dir"));
            const named = [
                outside,
                join(root, "..", "..", "..", "..", "outside", "parent.jsonl"),
                join(root, "linked-dir", "parent.jsonl"),
                "outside/parent.jsonl",
            ];
            for (const [at, parent] of named.entries()) {
                const child = await write(
                    join(dir, `child-${at}.jsonl`),
                    forkLines(parent),
                );
                held(await readOf(child));
            }
            // A parent read leaves its sidecar; none was read.
            const outsideRootReads = (await sidecars()).length;
            expect(outsideRootReads).toBe(0);
        });

        it("never follows a symlinked parent file", async () => {
            const real = await write(join(dir, "real.jsonl"), PARENT_LINES);
            await symlink(real, join(dir, "parent.jsonl"));
            const child = await write(
                join(dir, "child.jsonl"),
                forkLines(join(dir, "parent.jsonl")),
            );
            held(await readOf(child));
        });

        it("holds a fork of a missing, halted or torn parent, or a cycle", async () => {
            const missing = await write(
                join(dir, "missing-child.jsonl"),
                forkLines(join(dir, "gone.jsonl")),
            );
            held(await readOf(missing));
            const halted = await write(join(dir, "halted.jsonl"), [
                ...PARENT_LINES,
                entry("message", "bad00001", "asst0001", { message: {} }),
            ]);
            held(
                await readOf(
                    await write(join(dir, "c1.jsonl"), forkLines(halted)),
                ),
            );
            const torn = join(dir, "torn.jsonl");
            await writeFile(torn, `${piText(PARENT_LINES)}{"type":"mess`);
            held(
                await readOf(
                    await write(join(dir, "c2.jsonl"), forkLines(torn)),
                ),
            );
            const a = join(dir, "cycle-a.jsonl");
            const b = join(dir, "cycle-b.jsonl");
            await write(a, forkLines(b));
            await write(
                b,
                forkLines(a, "99999999-aaaa-4bbb-8ccc-dddddddddddd"),
            );
            held(await readOf(a));
            held(await readOf(b));
        });
    });

    it("keeps a private sidecar of owners, never speech, rebuilt if lost", async () => {
        const path = await write(join(dir, "a.jsonl"), PARENT_LINES);
        const first = await readOf(path);
        const sidecar = piSidecarPath(env, path);
        expect(
            sidecar.startsWith(join(home, "state/dorothy/pi/recording/")),
        ).toBe(true);
        expect((await stat(sidecar)).mode & 0o777).toBe(0o600);
        expect((await stat(dirname(sidecar))).mode & 0o777).toBe(0o700);
        const kept = await readFile(sidecar, "utf8");
        expect(kept).not.toContain("Synthetic parent");
        expect(JSON.parse(kept)).toMatchObject({
            v: 1,
            path,
            complete: true,
            ancestry: {
                nativeSession: PI_SESSION,
                entries: { user0001: { owner: ROOT_SEGMENT } },
            },
            segments: [{ session: ROOT_SEGMENT, parent: null, anchor: null }],
        });
        await rm(join(home, "state"), { recursive: true });
        const again = await readOf(path);
        expect(again.read).toEqual(first.read);
        expect(await readFile(sidecar, "utf8")).toBe(kept);
    });

    it("rebuilds a parent's ancestry when its file changed since its sidecar", async () => {
        const parent = await write(join(dir, "b-parent.jsonl"), PARENT_LINES);
        await readOf(parent);
        // The parent grows after its sidecar was kept, then is forked.
        const grown = [
            ...PARENT_LINES,
            user("user0002", "asst0001", "Synthetic later question.", 3),
            assistant("asst0002", "user0002", [text("Synthetic later.")], 4),
        ];
        await write(parent, grown);
        const child = await write(join(dir, "a-child.jsonl"), [
            header(PI_FORK, parent),
            ...grown.slice(1),
            user("user0003", "asst0002", "Synthetic fork question.", 5),
        ]);
        expect(sourceIds(await readOf(child))).toEqual([
            eventId(PI_FORK, "user0003", "user", 0),
        ]);
    });

    it("refuses a rewrite that would move an entry to another segment", async () => {
        const start = [
            header(),
            user("user0001", null, "Synthetic question.", 1),
            assistant("asst0001", "user0001", [text("Synthetic one.")], 2),
            assistant("asst0002", "user0001", [text("Synthetic two.")], 3),
        ];
        const path = await write(join(dir, "a.jsonl"), start);
        await readOf(path);
        const kept = await readFile(piSidecarPath(env, path), "utf8");
        // The same entries in another order: the second reply would now
        // continue the first segment, and the first open another.
        await write(path, [start[0], start[1], start[3], start[2]] as string[]);
        const read = await readOf(path);
        expect(read.read.halt).toEqual({ line: 2, code: "ownership" });
        expect(read.read.segments).toEqual([]);
        expect(await readFile(piSidecarPath(env, path), "utf8")).toBe(kept);
    });

    it("refuses a file past its 64 MiB cap", async () => {
        const path = await write(join(dir, "a.jsonl"), PARENT_LINES);
        await truncate(path, PI_MAX_BYTES + 1);
        const session = await pick(path);
        await expect(session.read()).rejects.toThrow("too large");
    });
});

describe("readPiSession", () => {
    it("reads a session file named inside the root", async () => {
        const path = await write(join(dir, "a.jsonl"), PARENT_LINES);
        const found = await readPiSession(env, path, { ended: false });
        expect(found.kind).toBe("read");
        if (found.kind === "read")
            expect(found.file.read.nativeSession).toBe(PI_SESSION);
    });

    it("is missing where Pi has written no file yet", async () => {
        expect(
            await readPiSession(env, join(dir, "new.jsonl"), { ended: false }),
        ).toEqual({ kind: "missing" });
    });

    it("refuses a path outside the root, escaping it or a symlink", async () => {
        const outside = await write(
            join(home, "outside", "a.jsonl"),
            PARENT_LINES,
        );
        await symlink(outside, join(dir, "linked.jsonl"));
        await symlink(join(home, "outside"), join(root, "linked-dir"));
        for (const path of [
            outside,
            join(root, "..", "..", "..", "..", "outside", "a.jsonl"),
            join(dir, "linked.jsonl"),
            join(root, "linked-dir", "a.jsonl"),
            "a.jsonl",
            join(dir, "a.txt"),
        ])
            expect(await readPiSession(env, path, { ended: false })).toEqual({
                kind: "outside",
            });
        expect(await sidecars()).toEqual([]);
    });
});
