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
import { join } from "node:path";
import { writeAtomic } from "./files.js";

describe("writeAtomic", () => {
    let root: string;
    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), "eval-files-"));
    });
    afterEach(() => {
        rmSync(root, { recursive: true, force: true });
    });

    it("writes over the temporary file an interrupted write left", async () => {
        const path = join(root, "run.json");
        writeFileSync(`${path}.tmp`, "torn", { mode: 0o600 });
        await writeAtomic(path, "whole");
        expect(readFileSync(path, "utf8")).toBe("whole");
        expect(readdirSync(root)).toEqual(["run.json"]);
        expect(statSync(path).mode & 0o777).toBe(0o600);
    });

    it("leaves no temporary file when the write fails", async () => {
        const path = join(root, "gone", "run.json");
        await expect(writeAtomic(path, "x")).rejects.toThrow();
        mkdirSync(join(root, "dir"));
        await expect(writeAtomic(join(root, "dir"), "x")).rejects.toThrow();
        expect(readdirSync(root)).toEqual(["dir"]);
    });
});
