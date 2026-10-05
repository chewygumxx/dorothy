// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/memory/commands.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newPhrase } from "../session-id.js";
import { runList } from "./commands.js";
import { sidecarPath } from "./sidecar.js";

const NOW = new Date("2026-10-05T00:00:00.000Z");
const phrase = (seed: number) =>
    newPhrase(() => Uint8Array.from([seed, 1, 2, 3, 4, 5, 6, 7]));
const line = (kind: string, fields: object) =>
    JSON.stringify({ v: 1, kind, at: NOW.toISOString(), ...fields });
const chat = [
    line("user", { text: "Hi" }),
    line("assistant", { text: "Hello", interrupted: false }),
].join("\n");

function capture() {
    let text = "";
    return {
        write: (chunk: string) => {
            text += chunk;
        },
        get text() {
            return text;
        },
    };
}

let dir = "";
let transcripts = "";
let env: Record<string, string> = {};
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "dorothy-commands-"));
    transcripts = join(dir, "dorothy", "transcripts");
    await mkdir(transcripts, { recursive: true });
    env = { XDG_DATA_HOME: dir, XDG_CONFIG_HOME: dir, HOME: dir };
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe("runList", () => {
    it("prints the catalogue and names broken sidecars on stderr", async () => {
        const [a, b] = [phrase(1), phrase(2)];
        await writeFile(join(transcripts, `${a}.jsonl`), chat);
        await writeFile(
            sidecarPath(transcripts, a),
            JSON.stringify({
                v: 1,
                title: "Memory",
                description: "About memory.",
                reviewedThrough: 2,
            }),
        );
        await writeFile(join(transcripts, `${b}.jsonl`), chat);
        await writeFile(sidecarPath(transcripts, b), "{ broken");
        const out = capture();
        const err = capture();
        expect(await runList({ env, out, err, now: NOW.getTime() })).toBe(0);
        expect(out.text).toStartWith("   last active  tier");
        expect(out.text).toMatch(new RegExp(`described +${a} +Memory\\n`));
        expect(out.text).toMatch(
            new RegExp(`omitted +${b} +\\(untitled\\)\\n`),
        );
        expect(err.text).toContain(sidecarPath(transcripts, b));
    });

    it("lists what Dorothy remembers even with memory switched off", async () => {
        const a = phrase(1);
        await writeFile(join(transcripts, `${a}.jsonl`), chat);
        await writeFile(
            sidecarPath(transcripts, a),
            JSON.stringify({ v: 1, title: "Memory" }),
        );
        await writeFile(
            join(dir, "dorothy", "config.toml"),
            "[memory]\nenabled = false\n",
        );
        const out = capture();
        expect(
            await runList({ env, out, err: capture(), now: NOW.getTime() }),
        ).toBe(0);
        expect(out.text).toContain("Memory");
    });
});
