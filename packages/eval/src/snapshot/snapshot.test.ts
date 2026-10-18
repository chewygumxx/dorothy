// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/snapshot/snapshot.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { UsageError } from "../errors.js";
import { tempRoot, writeFixtureData } from "../testing.js";
import {
    readSnapshot,
    snapshotDir,
    takeSnapshot,
    workEnv,
} from "./snapshot.js";

let temp: ReturnType<typeof tempRoot>;
let data: string;
let work: string;

beforeEach(async () => {
    temp = tempRoot("snapshot");
    data = await writeFixtureData(temp.root);
    work = join(temp.root, "work");
});
afterEach(() => temp.remove());

// Every file under dir with its contents, to see that nothing changed.
const tree = (dir: string) =>
    (readdirSync(dir, { recursive: true }) as string[]).sort().map((name) => {
        const path = join(dir, name);
        return statSync(path).isFile()
            ? `${name}:${readFileSync(path, "utf8")}`
            : name;
    });

describe("a snapshot", () => {
    it("copies transcripts, knowledge and tags, never .git", async () => {
        mkdirSync(join(data, ".git"));
        writeFileSync(join(data, ".git", "HEAD"), "ref\n");
        writeFileSync(join(data, "tags.json"), "{}\n");
        const info = await takeSnapshot(data, work, {
            now: () => new Date("2026-10-19T00:00:00.000Z"),
        });
        expect(info).toEqual({
            source: data,
            at: "2026-10-19T00:00:00.000Z",
            conversations: 4,
            knowledge: 3,
        });
        const copy = snapshotDir(work);
        expect(existsSync(join(copy, "transcripts"))).toBe(true);
        expect(existsSync(join(copy, "knowledge"))).toBe(true);
        expect(existsSync(join(copy, "tags.json"))).toBe(true);
        expect(existsSync(join(copy, ".git"))).toBe(false);
        expect(await readSnapshot(work)).toEqual(info);
    });

    it("leaves the data directory as it was", async () => {
        const before = tree(data);
        await takeSnapshot(data, work);
        expect(tree(data)).toEqual(before);
    });

    it("refuses a second snapshot unless told to replace it", async () => {
        await takeSnapshot(data, work);
        await expect(takeSnapshot(data, work)).rejects.toThrow(
            "holds a snapshot already: give --replace",
        );
        const transcripts = join(data, "transcripts");
        const gone = readdirSync(transcripts).find((name) =>
            name.endsWith(".jsonl"),
        ) as string;
        rmSync(join(transcripts, gone));
        const info = await takeSnapshot(data, work, { replace: true });
        expect(info.conversations).toBe(3);
        expect(existsSync(join(snapshotDir(work), "transcripts", gone))).toBe(
            false,
        );
    });

    it("refuses a directory with no transcripts", async () => {
        const empty = join(temp.root, "empty");
        mkdirSync(empty);
        await expect(takeSnapshot(empty, work)).rejects.toThrow(
            "has no transcripts/",
        );
    });

    it("refuses a work directory inside the data directory, or around it", async () => {
        await expect(takeSnapshot(data, join(data, "eval"))).rejects.toThrow(
            UsageError,
        );
        await expect(takeSnapshot(data, temp.root)).rejects.toThrow(
            "must not contain each other",
        );
        expect(existsSync(join(data, "eval"))).toBe(false);
    });

    it("says what to run when there is none", async () => {
        await expect(readSnapshot(work)).rejects.toThrow(
            "holds no snapshot: run `bun run eval -- snapshot",
        );
    });

    it("points every root into the work directory", () => {
        const env = workEnv(work);
        for (const name of [
            "HOME",
            "XDG_DATA_HOME",
            "XDG_CACHE_HOME",
            "XDG_STATE_HOME",
            "XDG_CONFIG_HOME",
        ]) {
            expect(env[name]?.startsWith(`${work}/`)).toBe(true);
        }
    });
});
