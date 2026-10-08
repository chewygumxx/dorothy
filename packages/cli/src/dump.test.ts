// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/dump.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CaptureQueryFn, personaPrompt } from "@dorothy/agent";
import { newPhrase } from "@dorothy/core";
import { runDump } from "./dump.js";

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
