// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/service-versions.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
    dir,
    entry,
    LIVE,
    NOTES,
    phrase,
    reply,
    reviews,
    setup,
    sidecarOf,
    transcript,
    until,
    user,
    useTempDir,
} from "./service-testing.js";
import { EMPTY_SIDECAR, type HistoryHandle, sidecarPath } from "./sidecar.js";

useTempDir();

describe("versions", () => {
    const OTHER = phrase(1);
    const tagsPath = () => join(dir, "tags.json");

    // A history that records what it is asked to and heals with the
    // function given; healing under its lock fails the test.
    function fakeVersions(
        heal: (path: string) => Promise<boolean> = async () => false,
    ) {
        const recorded: { paths: readonly string[]; message: string }[] = [];
        const healed: string[] = [];
        let locked = false;
        const versions: HistoryHandle = {
            recorder: async (paths, message) => {
                recorded.push({ paths, message });
            },
            lock: async (work) => {
                locked = true;
                try {
                    return await work();
                } finally {
                    locked = false;
                }
            },
            sweep: async () => {},
            heal: async (path) => {
                if (locked) {
                    throw new Error("healed under the lock");
                }
                healed.push(path);
                return heal(path);
            },
            close: () => {},
        };
        return { versions, recorded, healed };
    }

    it("records the provisional title", async () => {
        const { versions, recorded } = fakeVersions();
        const { memory } = setup({ call: reviews().fn, versions });
        memory.sent("Hey there");
        await until(() => recorded.length > 0);
        expect(recorded).toEqual([
            {
                paths: [sidecarPath(dir, LIVE)],
                message: `title: ${LIVE} (prompt)`,
            },
        ]);
    });

    it("records a review with the vocabulary beside it", async () => {
        await transcript(LIVE, [user("Hi"), reply("Hello")]);
        const { versions, recorded } = fakeVersions();
        const { memory } = setup({
            call: reviews({ ...NOTES, tags: [], coined: [] }).fn,
            versions,
            vocabulary: tagsPath(),
        });
        memory.turnEnded();
        await until(() =>
            recorded.some((entry) => entry.message.startsWith("review:")),
        );
        expect(recorded).toContainEqual({
            paths: [sidecarPath(dir, LIVE), tagsPath()],
            message: `review: ${LIVE} (dorothy, claude-test)`,
        });
    });

    it("records a failed review's mark", async () => {
        await transcript(LIVE, [user("Hi"), reply("Hello")]);
        const { versions, recorded } = fakeVersions();
        const { memory } = setup({
            call: reviews(new Error("down")).fn,
            versions,
        });
        memory.turnEnded();
        await until(() => recorded.length > 0);
        expect(recorded).toEqual([
            {
                paths: [sidecarPath(dir, LIVE)],
                message: `review: ${LIVE} (dorothy, failed)`,
            },
        ]);
    });

    it("heals a broken vocabulary before a review, never under the lock", async () => {
        await writeFile(tagsPath(), "{");
        await transcript(OTHER, [user("a"), reply("b")]);
        const { versions, healed } = fakeVersions(async (path) => {
            await writeFile(path, '{"v":1,"rev":1,"concepts":{}}');
            return true;
        });
        const { memory } = setup({
            call: reviews({
                ...NOTES,
                tags: ["memory"],
                coined: [{ prefLabel: "memory", scopeNote: "Remembering." }],
            }).fn,
            versions,
            vocabulary: tagsPath(),
            entries: [entry(OTHER, null)],
        });
        memory.ready();
        await until(
            async () => ((await sidecarOf(OTHER))?.tags.length ?? 0) > 0,
        );
        expect(healed).toEqual([tagsPath()]);
        expect((await sidecarOf(OTHER))?.tags).toHaveLength(1);
    });

    it("heals a broken sidecar before reviewing it", async () => {
        await transcript(OTHER, [user("a"), reply("b")]);
        await writeFile(sidecarPath(dir, OTHER), "[]");
        const { versions, healed } = fakeVersions(async (path) => {
            await writeFile(path, JSON.stringify(EMPTY_SIDECAR));
            return true;
        });
        const { memory } = setup({
            call: reviews(NOTES).fn,
            versions,
            entries: [entry(OTHER, null)],
        });
        memory.ready();
        await until(
            async () => (await sidecarOf(OTHER))?.title === NOTES.title,
        );
        expect(healed).toEqual([sidecarPath(dir, OTHER)]);
    });
});
