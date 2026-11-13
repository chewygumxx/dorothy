// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/core/src/models/routing.test.ts
//
//

import { describe, expect, it } from "bun:test";
import { defaultRoutes } from "./routes.js";
import { isLoopback, parseRouting, type RoutingResult } from "./routing.js";

const parse = (text: string): RoutingResult =>
    parseRouting(Bun.TOML.parse(text) as Record<string, unknown>);

const faultsOf = (text: string): string[] => {
    const result = parse(text);
    if (result.ok) {
        throw new Error("expected faults");
    }
    return result.faults;
};

const routingOf = (text: string) => {
    const result = parse(text);
    if (!result.ok) {
        throw new Error(result.faults.join("\n"));
    }
    return result.routing;
};

const PROVIDERS = [
    "[providers.anthropic]",
    'kind = "anthropic"',
    'key = "ANTHROPIC_API_KEY"',
    "",
    "[providers.openrouter]",
    'kind = "openrouter"',
    'key = "OPENROUTER_API_KEY"',
    "",
    "[providers.featherless]",
    'kind = "featherless"',
    'key = "FEATHERLESS_API_KEY"',
    "",
    "[providers.hf]",
    'kind = "huggingface"',
    'key = "HF_TOKEN"',
    "",
    "[providers.ollama]",
    'kind = "local"',
    'base-url = "http://127.0.0.1:11434/v1"',
    "",
].join("\n");

describe("parseRouting", () => {
    it("routes every role to its default on Anthropic with no tables", () => {
        expect(parse("")).toEqual({
            ok: true,
            routing: { routes: defaultRoutes(), keys: ["ANTHROPIC_API_KEY"] },
        });
    });

    it("reads each kind, its fixed root, its key and a route of each", () => {
        const routing = routingOf(
            [
                PROVIDERS,
                "[models]",
                'chat = ["anthropic:claude-opus-5-5", "openrouter:x/y"]',
                "review = [",
                '    "featherless:org/model",',
                '    { model = "hf:org/model:featherless-ai", price = [0.1, 0.2] },',
                '    { model = "ollama:llama3", price = [0, 0] },',
                "]",
            ].join("\n"),
        );
        expect(routing.routes.chat).toEqual([
            {
                provider: "anthropic",
                kind: "anthropic",
                model: "claude-opus-5-5",
                baseUrl: "https://api.anthropic.com",
                key: "ANTHROPIC_API_KEY",
                price: null,
            },
            {
                provider: "openrouter",
                kind: "openrouter",
                model: "x/y",
                baseUrl: "https://openrouter.ai/api/v1",
                key: "OPENROUTER_API_KEY",
                price: null,
            },
        ]);
        expect(routing.routes.review).toEqual([
            {
                provider: "featherless",
                kind: "featherless",
                model: "org/model",
                baseUrl: "https://api.featherless.ai/v1",
                key: "FEATHERLESS_API_KEY",
                price: null,
            },
            {
                provider: "hf",
                kind: "huggingface",
                model: "org/model:featherless-ai",
                baseUrl: "https://router.huggingface.co/v1",
                key: "HF_TOKEN",
                price: [0.1, 0.2],
            },
            {
                provider: "ollama",
                kind: "local",
                model: "llama3",
                baseUrl: "http://127.0.0.1:11434/v1",
                key: null,
                price: [0, 0],
            },
        ]);
        expect(routing.routes.compaction).toEqual(defaultRoutes().compaction);
        expect(routing.keys).toEqual([
            "ANTHROPIC_API_KEY",
            "OPENROUTER_API_KEY",
            "FEATHERLESS_API_KEY",
            "HF_TOKEN",
        ]);
    });

    it("splits an entry at its first colon", () => {
        const routing = routingOf(
            [PROVIDERS, "[models]", 'chat = ["openrouter:x/y:free"]'].join(
                "\n",
            ),
        );
        expect(routing.routes.chat[0]?.model).toBe("x/y:free");
    });

    it("takes an anthropic base-url on loopback, and a local key", () => {
        const routing = routingOf(
            [
                "[providers.anthropic]",
                'kind = "anthropic"',
                'key = "ANTHROPIC_API_KEY"',
                'base-url = "http://localhost:8080"',
                "",
                "[providers.vllm]",
                'kind = "local"',
                'base-url = "https://[::1]:8000/v1"',
                'key = "VLLM_KEY"',
                "",
                "[models]",
                'maintenance = ["vllm:qwen"]',
            ].join("\n"),
        );
        expect(routing.routes.chat[0]?.baseUrl).toBe("http://localhost:8080");
        expect(routing.routes.maintenance[0]).toMatchObject({
            baseUrl: "https://[::1]:8000/v1",
            key: "VLLM_KEY",
        });
    });

    it("faults a route on an anthropic provider not named anthropic, left out", () => {
        expect(
            faultsOf(
                [
                    "[providers.claude]",
                    'kind = "anthropic"',
                    'key = "ANTHROPIC_API_KEY"',
                    "",
                    "[models]",
                    'chat = ["claude:claude-opus-5-5"]',
                    'review = ["claude:claude-sonnet-5-5"]',
                    'compaction = ["claude:claude-sonnet-5-5"]',
                ].join("\n"),
            ),
        ).toEqual([
            "config.toml: models.maintenance is missing, and no anthropic provider named anthropic gives its default",
        ]);
    });

    it.each([
        [
            "a role outside the four",
            '[models]\nsummary = ["anthropic:claude-haiku-5-5"]',
            "config.toml: models.summary: the roles are chat, review, compaction, maintenance",
        ],
        [
            "an empty route",
            "[models]\nchat = []",
            "config.toml: models.chat must be a list of one model or more",
        ],
        [
            "a route that is not a list",
            '[models]\nchat = "anthropic:claude-opus-5-5"',
            "config.toml: models.chat must be a list of one model or more",
        ],
        [
            "an entry with no colon",
            '[models]\nchat = ["claude-opus-5-5"]',
            'config.toml: models.chat: "claude-opus-5-5" is not "provider:model"',
        ],
        [
            "an entry with no model",
            '[models]\nchat = ["anthropic:"]',
            'config.toml: models.chat: "anthropic:" is not "provider:model"',
        ],
        [
            "an undeclared provider",
            '[models]\nchat = ["openrouter:x/y"]',
            "config.toml: models.chat: no provider is named openrouter",
        ],
        [
            "a price on an anthropic entry",
            '[models]\nchat = [{ model = "anthropic:claude-opus-5-5", price = [1, 2] }]',
            "config.toml: models.chat: anthropic:claude-opus-5-5 cannot carry a price; only featherless, huggingface, local entries do",
        ],
        [
            "a price that is not two amounts",
            '[models]\nchat = [{ model = "anthropic:claude-opus-5-5", price = [1] }]',
            "config.toml: models.chat: a price is two dollar amounts per million tokens, input and output, such as [0.1, 0.1]",
        ],
        [
            "a negative price",
            '[models]\nchat = [{ model = "anthropic:claude-opus-5-5", price = [-1, 1] }]',
            "config.toml: models.chat: a price is two dollar amounts per million tokens, input and output, such as [0.1, 0.1]",
        ],
        [
            "an entry table with a setting it does not take",
            '[models]\nchat = [{ model = "anthropic:claude-opus-5-5", effort = "low" }]',
            "config.toml: models.chat: an entry takes no effort",
        ],
        [
            "an entry that is neither text nor a table",
            "[models]\nchat = [3]",
            'config.toml: models.chat: an entry is "provider:model" or { model = "provider:model", price = [in, out] }',
        ],
        [
            "models that is not a table",
            'models = "anthropic:claude-opus-5-5"',
            "config.toml: models is not a table",
        ],
    ])("faults %s", (_name, text, fault) => {
        expect(faultsOf(text)).toEqual([fault]);
    });

    it.each([
        [
            "a kind outside the five",
            '[providers.anthropic]\nkind = "openai"\nkey = "OPENAI_API_KEY"',
            "config.toml: providers.anthropic.kind must be one of anthropic, openrouter, featherless, huggingface, local",
        ],
        [
            "a setting its kind does not take",
            '[providers.anthropic]\nkind = "openrouter"\nkey = "OPENROUTER_API_KEY"\nbase-url = "http://127.0.0.1:1"',
            "config.toml: providers.anthropic: an openrouter provider takes no base-url",
        ],
        [
            "a setting no kind takes",
            '[providers.anthropic]\nkind = "anthropic"\nkey = "ANTHROPIC_API_KEY"\nmodel = "x"',
            "config.toml: providers.anthropic: an anthropic provider takes no model",
        ],
        [
            "a missing key",
            '[providers.anthropic]\nkind = "anthropic"',
            "config.toml: providers.anthropic.key is required",
        ],
        [
            "a key that holds a value",
            '[providers.anthropic]\nkind = "anthropic"\nkey = "sk-ant-api03-abc"',
            'config.toml: providers.anthropic.key must name a secret, such as "ANTHROPIC_API_KEY", never hold one',
        ],
        [
            "a local provider with no base-url",
            '[providers.anthropic]\nkind = "local"',
            "config.toml: providers.anthropic.base-url is required",
        ],
        [
            "a name with a colon",
            '[providers."a:b"]\nkind = "local"\nbase-url = "http://127.0.0.1:1/v1"',
            "config.toml: providers.a:b: a provider's name is letters, digits, - and _, starting with a letter or digit",
        ],
        [
            "a provider that is not a table",
            'providers.anthropic = "anthropic"',
            "config.toml: providers.anthropic is not a table",
        ],
        [
            "providers that is not a table",
            'providers = "anthropic"',
            "config.toml: providers is not a table",
        ],
    ])("faults %s", (_name, text, fault) => {
        // Each provider here is named anthropic, so that a fault in it is
        // the only one: the defaults' routes need no provider of their own.
        expect(faultsOf(text)).toEqual([fault]);
    });

    it("reports every fault, not the first", () => {
        expect(
            faultsOf(
                [
                    "[providers.anthropic]",
                    'kind = "anthropic"',
                    "",
                    "[models]",
                    "chat = []",
                ].join("\n"),
            ),
        ).toEqual([
            "config.toml: providers.anthropic.key is required",
            "config.toml: models.chat must be a list of one model or more",
        ]);
    });

    it.each([
        "http://127.0.0.1.example.com/v1",
        "http://localhost.example.com/v1",
        "http://127.0.0.1@example.com/v1",
        "http://user:pass@127.0.0.1/v1",
        "http://10.0.0.1/v1",
        "ftp://127.0.0.1/v1",
        "127.0.0.1:11434",
        "https://api.anthropic.com",
    ])("refuses %s as a local base-url", (url) => {
        expect(
            faultsOf(
                `[providers.anthropic]\nkind = "local"\nbase-url = "${url}"`,
            ),
        ).toEqual([
            'config.toml: providers.anthropic.base-url must be a loopback http or https URL, such as "http://127.0.0.1:11434/v1"',
        ]);
    });

    it.each(["http://127.0.0.1:8080/v1", "http://localhost:8080/v1/"])(
        "refuses an anthropic base-url ending in /v1: %s",
        (url) => {
            expect(
                faultsOf(
                    `[providers.anthropic]\nkind = "anthropic"\nkey = "ANTHROPIC_API_KEY"\nbase-url = "${url}"`,
                ),
            ).toEqual([
                'config.toml: providers.anthropic.base-url is written without /v1, which Dorothy appends, such as "http://127.0.0.1:8080"',
            ]);
        },
    );

    it("takes an anthropic base-url with another path", () => {
        const routing = routingOf(
            '[providers.anthropic]\nkind = "anthropic"\nkey = "ANTHROPIC_API_KEY"\nbase-url = "http://127.0.0.1:8080/proxy"',
        );
        expect(routing.routes.chat[0]?.baseUrl).toBe(
            "http://127.0.0.1:8080/proxy",
        );
    });

    it("keeps /v1 on a local base-url", () => {
        const routing = routingOf(
            `${PROVIDERS}\n[models]\nmaintenance = ["ollama:qwen"]`,
        );
        expect(routing.routes.maintenance[0]?.baseUrl).toBe(
            "http://127.0.0.1:11434/v1",
        );
    });

    it("refuses a remote anthropic base-url", () => {
        expect(
            faultsOf(
                '[providers.anthropic]\nkind = "anthropic"\nkey = "ANTHROPIC_API_KEY"\nbase-url = "https://proxy.example.com"',
            ),
        ).toEqual([
            'config.toml: providers.anthropic.base-url must be a loopback http or https URL, such as "http://127.0.0.1:8080"',
        ]);
    });
});

describe("isLoopback", () => {
    it.each([
        "http://localhost:11434/v1",
        "https://localhost/v1",
        "http://127.0.0.1:8080",
        "http://127.255.255.254/v1",
        "http://[::1]:8000/v1",
        // The parser writes these as 127.0.0.1 and [::1].
        "http://127.1/v1",
        "http://[0:0:0:0:0:0:0:1]/v1",
        "http://LOCALHOST/v1",
    ])("takes %s", (url) => {
        expect(isLoopback(url)).toBe(true);
    });

    it.each([
        "http://localhost./v1",
        "http://[::ffff:127.0.0.1]/v1",
        "http://0.0.0.0/v1",
        "not a url",
    ])("refuses %s", (url) => {
        expect(isLoopback(url)).toBe(false);
    });
});
