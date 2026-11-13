// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/core/src/models/routing.ts
//
//

// config.toml's [providers] and [models]: which providers Dorothy's
// requests may reach, and each role's ordered list of models on them.
// Unlike the other tables, a fault here is no warning: a default could
// send her requests where the user did not mean, so the caller refuses
// to route at all.

import {
    KINDS,
    type Kind,
    ROLES,
    type Role,
    type Route,
    type RouteEntry,
    type Routes,
} from "../contracts/model.js";
import {
    ANTHROPIC_API_ROOT,
    ANTHROPIC_KEY,
    DEFAULT_MODELS,
    FIXED_ROOTS,
} from "./routes.js";

// A [providers.<name>] table, read.
export type Provider = {
    name: string;
    kind: Kind;
    key: string | null;
    baseUrl: string;
};

// Every role's route, and the secrets.json names every provider gives,
// which the recall server must never see.
export type Routing = { routes: Routes; keys: string[] };

export type RoutingResult =
    | { ok: true; routing: Routing }
    | { ok: false; faults: string[] };

// A name a route entry can carry: no colon, which ends it, and no dot,
// which TOML would read as a nested table.
const PROVIDER_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
// A secrets.json name, never a value.
const KEY_NAME = /^[A-Z_][A-Z0-9_]*$/;

// The kinds that may carry a price, having no price table of their own
// and no cost in their responses.
const PRICED: readonly Kind[] = ["featherless", "huggingface", "local"];

type Rule = {
    key: "required" | "optional";
    baseUrl: "none" | "optional" | "required";
};

// Each kind as a fault names it, and the base-url it would take.
const ARTICLE: Readonly<Record<Kind, string>> = {
    anthropic: "an",
    openrouter: "an",
    featherless: "a",
    huggingface: "a",
    local: "a",
};
const BASE_URL_EXAMPLE: Readonly<Record<Kind, string>> = {
    anthropic: "http://127.0.0.1:8080",
    openrouter: "",
    featherless: "",
    huggingface: "",
    local: "http://127.0.0.1:11434/v1",
};

const RULES: Readonly<Record<Kind, Rule>> = {
    anthropic: { key: "required", baseUrl: "optional" },
    openrouter: { key: "required", baseUrl: "none" },
    featherless: { key: "required", baseUrl: "none" },
    huggingface: { key: "required", baseUrl: "none" },
    local: { key: "optional", baseUrl: "required" },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const isKind = (value: unknown): value is Kind =>
    (KINDS as readonly unknown[]).includes(value);
const isRole = (name: string): name is Role =>
    (ROLES as readonly string[]).includes(name);

// Loopback by the parsed URL alone: localhost, 127.0.0.0/8 or [::1],
// over http or https, with no user or password. The parser has already
// written any other form of a loopback address in one of these.
export function isLoopback(text: string): boolean {
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        return false;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        return false;
    }
    if (url.username !== "" || url.password !== "") {
        return false;
    }
    const host = url.hostname;
    return (
        host === "localhost" ||
        host === "[::1]" ||
        /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
    );
}

// The provider config.toml implies when it declares none.
const IMPLIED: Provider = {
    name: "anthropic",
    kind: "anthropic",
    key: ANTHROPIC_KEY,
    baseUrl: ANTHROPIC_API_ROOT,
};

function readProvider(
    name: string,
    value: unknown,
    faults: string[],
): Provider | null {
    const at = `config.toml: providers.${name}`;
    if (!PROVIDER_NAME.test(name)) {
        faults.push(
            `${at}: a provider's name is letters, digits, - and _, starting with a letter or digit`,
        );
        return null;
    }
    if (!isRecord(value)) {
        faults.push(`${at} is not a table`);
        return null;
    }
    const kind = value.kind;
    if (!isKind(kind)) {
        faults.push(`${at}.kind must be one of ${KINDS.join(", ")}`);
        return null;
    }
    const rule = RULES[kind];
    const before = faults.length;
    for (const setting of Object.keys(value)) {
        if (
            setting !== "kind" &&
            setting !== "key" &&
            !(setting === "base-url" && rule.baseUrl !== "none")
        ) {
            faults.push(
                `${at}: ${ARTICLE[kind]} ${kind} provider takes no ${setting}`,
            );
        }
    }
    const key = value.key;
    if (key === undefined) {
        if (rule.key === "required") {
            faults.push(`${at}.key is required`);
        }
    } else if (typeof key !== "string" || !KEY_NAME.test(key)) {
        faults.push(
            `${at}.key must name a secret, such as "ANTHROPIC_API_KEY", never hold one`,
        );
    }
    const baseUrl = value["base-url"];
    if (baseUrl === undefined) {
        if (rule.baseUrl === "required") {
            faults.push(`${at}.base-url is required`);
        }
    } else if (
        rule.baseUrl !== "none" &&
        (typeof baseUrl !== "string" || !isLoopback(baseUrl))
    ) {
        faults.push(
            `${at}.base-url must be a loopback http or https URL, such as "${BASE_URL_EXAMPLE[kind]}"`,
        );
    } else if (kind === "anthropic" && typeof baseUrl === "string") {
        // Dorothy appends /v1 to an anthropic root, so one that has it
        // would send requests to /v1/v1/messages.
        if (new URL(baseUrl).pathname.replace(/\/+$/, "").endsWith("/v1")) {
            faults.push(
                `${at}.base-url is written without /v1, which Dorothy appends, such as "${BASE_URL_EXAMPLE[kind]}"`,
            );
        }
    }
    if (faults.length > before) {
        return null;
    }
    return {
        name,
        kind,
        key: typeof key === "string" ? key : null,
        baseUrl:
            typeof baseUrl === "string"
                ? baseUrl
                : kind === "anthropic"
                  ? ANTHROPIC_API_ROOT
                  : FIXED_ROOTS[kind as keyof typeof FIXED_ROOTS],
    };
}

function readProviders(
    value: unknown,
    faults: string[],
): Map<string, Provider> {
    if (value === undefined) {
        return new Map([[IMPLIED.name, IMPLIED]]);
    }
    const providers = new Map<string, Provider>();
    if (!isRecord(value)) {
        faults.push("config.toml: providers is not a table");
        return providers;
    }
    for (const [name, table] of Object.entries(value)) {
        const provider = readProvider(name, table, faults);
        if (provider !== null) {
            providers.set(name, provider);
        }
    }
    return providers;
}

const entryOf = (
    provider: Provider,
    model: string,
    price: [number, number] | null,
): RouteEntry => ({
    provider: provider.name,
    kind: provider.kind,
    model,
    baseUrl: provider.baseUrl,
    key: provider.key,
    price,
});

const isPrice = (value: unknown): value is [number, number] =>
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
        (each) =>
            typeof each === "number" && Number.isFinite(each) && each >= 0,
    );

// One item of a route: "provider:model", or { model, price }.
function readEntry(
    at: string,
    item: unknown,
    providers: Map<string, Provider>,
    declared: ReadonlySet<string>,
    faults: string[],
): RouteEntry | null {
    let text: unknown = item;
    let price: [number, number] | null = null;
    if (isRecord(item)) {
        for (const setting of Object.keys(item)) {
            if (setting !== "model" && setting !== "price") {
                faults.push(`${at}: an entry takes no ${setting}`);
                return null;
            }
        }
        text = item.model;
        if (item.price !== undefined) {
            if (!isPrice(item.price)) {
                faults.push(
                    `${at}: a price is two dollar amounts per million tokens, input and output, such as [0.1, 0.1]`,
                );
                return null;
            }
            price = item.price;
        }
    }
    if (typeof text !== "string") {
        faults.push(
            `${at}: an entry is "provider:model" or { model = "provider:model", price = [in, out] }`,
        );
        return null;
    }
    // At the first colon: a model's own name may hold more.
    const colon = text.indexOf(":");
    const name = colon === -1 ? "" : text.slice(0, colon);
    const model = colon === -1 ? "" : text.slice(colon + 1);
    if (name === "" || model === "") {
        faults.push(`${at}: "${text}" is not "provider:model"`);
        return null;
    }
    const provider = providers.get(name);
    if (provider === undefined) {
        // A provider declared with a fault has said so already.
        if (!declared.has(name)) {
            faults.push(`${at}: no provider is named ${name}`);
        }
        return null;
    }
    if (price !== null && !PRICED.includes(provider.kind)) {
        faults.push(
            `${at}: ${text} cannot carry a price; only ${PRICED.join(", ")} entries do`,
        );
        return null;
    }
    return entryOf(provider, model, price);
}

function readRoutes(
    value: unknown,
    providers: Map<string, Provider>,
    declared: ReadonlySet<string>,
    faults: string[],
): Partial<Routes> {
    const routes: Partial<Routes> = {};
    if (value === undefined) {
        return routes;
    }
    if (!isRecord(value)) {
        faults.push("config.toml: models is not a table");
        return routes;
    }
    for (const [role, list] of Object.entries(value)) {
        const at = `config.toml: models.${role}`;
        if (!isRole(role)) {
            faults.push(`${at}: the roles are ${ROLES.join(", ")}`);
            continue;
        }
        if (!Array.isArray(list) || list.length === 0) {
            faults.push(`${at} must be a list of one model or more`);
            continue;
        }
        const route: Route = [];
        for (const item of list) {
            const entry = readEntry(at, item, providers, declared, faults);
            if (entry !== null) {
                route.push(entry);
            }
        }
        routes[role] = route;
    }
    return routes;
}

// Reads the two tables from config.toml's parsed data; every other table
// is parseConfig's.
export function parseRouting(data: Record<string, unknown>): RoutingResult {
    const faults: string[] = [];
    const providers = readProviders(data.providers, faults);
    // A role left out is a fault of its own only where every provider
    // was read: one that was not has said so already.
    const providersRead = faults.length === 0;
    const declared = new Set(
        isRecord(data.providers) ? Object.keys(data.providers) : [],
    );
    const given = readRoutes(data.models, providers, declared, faults);
    const anthropic = providers.get("anthropic");
    const routes = {} as Routes;
    for (const role of ROLES) {
        const route = given[role];
        if (route !== undefined) {
            routes[role] = route;
        } else if (anthropic?.kind === "anthropic") {
            routes[role] = [entryOf(anthropic, DEFAULT_MODELS[role], null)];
        } else if (providersRead) {
            faults.push(
                `config.toml: models.${role} is missing, and no anthropic provider named anthropic gives its default`,
            );
        }
    }
    if (faults.length > 0) {
        return { ok: false, faults };
    }
    const keys = [
        ...new Set(
            [...providers.values()].flatMap((provider) =>
                provider.key === null ? [] : [provider.key],
            ),
        ),
    ];
    return { ok: true, routing: { routes, keys } };
}
