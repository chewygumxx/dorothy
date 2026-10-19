// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/state.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beside, stateDir, writePrivate } from "./state.js";

let home = "";
beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dorothy-state-"));
});
afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe("the state directory", () => {
    it("is dorothy's under $XDG_STATE_HOME, else under HOME", () => {
        expect(stateDir({ XDG_STATE_HOME: "/s", HOME: "/h" })).toBe(
            "/s/dorothy",
        );
        expect(stateDir({ HOME: "/h" })).toBe("/h/.local/state/dorothy");
    });

    it("names a temporary file apart for every call", () => {
        const names = new Set(
            Array.from({ length: 50 }, () => beside("/x/file", "tmp")),
        );
        expect(names.size).toBe(50);
        for (const name of names) {
            expect(name.startsWith(`/x/file.${process.pid}.`)).toBe(true);
        }
    });

    it("writes one path from many writers at once, whole and private", async () => {
        const path = join(home, "note.json");
        const texts = Array.from({ length: 20 }, (_, n) => `writer ${n}\n`);
        await Promise.all(texts.map((text) => writePrivate(path, text)));
        expect(texts).toContain(await readFile(path, "utf8"));
        expect((await stat(path)).mode & 0o777).toBe(0o600);
        expect(await readdir(home)).toEqual(["note.json"]);
    });
});
