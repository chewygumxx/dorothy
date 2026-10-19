// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/run-tui.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, newPhrase } from "@dorothy/core";
import * as memoryModule from "@dorothy/memory";
import * as tui from "@dorothy/tui";
import { runTui } from "./run-tui.js";

// runTui opens memory from these, so every one points into the test's
// directory.
const XDG = [
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_STATE_HOME",
] as const;
let dir = "";
let saved: Partial<Record<(typeof XDG)[number], string>> = {};
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-run-tui-"));
    saved = {};
    for (const variable of XDG) {
        saved[variable] = process.env[variable];
        process.env[variable] = dir;
    }
});
afterEach(async () => {
    for (const variable of XDG) {
        const value = saved[variable];
        if (value === undefined) {
            delete process.env[variable];
        } else {
            process.env[variable] = value;
        }
    }
    await rm(dir, { recursive: true, force: true });
});

describe("runTui", () => {
    it.each([false, true])(
        "awaits memory settlement after the screen exits (throws: %s)",
        async (fails) => {
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            let closed = false;
            const opening = spyOn(memoryModule, "openMemory").mockResolvedValue(
                {
                    ok: true,
                    memory: {
                        phrase: "amber-otter-quietly-sings",
                        history: [],
                        costUsd: 0,
                        config: DEFAULT_CONFIG,
                        warnings: [],
                        notices: undefined,
                        createSession: () => ({
                            send: () => {},
                            close: async () => {},
                            interrupt: async () => {},
                            subscribe: () => () => {},
                        }),
                        close: async () => {
                            entered.resolve();
                            await release.promise;
                            closed = true;
                        },
                    },
                },
            );
            const screen = spyOn(tui, "runApp").mockImplementation(async () => {
                if (fails) throw new Error("fixture render failure");
            });
            let settled = false;
            const result = runTui(null).then(
                (code) => {
                    settled = true;
                    return { code };
                },
                (error: unknown) => {
                    settled = true;
                    return { error };
                },
            );
            try {
                await entered.promise;
                await Bun.sleep(10);
                expect(settled).toBe(false);
                release.resolve();
                const outcome = await result;
                expect(closed).toBe(true);
                if (fails)
                    expect(outcome).toMatchObject({ error: expect.any(Error) });
                else expect(outcome).toEqual({ code: 0 });
            } finally {
                release.resolve();
                await result;
                opening.mockRestore();
                screen.mockRestore();
            }
        },
    );
    it("exits 1 before rendering when the transcript to resume is missing", async () => {
        const phrase = newPhrase();
        const written: string[] = [];
        const write = spyOn(process.stderr, "write").mockImplementation(
            (chunk) => {
                written.push(String(chunk));
                return true;
            },
        );
        try {
            expect(await runTui(phrase)).toBe(1);
        } finally {
            write.mockRestore();
        }
        expect(written.join("")).toStartWith(
            `dorothy: cannot resume ${phrase}: `,
        );
    });
});
