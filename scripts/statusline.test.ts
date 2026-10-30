// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/statusline.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import {
    chmod,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

const script = join(import.meta.dir, "statusline.sh");
const limits = {
    five_hour: { used_percentage: 42, resets_at: 1793300000 },
    seven_day: { used_percentage: 12, resets_at: 1793900000 },
};
let root: string;
let env: Record<string, string>;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dorothy-statusline-"));
    await mkdir(join(root, "run"));
    await mkdir(join(root, "bin"));
    // A stand-in for ccstatusline that says what it was given.
    const drawn = join(root, "bin", "ccstatusline");
    await writeFile(drawn, '#!/bin/sh\nprintf "drawn %s" "$(cat)"\n');
    await chmod(drawn, 0o755);
    env = {
        PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
        HOME: root,
        XDG_RUNTIME_DIR: join(root, "run"),
        CLAUDE_CONFIG_DIR: "/somewhere/claude-2",
    };
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function statusLine(input: unknown, extra: Record<string, string> = {}) {
    const child = Bun.spawn(["sh", script], {
        env: { ...env, ...extra },
        stdin: new Blob([JSON.stringify(input)]),
        stdout: "pipe",
        stderr: "pipe",
    });
    const [out, code] = await Promise.all([
        new Response(child.stdout).text(),
        child.exited,
    ]);
    return { out, code };
}

describe("the status line", () => {
    it("keeps the plan's limits privately, by account", async () => {
        const input = { model: { display_name: "Opus" }, rate_limits: limits };
        const { out, code } = await statusLine(input);
        expect(code).toBe(0);
        expect(out).toBe(`drawn ${JSON.stringify(input)}`);
        const path = join(root, "run", "claude-usage-claude-2.json");
        const kept = JSON.parse(await readFile(path, "utf8"));
        expect(kept.rate_limits).toEqual(limits);
        expect(kept.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
        expect((await stat(path)).mode & 0o777).toBe(0o600);
    });

    it("keeps the session's context window, limits or none", async () => {
        const context = { used_percentage: 67, context_window_size: 1000000 };
        await statusLine({ context_window: context });
        const path = join(root, "run", "claude-usage-claude-2.json");
        const kept = JSON.parse(await readFile(path, "utf8"));
        expect(kept.context_window).toEqual(context);
        expect(kept.rate_limits).toBeNull();
    });

    it("keeps nothing when the input carries no limits", async () => {
        const { out } = await statusLine({ model: { display_name: "Opus" } });
        expect(out).toStartWith("drawn ");
        expect(await readdir(join(root, "run"))).toEqual([]);
    });

    it("draws the line without a runtime directory", async () => {
        const { out, code } = await statusLine(
            { rate_limits: limits },
            { XDG_RUNTIME_DIR: join(root, "absent") },
        );
        expect(code).toBe(0);
        expect(out).toStartWith("drawn ");
    });

    describe("without ccstatusline", () => {
        // The ambient PATH, less any directory that holds ccstatusline.
        let without: Record<string, string>;
        beforeEach(async () => {
            await rm(join(root, "bin", "ccstatusline"));
            without = {
                PATH: [
                    join(root, "bin"),
                    ...(process.env.PATH ?? "")
                        .split(delimiter)
                        .filter(
                            (directory) =>
                                !existsSync(join(directory, "ccstatusline")),
                        ),
                ].join(delimiter),
            };
        });

        it("draws the model and the 5-hour use", async () => {
            const { out, code } = await statusLine(
                { model: { display_name: "Opus" }, rate_limits: limits },
                without,
            );
            expect(code).toBe(0);
            expect(out).toBe("Opus | 5h 42%\n");
            // The limits are kept all the same.
            expect(await readdir(join(root, "run"))).toHaveLength(1);
        });

        it("draws the model alone when there are no limits", async () => {
            const { out } = await statusLine(
                { model: { display_name: "Opus" } },
                without,
            );
            expect(out).toBe("Opus\n");
        });

        it("draws the 5-hour use of a model with no name", async () => {
            const { out } = await statusLine({ rate_limits: limits }, without);
            expect(out).toBe("Claude | 5h 42%\n");
        });

        it("rounds the percentage and drops control characters", async () => {
            const { out } = await statusLine(
                {
                    model: { display_name: "Op\u001b[31mus" },
                    rate_limits: {
                        five_hour: { used_percentage: 41.6, resets_at: 1 },
                    },
                },
                without,
            );
            expect(out).toBe("Op[31mus | 5h 42%\n");
        });

        it("draws something for an input it cannot read", async () => {
            const { out, code } = await statusLine("not an object", without);
            expect(code).toBe(0);
            expect(out).toBe("Claude\n");
        });
    });
});
