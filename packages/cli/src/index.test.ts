// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/index.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Env, SecretsCode } from "@dorothy/core";
import { loadCredentials, reviewAgent } from "./index.js";

let root: string;
beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "dorothy-cli-secrets-"));
});
afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe("CLI secrets", () => {
    it("awaits the checkout loader", async () => {
        const env: Env = { HOME: root };
        const events: string[] = [];
        const err: string[] = [];
        await loadCredentials({
            root,
            env,
            write: (text) => {
                err.push(text);
            },
            load: async (path, into) => {
                expect(path).toBe(join(root, "secrets.json"));
                expect(into).toBe(env);
                await Bun.sleep(5);
                into.DOROTHY_RUNTIME_PROBE = "synthetic-value";
                events.push("loaded");
                return null;
            },
        });
        expect(events).toEqual(["loaded"]);
        expect(env.DOROTHY_RUNTIME_PROBE).toBe("synthetic-value");
        expect(err).toEqual([]);
    });

    it.each([
        "SOPS_MISSING",
        "SOPS_FAILED",
        "SECRETS_INVALID",
    ] as SecretsCode[])("warns with only %s", async (code) => {
        const err: string[] = [];
        await loadCredentials({
            root,
            env: { HOME: root },
            load: async () => code,
            write: (text) => {
                err.push(text);
            },
        });
        expect(err).toEqual([`dorothy: secrets not loaded (${code})\n`]);
    });

    it("warns safely if a credential loader unexpectedly throws", async () => {
        const err: string[] = [];
        const failure = await loadCredentials({
            root,
            env: { HOME: root },
            load: async () => {
                throw new Error("untrusted diagnostic");
            },
            write: (text) => {
                err.push(text);
            },
        });
        expect(failure).toBe("SOPS_FAILED");
        expect(err).toEqual(["dorothy: secrets not loaded (SOPS_FAILED)\n"]);
    });

    it("disables service reviews with a coded failure", async () => {
        const err: string[] = [];
        const env: Env = {
            HOME: root,
            ANTHROPIC_BASE_URL: "http://127.0.0.1:4321",
            CLAUDE_CODE_OAUTH_TOKEN: "synthetic-session",
        };
        const result = await reviewAgent({
            root,
            env,
            load: async (path) => {
                expect(path).toBe(join(root, "secrets.json"));
                await Bun.sleep(5);
                return "SOPS_FAILED";
            },
            write: (text) => {
                err.push(text);
            },
        });
        expect(result).toEqual({
            review: null,
            noReviews: "secrets.json did not load (SOPS_FAILED)",
        });
        expect(err).toEqual([
            "dorothy: reviews are off: secrets.json did not load (SOPS_FAILED)\n",
        ]);
    });
});
