// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/assets/pi/provider.ts
//
//

// The launch's provider, as Pi's openai-completions API reaches it, and
// the guard that keeps every request on its models. The key is given as
// a literal Pi holds in memory alone (pi 1.5.0 core/model-runtime.js
// extensionProviders), never as `$<name>`: Pi resolves that from its
// environment on every request (core/provider-composer.js), and the
// environment is what its bash tool and MCP servers inherit.

import type {
    ExtensionAPI,
    ExtensionContext,
    ProviderConfig,
    ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import type { PiManifest } from "./index.js";

// What Featherless's chat template takes, rather than what Pi detects from
// a URL (pi-ai 1.5.0 dist/api/openai-completions.js detectCompat): thinking
// as chat_template_kwargs.thinking, true or false, and no reasoning_effort
// (https://featherless.ai/docs/chat-template-kwargs: DeepSeek V3.1 to V4
// take `thinking`, off by default); system rather than developer messages
// and no OpenAI `store` field, plain Chat Completions both. The wire test
// pins the request this gives.
export const FEATHERLESS_COMPAT = {
    thinkingFormat: "chat-template",
    chatTemplateKwargs: { thinking: { $var: "thinking.enabled" } },
    supportsDeveloperRole: false,
    supportsStore: false,
} as const;

// The template's switch is on or off: Pi's finer levels below high would
// all send the same, so they are unsupported and Pi clamps them, visibly,
// rather than spending a budget the endpoint does not document.
const BINARY_THINKING = { minimal: null, low: null, medium: null } as const;

const label = (model: { provider: string; id: string }) =>
    `${model.provider}/${model.id}`;

export function providerConfig(
    manifest: PiManifest,
    apiKey: string,
): ProviderConfig {
    const models: ProviderModelConfig[] = manifest.models.map((model) => ({
        id: model.id,
        name: model.id,
        reasoning: model.reasoning,
        input: model.input,
        // Unknown cached-input pricing is charged as plain input.
        cost: {
            input: model.price.input,
            output: model.price.output,
            cacheRead: model.price.cacheRead ?? model.price.input,
            cacheWrite: 0,
        },
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        ...(model.reasoning ? { thinkingLevelMap: BINARY_THINKING } : {}),
        compat: FEATHERLESS_COMPAT,
    }));
    return {
        baseUrl: manifest.entry.baseUrl,
        apiKey,
        api: "openai-completions",
        models,
    };
}

// The provider during extension load, so --model finds it at startup;
// then every model change, restore or run checked against the manifest.
export function registerProvider(
    pi: ExtensionAPI,
    manifest: PiManifest,
    apiKey: string,
    warn: (ctx: ExtensionContext, text: string, level: "error") => void,
): void {
    pi.registerProvider(
        manifest.entry.provider,
        providerConfig(manifest, apiKey),
    );
    const allowed = new Set(
        manifest.models.map((model) =>
            label({ provider: manifest.entry.provider, id: model.id }),
        ),
    );
    const ours = (model: { provider: string; id: string } | undefined) =>
        model !== undefined && allowed.has(label(model));
    const selected = {
        provider: manifest.entry.provider,
        id: manifest.entry.model,
    };
    const restore = async (
        ctx: ExtensionContext,
        prior: { provider: string; id: string } | undefined,
    ) => {
        const back = ours(prior) ? prior : selected;
        const model = back && ctx.modelRegistry.find(back.provider, back.id);
        if (model) await pi.setModel(model);
    };
    pi.on("model_select", async (event, ctx) => {
        if (ours(event.model)) return;
        warn(
            ctx,
            `Dorothy runs on ${[...allowed].join(", ")} alone; ` +
                `${label(event.model)} is not in this launch`,
            "error",
        );
        await restore(ctx, event.previousModel);
    });
    pi.on("session_start", async (_event, ctx) => {
        if (ctx.model !== undefined && !ours(ctx.model))
            await restore(ctx, undefined);
    });
    pi.on("before_agent_start", (_event, ctx) => {
        if (ours(ctx.model)) return;
        warn(
            ctx,
            `Dorothy stopped a run on a model outside this launch`,
            "error",
        );
        ctx.abort();
    });
}
