// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/agent/src/providers.ts
//
//

// The AI SDK's model for a route entry. Every provider is given its base
// URL, its key and a fetch that follows no redirect, so that none falls
// back on ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY or any variable of its
// own, and a key goes only where its route says.

import { createAnthropic } from "@ai-sdk/anthropic";
import type { Env, RouteEntry } from "@dorothy/core";
import type { LanguageModel } from "ai";

// The AI SDK writes its warnings to the console, which would land on the
// TUI's screen; Dorothy reports what matters herself.
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

export const noRedirect: typeof fetch = Object.assign(
    (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        fetch(input, { ...init, redirect: "manual" }),
    { preconnect: fetch.preconnect },
);

// What a model is asked for: a chat's reply, or structured output, for
// which OpenRouter chooses only endpoints that honour the schema.
export type Use = "chat" | "structured";

export type ModelFactory = (
    entry: RouteEntry,
    key: string,
    use: Use,
) => LanguageModel;

export const languageModel: ModelFactory = (entry, key) => {
    const root = entry.baseUrl.replace(/\/+$/, "");
    switch (entry.kind) {
        case "anthropic":
            return createAnthropic({
                baseURL: `${root}/v1`,
                apiKey: key,
                fetch: noRedirect,
            })(entry.model);
        default:
            throw new Error(
                `no provider for ${(entry as { kind: string }).kind} entries`,
            );
    }
};

// Anthropic's prompt cache: a breakpoint closes the prefix it caches.
export const BREAKPOINT = {
    anthropic: { cacheControl: { type: "ephemeral" as const } },
};

// A request's system prompt: on Anthropic, a system message carrying a
// breakpoint, so that the prompt is cached; elsewhere its text.
export function instructionsFor(entry: RouteEntry, system: string) {
    return entry.kind === "anthropic"
        ? {
              role: "system" as const,
              content: system,
              providerOptions: BREAKPOINT,
          }
        : system;
}

// The key an entry names, from env: "" for a keyless entry, null when
// the key it names is not set.
export function keyOf(entry: RouteEntry, env: Env): string | null {
    if (entry.key === null) {
        return "";
    }
    const value = env[entry.key];
    return value === undefined || value === "" ? null : value;
}

// Models that always think. Their default display is "omitted", which
// streams nothing while they think, and the provider drops pings, so a
// long think would look like a stall: they stream a summary instead. A
// new always-thinking model must be added here, or it gets "disabled".
const ALWAYS_THINKS = new Set(["claude-opus-5-5", "claude-fable-5-1"]);

type Thinking =
    | { type: "disabled" }
    | { type: "adaptive"; display: "summarized" };

// Thinking at each model's lowest: "disabled", which the provider turns
// into the lowest a model allows; adaptive, summarised, on models that
// always think.
export function providerOptions(
    entry: RouteEntry,
): Record<string, { thinking: Thinking }> {
    if (entry.kind !== "anthropic") {
        return {};
    }
    return {
        anthropic: {
            thinking: ALWAYS_THINKS.has(entry.model)
                ? { type: "adaptive", display: "summarized" }
                : { type: "disabled" },
        },
    };
}
