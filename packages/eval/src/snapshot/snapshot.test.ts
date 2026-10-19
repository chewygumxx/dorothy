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
    chmodSync,
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    realpathSync,
    renameSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { getuid } from "node:process";
import { UsageError } from "../errors.js";
import { tempRoot, writeFixtureData } from "../testing.js";
import {
    checkoutRoot,
    checkoutRoots,
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
            skippedLinks: 0,
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

    it("refuses a work directory in the repository, by its real path", async () => {
        const repository = resolve(import.meta.dir, "../../../..");
        const inside = join(import.meta.dir, `eval-work-${process.pid}`);
        const link = join(temp.root, "link");
        symlinkSync(import.meta.dir, link);
        try {
            for (const target of [
                inside,
                join(link, `eval-work-${process.pid}`),
                repository,
            ]) {
                await expect(takeSnapshot(data, target)).rejects.toThrow(
                    new UsageError(
                        `${resolve(target)} is in the repository: choose a work directory outside it`,
                    ),
                );
            }
            expect(existsSync(inside)).toBe(false);
            expect(existsSync(join(repository, "snapshot.json"))).toBe(false);
        } finally {
            rmSync(inside, { recursive: true, force: true });
        }
    });

    it("finds the checkout by the package's place, not by a .git above", async () => {
        const outer = join(temp.root, "outer");
        const here = join(
            outer,
            "checkout",
            "packages",
            "eval",
            "src",
            "snapshot",
        );
        mkdirSync(here, { recursive: true });
        mkdirSync(join(outer, ".git"));
        expect(await checkoutRoot(here)).toBe(join(outer, "checkout"));
        // And for the real checkout, the same by position.
        expect(await checkoutRoot()).toBe(
            realpathSync(resolve(import.meta.dir, "../../../..")),
        );
    });

    it("knows the other worktrees of the checkout's repository", async () => {
        const nested = (root: string) =>
            join(root, "packages", "eval", "src", "snapshot");
        const main = join(temp.root, "main");
        const other = join(temp.root, "other");
        const linked = join(temp.root, "linked");
        const alone = join(temp.root, "alone");
        for (const root of [main, other, linked, alone]) {
            mkdirSync(nested(root), { recursive: true });
        }
        // A main checkout lists its worktrees under .git/worktrees.
        for (const [name, where] of [
            ["other", other],
            ["linked", linked],
        ] as const) {
            mkdirSync(join(main, ".git", "worktrees", name), {
                recursive: true,
            });
            writeFileSync(
                join(main, ".git", "worktrees", name, "gitdir"),
                `${join(where, ".git")}\n`,
            );
        }
        writeFileSync(
            join(linked, ".git"),
            `gitdir: ${join(main, ".git", "worktrees", "linked")}\n`,
        );
        // A gitdir may be relative to the file that holds it (git's
        // relative worktrees), and an entry that cannot be read costs only
        // itself.
        const kin = join(temp.root, "kin");
        mkdirSync(nested(kin), { recursive: true });
        mkdirSync(join(main, ".git", "worktrees", "kin"));
        writeFileSync(
            join(main, ".git", "worktrees", "kin", "gitdir"),
            "../../../../kin/.git\n",
        );
        mkdirSync(join(main, ".git", "worktrees", "a-stale"));
        mkdirSync(join(main, ".git", "worktrees", "a-unreadable", "gitdir"), {
            recursive: true,
        });
        writeFileSync(
            join(linked, ".git"),
            "gitdir: ../main/.git/worktrees/linked\n",
        );
        const all = [kin, linked, main, other].sort();
        expect((await checkoutRoots(nested(main))).sort()).toEqual(all);
        // A worktree knows the main checkout and its siblings.
        expect((await checkoutRoots(nested(linked))).sort()).toEqual(all);
        // So a work directory in any of them is refused.
        for (const root of [main, other, linked, kin]) {
            await expect(
                takeSnapshot(data, join(root, "eval"), {
                    checkout: nested(main),
                }),
            ).rejects.toThrow("is in the repository");
        }
        const taken = await takeSnapshot(data, join(temp.root, "elsewhere"), {
            checkout: nested(main),
        });
        expect(taken.conversations).toBe(4);
        // A checkout with no git layout is itself alone.
        expect(await checkoutRoots(nested(alone))).toEqual([alone]);
    });

    it("refuses a work directory reached through a link into the data", async () => {
        const link = join(temp.root, "into-data");
        symlinkSync(data, link);
        await expect(takeSnapshot(data, join(link, "eval"))).rejects.toThrow(
            "must not contain each other",
        );
        const around = join(temp.root, "around");
        symlinkSync(temp.root, around);
        await expect(
            takeSnapshot(join(around, "source", "data", "dorothy"), temp.root),
        ).rejects.toThrow("must not contain each other");
        expect(existsSync(join(data, "eval"))).toBe(false);
    });

    it("copies facts/ where the data has not moved them", async () => {
        mkdirSync(join(data, "facts"));
        writeFileSync(join(data, "facts", "old.md"), "# old\n");
        const info = await takeSnapshot(data, work);
        expect(info.knowledge).toBe(4);
        expect(
            readFileSync(join(snapshotDir(work), "facts", "old.md"), "utf8"),
        ).toBe("# old\n");
    });

    it("keeps the copy private, at each level it makes", async () => {
        await takeSnapshot(data, join(work, "deeper"));
        for (const dir of [
            join(work, "deeper", "data"),
            join(work, "deeper", "data", "dorothy"),
        ]) {
            expect(statSync(dir).mode & 0o777).toBe(0o700);
        }
        expect(
            statSync(join(work, "deeper", "snapshot.json")).mode & 0o777,
        ).toBe(0o600);
    });

    it("counts, and neither follows nor keeps, a link below the top", async () => {
        const outside = join(temp.root, "outside");
        mkdirSync(outside);
        writeFileSync(join(outside, "secret.md"), "outside\n");
        symlinkSync(outside, join(data, "knowledge", "away"));
        symlinkSync(
            join(outside, "secret.md"),
            join(data, "knowledge", "secret.md"),
        );
        const info = await takeSnapshot(data, work);
        expect(info.knowledge).toBe(3);
        expect(info.skippedLinks).toBe(2);
        expect((await readSnapshot(work)).skippedLinks).toBe(2);
        const found = readdirSync(snapshotDir(work), { recursive: true });
        expect(found.some((name) => String(name).includes("secret"))).toBe(
            false,
        );
        expect(found).not.toContain(join("knowledge", "away"));
    });

    it("follows a link at the top, and copies what it leads to", async () => {
        const kept = join(temp.root, "stowed");
        mkdirSync(kept);
        for (const name of ["knowledge", "transcripts", "tags.json"]) {
            if (name === "tags.json") {
                writeFileSync(join(kept, name), "{}\n");
            } else {
                renameSync(join(data, name), join(kept, name));
            }
            symlinkSync(join(kept, name), join(data, name));
        }
        const info = await takeSnapshot(data, work);
        expect(info).toMatchObject({
            conversations: 4,
            knowledge: 3,
            skippedLinks: 0,
        });
        const copy = snapshotDir(work);
        for (const name of ["knowledge", "transcripts", "tags.json"]) {
            expect(lstatSync(join(copy, name)).isSymbolicLink()).toBe(false);
        }
        expect(readFileSync(join(copy, "tags.json"), "utf8")).toBe("{}\n");
        expect(tree(join(copy, "knowledge"))).toEqual(
            tree(join(kept, "knowledge")),
        );
    });

    it("copies a followed entry that is itself named .git", async () => {
        const stowed = join(temp.root, "stow", ".git");
        mkdirSync(join(temp.root, "stow"));
        renameSync(join(data, "knowledge"), stowed);
        symlinkSync(stowed, join(data, "knowledge"));
        const info = await takeSnapshot(data, work);
        expect(info.knowledge).toBe(3);
        expect(readdirSync(join(snapshotDir(work), "knowledge")).length).toBe(
            readdirSync(stowed).length,
        );
    });

    it("names a top link that leads nowhere, or round in a loop", async () => {
        symlinkSync(join(temp.root, "gone"), join(data, "tags.json"));
        await expect(takeSnapshot(data, work)).rejects.toThrow(
            `${join(data, "tags.json")} is a link that leads nowhere (ENOENT)`,
        );
        rmSync(join(data, "tags.json"));
        symlinkSync(join(data, "facts"), join(data, "facts"));
        await expect(takeSnapshot(data, work)).rejects.toThrow(
            `${join(data, "facts")} is a link that leads nowhere (ELOOP)`,
        );
        rmSync(join(data, "facts"));
        const stowed = join(temp.root, "stowed");
        renameSync(join(data, "knowledge"), stowed);
        symlinkSync(stowed, join(data, "knowledge"));
        rmSync(stowed, { recursive: true });
        await expect(takeSnapshot(data, work)).rejects.toThrow(
            `${join(data, "knowledge")} is a link that leads nowhere (ENOENT)`,
        );
        expect(existsSync(join(work, "snapshot.json"))).toBe(false);
        expect(existsSync(`${snapshotDir(work)}.partial`)).toBe(false);
    });

    it("refuses a top link into the work directory, or around it", async () => {
        const inside = join(work, "stuff");
        mkdirSync(inside, { recursive: true });
        rmSync(join(data, "knowledge"), { recursive: true });
        symlinkSync(inside, join(data, "knowledge"));
        await expect(takeSnapshot(data, work)).rejects.toThrow(
            /knowledge leads to .*stuff.*must not contain each other/,
        );
        rmSync(join(data, "knowledge"));
        symlinkSync(temp.root, join(data, "knowledge"));
        await expect(takeSnapshot(data, work)).rejects.toThrow(
            /knowledge leads to .*must not contain each other/,
        );
        expect(existsSync(join(work, "snapshot.json"))).toBe(false);
    });

    it("restores the old copy a crash left aside, before replacing", async () => {
        await takeSnapshot(data, work);
        // A crash between the two renames of a swap.
        renameSync(snapshotDir(work), `${snapshotDir(work)}.old`);
        mkdirSync(`${snapshotDir(work)}.partial`);
        await expect(takeSnapshot(data, work)).rejects.toThrow(
            "holds a snapshot already",
        );
        expect(existsSync(join(snapshotDir(work), "transcripts"))).toBe(true);
        expect(existsSync(`${snapshotDir(work)}.old`)).toBe(false);
    });

    it("drops the old cache and files when replacing", async () => {
        await takeSnapshot(data, work);
        mkdirSync(join(work, "cache", "dorothy"), { recursive: true });
        writeFileSync(join(work, "cache", "dorothy", "recall.sqlite"), "old");
        writeFileSync(join(snapshotDir(work), "stale.txt"), "old");
        await takeSnapshot(data, work, { replace: true });
        expect(existsSync(join(work, "cache"))).toBe(false);
        expect(existsSync(join(snapshotDir(work), "stale.txt"))).toBe(false);
        expect(readdirSync(join(work, "data"))).toEqual(["dorothy"]);
    });

    it.skipIf(getuid?.() === 0)(
        "keeps the old snapshot when the new copy fails",
        async () => {
            await takeSnapshot(data, work);
            mkdirSync(join(work, "cache"));
            writeFileSync(join(work, "cache", "kept"), "kept");
            const before = tree(work);
            const transcripts = join(data, "transcripts");
            const unreadable = join(
                transcripts,
                readdirSync(transcripts).find((name) =>
                    name.endsWith(".jsonl"),
                ) as string,
            );
            chmodSync(unreadable, 0o000);
            try {
                await expect(
                    takeSnapshot(data, work, { replace: true }),
                ).rejects.toThrow();
            } finally {
                chmodSync(unreadable, 0o600);
            }
            expect(tree(work)).toEqual(before);
        },
    );

    it("says what to run when there is none", async () => {
        await expect(readSnapshot(work)).rejects.toThrow(
            "holds no snapshot: run `bun run eval -- snapshot",
        );
    });

    it("tells an unreadable or invalid record from a missing one", async () => {
        mkdirSync(work, { recursive: true });
        const path = join(work, "snapshot.json");
        mkdirSync(path);
        await expect(readSnapshot(work)).rejects.toThrow(
            `cannot read ${path}: EISDIR; mend it, or take the snapshot again with --replace`,
        );
        rmSync(path, { recursive: true });
        writeFileSync(path, '{"source": "x"');
        await expect(readSnapshot(work)).rejects.toThrow(
            `${path} is not JSON; take the snapshot again with --replace`,
        );
        writeFileSync(
            path,
            JSON.stringify({
                source: "x",
                at: "t",
                conversations: "4",
                knowledge: 1,
            }),
        );
        await expect(readSnapshot(work)).rejects.toThrow(
            `${path} is not a snapshot record (conversations: `,
        );
        writeFileSync(path, "null");
        await expect(readSnapshot(work)).rejects.toThrow(
            "is not a snapshot record",
        );
    });

    it("says a directory it cannot count", async () => {
        // A transcripts file that is no directory cannot be counted.
        const odd = join(temp.root, "odd");
        mkdirSync(join(odd, "transcripts"), { recursive: true });
        writeFileSync(join(odd, "knowledge"), "not a directory");
        await expect(takeSnapshot(odd, work)).rejects.toThrow(
            /cannot count .*knowledge: ENOTDIR/,
        );
        expect(existsSync(join(work, "snapshot.json"))).toBe(false);
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
