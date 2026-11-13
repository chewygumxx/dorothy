// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/memory/src/hooks/lazy.test.ts
//
//

// `dorothy --hook` loads `@dorothy/memory/host-hook` for Codex and Hermes:
// importing it must not also load the Pi hook, the Pi source reader or what
// they read with (bun:sqlite, the sweep's state), which the Pi exports load
// only when they are called. The probe runs in a process of its own with an
// empty environment, so no module loaded by this test counts.

import { expect, it } from "bun:test";
import { join } from "node:path";

const ENTRY = join(import.meta.dir, "../host-hook.ts");
const PI_MODULES = [
    "hooks/pi.ts",
    "recording/pi-source.ts",
    "recording/sources.ts",
    "recording/state.ts",
];

// Runs `body` after importing the entry; it returns the probe's JSON.
async function probe(body: string): Promise<Record<string, unknown>> {
    const code = `
        const host = await import(${JSON.stringify(ENTRY)});
        const loaded = () => Object.keys(require.cache)
            .map((key) => key.split("/memory/src/")[1])
            .filter((key) => key !== undefined);
        ${body}
    `;
    const child = Bun.spawn([process.execPath, "-e", code], {
        env: {},
        stdout: "pipe",
        stderr: "pipe",
    });
    const [out, err, status] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    if (status !== 0) throw new Error(err);
    return JSON.parse(out) as Record<string, unknown>;
}

it("loads none of the Pi modules when imported", async () => {
    const found = await probe(`
        console.log(JSON.stringify({ loaded: loaded(), names: Object.keys(host) }));
    `);
    const loaded = found.loaded as string[];
    expect(loaded).toContain("hooks/run.ts");
    for (const module of PI_MODULES) expect(loaded).not.toContain(module);
    // The entry point is unchanged.
    expect(found.names).toEqual(
        expect.arrayContaining([
            "HOOK_EVENTS",
            "PI_HOOK_EVENTS",
            "hermesRoot",
            "loadProfiles",
            "parseHookInput",
            "piSessionRoot",
            "readPi",
            "runHostHook",
            "runPiHostHook",
        ]),
    );
});

it("loads them when the Pi hook runs, which still answers", async () => {
    const found = await probe(`
        const reply = await host.runPiHostHook({ event: "later" }, {});
        console.log(JSON.stringify({ reply, loaded: loaded(), events: host.PI_HOOK_EVENTS }));
    `);
    expect(found.reply).toEqual({
        session: null,
        context: "",
        recording: "off",
        warning: "pi_request_invalid",
    });
    expect(found.loaded as string[]).toContain("hooks/pi.ts");
    expect(found.events).toEqual(["start", "prompt", "settled", "end"]);
});
