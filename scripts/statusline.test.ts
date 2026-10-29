// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/statusline.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
import { join } from "node:path";

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
});
