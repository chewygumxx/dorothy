// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/files.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { writeAtomic } from "./files.js";

describe("writeAtomic", () => {
    let root: string;
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), "eval-files-"));
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it("removes the temporary file a dead process left", async () => {
        const path = join(root, "run.json");
        const dead = Bun.spawnSync(["true"]).pid;
        const stray = `${path}.${dead}.1.tmp`;
        const live = `${path}.${process.pid}.999999.tmp`;
        const other = join(root, `other.json.${dead}.1.tmp`);
        for (const each of [stray, live, other]) {
            writeFileSync(each, "torn", { mode: 0o600 });
        }
        await writeAtomic(path, "whole");
        expect(readFileSync(path, "utf8")).toBe("whole");
        expect(readdirSync(root).sort()).toEqual(
            [basename(live), basename(other), "run.json"].sort(),
        );
        expect(statSync(path).mode & 0o777).toBe(0o600);
    });

    it("lets writers of one path go together, leaving no file", async () => {
        const path = join(root, "summary.json");
        await Promise.all(
            ["a", "b", "c", "d"].map((text) => writeAtomic(path, text)),
        );
        expect(["a", "b", "c", "d"]).toContain(readFileSync(path, "utf8"));
        expect(readdirSync(root)).toEqual(["summary.json"]);
    });

    it("leaves no temporary file when the write fails", async () => {
        const path = join(root, "gone", "run.json");
        await expect(writeAtomic(path, "x")).rejects.toThrow();
        mkdirSync(join(root, "dir"));
        await expect(writeAtomic(join(root, "dir"), "x")).rejects.toThrow();
        expect(readdirSync(root)).toEqual(["dir"]);
    });
});
