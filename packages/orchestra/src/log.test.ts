// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/log.test.ts
//
//

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logPath, openLog } from "./log.js";

describe("the server's log", () => {
    let root = "";

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("lies under the state root, named by the server", () => {
        expect(logPath({ XDG_STATE_HOME: "/s", HOME: "/h" }, "s1")).toBe(
            "/s/dorothy/orchestra/s1.jsonl",
        );
        expect(logPath({ HOME: "/h" }, "s1")).toBe(
            "/h/.local/state/dorothy/orchestra/s1.jsonl",
        );
    });

    it("appends one JSON object per line, its own alone", async () => {
        root = await mkdtemp(join(tmpdir(), "orchestra-log-"));
        const path = join(root, "dorothy", "orchestra", "s1.jsonl");
        const log = openLog(path);
        log({ event: "operation", detail: "two\nlines" });
        log({ event: "decision", source: "rule" });
        const lines = (await readFile(path, "utf8")).split("\n");
        expect(lines).toHaveLength(3);
        expect(lines.slice(0, 2).map((line) => JSON.parse(line))).toEqual([
            { event: "operation", detail: "two\nlines" },
            { event: "decision", source: "rule" },
        ]);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
    });
});
