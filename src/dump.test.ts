// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/dump.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaptureQueryFn } from "./capture.js";
import { runDump } from "./dump.js";
import { EMPTY_SIDECAR } from "./memory/sidecar.js";
import { personaPrompt } from "./persona.js";
import { newPhrase } from "./session-id.js";

// Stands in for the CLI: sends the system prompt to whatever API the
// options name, as the CLI would send the whole request.
const posting = (
    body: (options: Parameters<CaptureQueryFn>[0]["options"]) => unknown = (
        o,
    ) => ({
        system: o.systemPrompt,
    }),
): CaptureQueryFn & { options?: Parameters<CaptureQueryFn>[0]["options"] } => {
    const fn = (({ options }) => {
        fn.options = options;
        return (async function* () {
            await fetch(`${options.env?.ANTHROPIC_BASE_URL}/v1/messages`, {
                method: "POST",
                body: JSON.stringify(body(options)),
            }).catch(() => {});
        })();
    }) as CaptureQueryFn & {
        options?: Parameters<CaptureQueryFn>[0]["options"];
    };
    return fn;
};

describe("runDump", () => {
    let dir: string;
    let env: Record<string, string>;
    let out: string;
    let err: string;
    const write = {
        out: (text: string) => {
            out += text;
        },
        err: (text: string) => {
            err += text;
        },
    };

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "dorothy-dump-"));
        env = {
            HOME: dir,
            XDG_CONFIG_HOME: join(dir, "config"),
            XDG_DATA_HOME: join(dir, "data"),
            XDG_CACHE_HOME: join(dir, "cache"),
        };
        out = "";
        err = "";
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("prints the request a new chat would start with, as JSON", async () => {
        const code = await runDump(
            { resume: null, message: "hi", persona: "chat" },
            { env, queryFn: posting(), write },
        );
        expect(code).toBe(0);
        const body = JSON.parse(out) as { system: string };
        expect(body.system).toStartWith(personaPrompt({ recall: true }));
    });

    it("dumps a compacted chat as it would resume: abstracts, then the tail", async () => {
        const phrase = newPhrase();
        const transcripts = join(dir, "data", "dorothy", "transcripts");
        await mkdir(transcripts, { recursive: true });
        const line = (kind: string, text: string) =>
            JSON.stringify({
                v: 1,
                kind,
                at: "2026-10-07T08:00:00.000Z",
                text,
                ...(kind === "assistant" ? { interrupted: false } : {}),
            });
        await writeFile(
            join(transcripts, `${phrase}.jsonl`),
            `${[
                line("user", "Old question."),
                line("assistant", "Old answer."),
                line("user", "New question."),
                line("assistant", "New answer."),
            ].join("\n")}\n`,
        );
        await writeFile(
            join(transcripts, `${phrase}.meta.json`),
            JSON.stringify({
                ...EMPTY_SIDECAR,
                clusters: [
                    {
                        from: 1,
                        through: 2,
                        abstract: "The old exchange.",
                        at: "2026-10-07T08:00:00.000Z",
                        model: "claude-test",
                    },
                ],
            }),
        );
        const fake = posting();
        const code = await runDump(
            { resume: phrase, message: "hi", persona: "chat" },
            { env, queryFn: fake, write },
        );
        expect(code).toBe(0);
        const body = JSON.parse(out) as { system: string };
        expect(body.system).toContain(
            '<cluster n="1" turns="1-2">The old exchange.</cluster>',
        );
        expect(body.system).toContain("User: New question.");
        expect(body.system).not.toContain("Old question.");
        const server = fake.options?.mcpServers?.memory as
            | { args: string[] }
            | undefined;
        expect(server?.args).toContain("--recollect");
    });

    it("dumps development mode", async () => {
        await runDump(
            { resume: null, message: "hi", persona: "development" },
            { env, queryFn: posting(), write },
        );
        const body = JSON.parse(out) as { system: string };
        expect(body.system).toStartWith(
            personaPrompt({ recall: true, mode: "development" }),
        );
    });

    it("fails on a chat that cannot be resumed", async () => {
        const phrase = newPhrase();
        const code = await runDump(
            { resume: phrase, message: "hi", persona: "chat" },
            { env, queryFn: posting(), write },
        );
        expect(code).toBe(1);
        expect(out).toBe("");
        expect(err).toContain(`cannot resume ${phrase}`);
    });

    it("fails when the CLI sent nothing", async () => {
        const silent: CaptureQueryFn = () => (async function* () {})();
        const code = await runDump(
            { resume: null, message: "hi", persona: "chat" },
            { env, queryFn: silent, write },
        );
        expect(code).toBe(1);
        expect(err).toContain("no request");
    });
});
