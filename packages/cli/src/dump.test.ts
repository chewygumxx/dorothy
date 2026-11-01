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
import type { dumpRequest } from "@dorothy/agent";
import { defaultRoutes, newPhrase } from "@dorothy/core";
import { runDump } from "./dump.js";

const ROUTING = { routes: defaultRoutes(), keys: ["ANTHROPIC_API_KEY"] };

const recording = (
    body: unknown = { model: "claude-opus-5-5" },
    reports: ["warning" | "error", string][] = [],
) => {
    const seen: Parameters<typeof dumpRequest>[0][] = [];
    const dump = async (options: Parameters<typeof dumpRequest>[0]) => {
        seen.push(options);
        for (const [kind, message] of reports) {
            options.report?.(kind, message);
        }
        return body;
    };
    return { seen, dump };
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
        const fake = recording();
        const code = await runDump(
            { resume: null, message: "hi", persona: "chat" },
            { routing: ROUTING, env, dump: fake.dump, write },
        );
        expect(code).toBe(0);
        expect(JSON.parse(out)).toEqual({ model: "claude-opus-5-5" });
        expect(fake.seen).toHaveLength(1);
        expect(fake.seen[0]).toMatchObject({
            message: "hi",
            route: ROUTING.routes.chat,
            keys: ROUTING.keys,
            setup: { persona: "chat", history: [] },
        });
        expect(fake.seen[0]?.setup.recall).toHaveProperty("command");
    });

    it("dumps development mode", async () => {
        const fake = recording();
        await runDump(
            { resume: null, message: "hi", persona: "development" },
            { routing: ROUTING, env, dump: fake.dump, write },
        );
        expect(fake.seen[0]?.setup.persona).toBe("development");
    });

    it("fails on a chat that cannot be resumed", async () => {
        const fake = recording();
        const phrase = newPhrase();
        const code = await runDump(
            { resume: phrase, message: "hi", persona: "chat" },
            { routing: ROUTING, env, dump: fake.dump, write },
        );
        expect(code).toBe(1);
        expect(out).toBe("");
        expect(err).toContain(`cannot resume ${phrase}`);
        expect(fake.seen).toEqual([]);
    });

    it("fails when the chat sent no request", async () => {
        const code = await runDump(
            { resume: null, message: "hi", persona: "chat" },
            { routing: ROUTING, env, dump: recording(null).dump, write },
        );
        expect(code).toBe(1);
        expect(err).toBe("dorothy: the chat sent no request to dump\n");
    });

    it("says the warnings the dump met, beside the body", async () => {
        const fake = recording({ model: "m" }, [
            ["warning", "memory: recall is unavailable (spawn failed)"],
        ]);
        const code = await runDump(
            { resume: null, message: "hi", persona: "chat" },
            { routing: ROUTING, env, dump: fake.dump, write },
        );
        expect(code).toBe(0);
        expect(JSON.parse(out)).toEqual({ model: "m" });
        expect(err).toBe(
            "dorothy: memory: recall is unavailable (spawn failed)\n",
        );
    });

    it("gives the cause when the chat sent no request", async () => {
        const fake = recording(null, [
            ["error", "ANTHROPIC_API_KEY is not set"],
        ]);
        const code = await runDump(
            { resume: null, message: "hi", persona: "chat" },
            { routing: ROUTING, env, dump: fake.dump, write },
        );
        expect(code).toBe(1);
        expect(err).toBe(
            "dorothy: the chat sent no request to dump: ANTHROPIC_API_KEY is not set\n",
        );
    });
});
