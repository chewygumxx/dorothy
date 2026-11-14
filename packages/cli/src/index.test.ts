// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/index.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connectRecall } from "@dorothy/agent";
import type { Env, SecretsCode, StructuredCall } from "@dorothy/core";
import { personaLayers } from "@dorothy/identity";
import {
    loadCredentials,
    piHook,
    recallServerOptions,
    reviewAgent,
    serviceOptions,
} from "./index.js";

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

    it("disables service reviews on a routing fault, loading no secrets", async () => {
        const err: string[] = [];
        let loaded = false;
        const result = await reviewAgent({
            root,
            env: { HOME: root },
            readRouting: async () => ({
                ok: false,
                faults: ["config.toml: models.review: no provider is named x"],
            }),
            load: async () => {
                loaded = true;
                return null;
            },
            write: (text) => {
                err.push(text);
            },
        });
        expect(result).toEqual({
            review: null,
            noReviews: "config.toml: models.review: no provider is named x",
        });
        expect(err).toEqual([
            "dorothy: reviews are off: config.toml: models.review: no provider is named x\n",
        ]);
        expect(loaded).toBe(false);
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

describe("--pi-hook", () => {
    const stream = (...parts: string[]) =>
        new ReadableStream<Uint8Array>({
            start(controller) {
                for (const part of parts) {
                    controller.enqueue(new TextEncoder().encode(part));
                }
                controller.close();
            },
        });
    const answer = {
        session: "s",
        context: "the block",
        recording: "pending" as const,
        warning: null,
    };

    it("answers one JSON request with one JSON reply", async () => {
        const seen: unknown[] = [];
        const out = await piHook(stream('{"event":', '"start"}'), async (r) => {
            seen.push(r);
            return answer;
        });
        expect(seen).toEqual([{ event: "start" }]);
        expect(JSON.parse(out)).toEqual(answer);
    });

    it("gives memory nothing it could parse past 128 KiB or as JSON", async () => {
        const seen: unknown[] = [];
        const run = async (request: unknown) => {
            seen.push(request);
            return answer;
        };
        const big = JSON.stringify({ prompt: "x".repeat(128 * 1024) });
        await piHook(stream(big.slice(0, 70_000), big.slice(70_000)), run);
        await piHook(stream("not json"), run);
        expect(seen).toEqual([null, null]);
    });

    it("keeps the reply within 64 KiB, saying so by code", async () => {
        const out = await piHook(stream("{}"), async () => ({
            ...answer,
            context: "y".repeat(64 * 1024),
        }));
        expect(Buffer.byteLength(out)).toBeLessThanOrEqual(64 * 1024);
        expect(JSON.parse(out)).toEqual({
            ...answer,
            context: "",
            warning: "pi_reply_too_large",
        });
    });

    it("replies by code alone should memory throw", async () => {
        const out = await piHook(stream("{}"), async () => {
            throw new Error("untrusted diagnostic");
        });
        expect(JSON.parse(out)).toEqual({
            session: null,
            context: "",
            recording: "pending",
            warning: "pi_hook_failed",
        });
    });
});

describe("persona layers at the CLI boundary", () => {
    it("hands the recall server its mode and persona layers", () => {
        expect(
            recallServerOptions({
                kind: "recall-server",
                exclude: "a-conversation",
                recollect: true,
                project: "/synthetic/project",
            }),
        ).toEqual({
            exclude: "a-conversation",
            recollect: true,
            project: "/synthetic/project",
            layers: personaLayers(),
        });
    });

    it("hands the service its review configuration and persona layers", () => {
        const call: StructuredCall = async () => ({
            ok: false,
            reason: "unused",
            costUsd: 0,
        });
        const review = { review: { call, persona: "review persona" } };
        expect(serviceOptions(review)).toEqual({
            ...review,
            layers: personaLayers(),
        });
        expect(serviceOptions({ review: null, noReviews: "off" })).toEqual({
            review: null,
            noReviews: "off",
            layers: personaLayers(),
        });
    });

    it.each([true, false])(
        "connectRecall exposes persona only when the real server has layers (%s)",
        async (withLayers) => {
            const server = import.meta.resolve("@dorothy/memory/recall-server");
            const options = {
                exclude: null,
                recollect: false,
                project: null,
                ...(withLayers ? { layers: { lore: "L" } } : {}),
            };
            const recall = await connectRecall(
                {
                    command: process.execPath,
                    args: [
                        "--no-env-file",
                        "-e",
                        `
                    import { runRecallServer } from ${JSON.stringify(server)};
                    await runRecallServer(${JSON.stringify(options)});
                `,
                    ],
                },
                false,
                {
                    HOME: root,
                    XDG_CONFIG_HOME: join(root, "config"),
                    XDG_DATA_HOME: join(root, "data"),
                    XDG_CACHE_HOME: join(root, "cache"),
                    XDG_STATE_HOME: join(root, "state"),
                },
            );
            try {
                if (!withLayers) {
                    expect(recall.tools).not.toHaveProperty(
                        "mcp__memory__persona",
                    );
                    return;
                }
                expect(recall.tools).toHaveProperty("mcp__memory__persona");
                const tool = recall.tools.mcp__memory__persona as {
                    execute(input: unknown, options: unknown): Promise<unknown>;
                };
                const result = await tool.execute(
                    { layer: "lore" },
                    {
                        toolCallId: "persona-test",
                        messages: [],
                    },
                );
                expect(result).toEqual({
                    content: [{ type: "text", text: "L" }],
                    isError: false,
                });
            } finally {
                await recall.close();
            }
        },
    );
});
