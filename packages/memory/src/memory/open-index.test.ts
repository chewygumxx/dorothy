// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/open-index.test.ts
//
//

import { describe, expect, it, setSystemTime } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_CONFIG, xdgDir } from "@dorothy/core";
import {
    closeInOrder,
    indexClaims,
    indexUses,
    openChatIndex,
    openIndex,
} from "./open.js";

import { dir, useXdgDir } from "./open-testing.js";

useXdgDir();

describe("indexUses", () => {
    it("asks for the index for compaction when this chat compacts, whatever memory says", () => {
        const memoryOff = {
            ...DEFAULT_CONFIG,
            memory: { ...DEFAULT_CONFIG.memory, enabled: false, recall: false },
        };
        expect(indexUses(memoryOff, true)).toEqual({
            memory: false,
            recall: false,
            compaction: true,
        });
        // Compaction on in the config, but off for this chat: its notes
        // can't be read.
        expect(indexUses(DEFAULT_CONFIG, false)).toEqual({
            memory: DEFAULT_CONFIG.memory.enabled,
            recall: DEFAULT_CONFIG.memory.recall,
            compaction: false,
        });
    });
});

describe("openChatIndex", () => {
    const memoryOff = {
        ...DEFAULT_CONFIG,
        memory: { ...DEFAULT_CONFIG.memory, enabled: false, recall: false },
    };
    const indexFile = () =>
        join(
            xdgDir(process.env, "XDG_CACHE_HOME", ".cache"),
            "dorothy",
            "recall.sqlite",
        );

    it("opens the index in the cache for compaction alone", () => {
        const opened = openChatIndex(memoryOff, true);
        try {
            expect(opened.index).not.toBeNull();
            expect(opened.warning).toBeNull();
            expect(indexFile()).toStartWith(dir);
            expect(existsSync(indexFile())).toBe(true);
        } finally {
            opened.index?.close();
        }
    });

    it("opens no index when nothing in this chat uses it", () => {
        const opened = openChatIndex(memoryOff, false);
        opened.index?.close();
        expect(opened).toEqual({ index: null, warning: null });
        expect(existsSync(indexFile())).toBe(false);
    });
});

describe("openIndex", () => {
    const off = { memory: false, recall: false, compaction: false };
    const failing = () => {
        throw new Error("disk gone");
    };

    it("opens the index for compaction alone, for its claim and lock", () => {
        const index = { name: "index" };
        expect(openIndex({ ...off, compaction: true }, () => index)).toEqual({
            index,
            warning: null,
        });
    });

    it("leaves the index shut when nothing uses it", () => {
        let opened = 0;
        expect(openIndex(off, () => ++opened)).toEqual({
            index: null,
            warning: null,
        });
        expect(opened).toBe(0);
    });

    it("names what starts without the index when it can't be opened", () => {
        expect(openIndex({ ...off, compaction: true }, failing)).toEqual({
            index: null,
            warning:
                "index: can't be opened (disk gone); starting without compaction's lock",
        });
        expect(
            openIndex({ memory: true, recall: true, compaction: true }, failing)
                .warning,
        ).toBe(
            "memory: the index can't be opened (disk gone); starting without memory, recall and compaction's lock",
        );
        expect(
            openIndex({ ...off, memory: true, recall: true }, failing).warning,
        ).toBe(
            "memory: the index can't be opened (disk gone); starting without memory and recall",
        );
    });
});

describe("closeInOrder", () => {
    it("runs every step in order even when an earlier one throws, then rethrows the first", async () => {
        const ran: string[] = [];
        const step = (name: string, fail?: string) => async () => {
            ran.push(name);
            if (fail !== undefined) {
                throw new Error(fail);
            }
        };
        await expect(
            closeInOrder([
                step("compaction", "first"),
                step("memory"),
                step("index", "second"),
                step("transcript"),
            ]),
        ).rejects.toThrow("first");
        expect(ran).toEqual(["compaction", "memory", "index", "transcript"]);
    });

    it("settles quietly when every step does", async () => {
        const ran: string[] = [];
        await closeInOrder([
            () => {
                ran.push("a");
            },
            async () => {
                ran.push("b");
            },
        ]);
        expect(ran).toEqual(["a", "b"]);
    });
});

describe("indexClaims", () => {
    it("renews a chain's claim at each take, so it lives a call's length from each run", async () => {
        // The index's claims table, as the store keeps it.
        const table = new Map<string, { owner: string; until: number }>();
        const index = {
            claim: async (
                phrase: string,
                owner: string,
                now: number,
                ms: number,
            ) => {
                const row = table.get(phrase);
                if (row === undefined || row.until <= now) {
                    table.set(phrase, { owner, until: now + ms });
                }
                return table.get(phrase)?.owner === owner;
            },
            renew: async (
                phrase: string,
                owner: string,
                now: number,
                ms: number,
            ) => {
                const row = table.get(phrase);
                if (row?.owner !== owner || row.until <= now) {
                    return false;
                }
                row.until = now + ms;
                return true;
            },
            release: async (phrase: string, owner: string) => {
                if (table.get(phrase)?.owner === owner) {
                    table.delete(phrase);
                }
            },
        };
        const claims = indexClaims(index, "a-phrase");
        const chain = claims();
        try {
            setSystemTime(new Date(0));
            expect(await chain.take()).toBe(true);
            // The chain's second run, near the end of the first's life.
            setSystemTime(new Date(140_000));
            expect(await chain.take()).toBe(true);
            setSystemTime(new Date(200_000));
            expect(await claims().take()).toBe(false);
        } finally {
            setSystemTime();
        }
    });

    it("gives each chain its own owner, so two chains of one TUI exclude each other", async () => {
        // The index's claims table: one owner a conversation, released only
        // by that owner.
        const table = new Map<string, string>();
        const index = {
            claim: async (phrase: string, owner: string) => {
                if (!table.has(phrase)) {
                    table.set(phrase, owner);
                }
                return table.get(phrase) === owner;
            },
            renew: async (phrase: string, owner: string) =>
                table.get(phrase) === owner,
            release: async (phrase: string, owner: string) => {
                if (table.get(phrase) === owner) {
                    table.delete(phrase);
                }
            },
        };
        const claim = indexClaims(index, "a-phrase");
        const old = claim();
        const next = claim();
        expect(await old.take()).toBe(true);
        expect(await next.take()).toBe(false);
        await old.release();
        expect(await next.take()).toBe(true);
        // A late release by the old run leaves the new run's claim alone.
        await old.release();
        expect(await claim().take()).toBe(false);
    });
});
