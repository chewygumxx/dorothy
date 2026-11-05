// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/models.ts
//
//

import { createHash } from "node:crypto";
import { join } from "node:path";
import { type Env, label, type RouteEntry } from "@dorothy/core";

// What Pi is told of a model it cannot learn from the endpoint: the
// checked limits and prices of assets/pi/models.json.
export type PiModelSpec = {
    id: string;
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
    input: ("text" | "image")[];
    price: { input: number; output: number; cacheRead: number | null };
    checkedAt: string;
    sources: string[];
};

// The route entry Pi runs on, and the models its picker may offer: those
// of that entry's provider alone.
export type PiSelection = { entry: RouteEntry; models: PiModelSpec[] };

// The per-launch file the extension reads. Nothing in it is a credential:
// entry.key names a secrets.json variable, and helperEnv holds only roots,
// executables and local-service coordinates.
export type PiLaunchManifest = {
    version: 1;
    launchId: string;
    cwd: string;
    self: string[];
    entry: RouteEntry;
    models: PiModelSpec[];
    extensions: string[];
    skills: string[];
    helperEnv: Env;
    // The persona file preparePiProfile writes beside the manifest, which
    // the extension adds to Pi's system prompt as a section of its own.
    persona?: string;
    // `--steward`: the registry of the workers she may steward, read
    // again by her helper at each use. Absent, no worker tool exists.
    steward?: {
        registry: string;
        registryDigest: string;
        fleetId: string;
        fixtureRoot: string;
        deadlineAt?: string;
    };
};

const CATALOG = join(import.meta.dir, "../../../assets/pi/models.json");
const CONFIGURED_PRICE = "configuration: route price";

const isNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
const isStrings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string");

function isSpec(value: unknown): value is PiModelSpec {
    if (!value || typeof value !== "object") return false;
    const spec = value as Record<string, unknown>;
    const price = spec.price as Record<string, unknown> | null;
    return (
        typeof spec.id === "string" &&
        isNumber(spec.contextWindow) &&
        isNumber(spec.maxTokens) &&
        typeof spec.reasoning === "boolean" &&
        Array.isArray(spec.input) &&
        spec.input.every((kind) => kind === "text" || kind === "image") &&
        !!price &&
        typeof price === "object" &&
        isNumber(price.input) &&
        isNumber(price.output) &&
        (price.cacheRead === null || isNumber(price.cacheRead)) &&
        typeof spec.checkedAt === "string" &&
        isStrings(spec.sources)
    );
}

// The checked compatibility manifest, which this repository owns.
export async function readPiCatalog(
    path: string = CATALOG,
): Promise<PiModelSpec[]> {
    try {
        const value: unknown = await Bun.file(path).json();
        if (!Array.isArray(value) || !value.every(isSpec)) throw new Error();
        return value;
    } catch {
        throw new Error(`pi_catalog: ${path}`);
    }
}

// The directory below the session root holding one working directory's
// sessions: the digest of the canonical path, which keeps /a/b from /a-b,
// then Pi's own name for it, so what sits inside reads as Pi's does.
// Pi 1.5.0 getDefaultSessionDirPath, dist/core/session-manager.js: the
// path without its leading separator, each separator and colon a dash,
// between double dashes.
export function sessionDirFor(canonicalCwd: string): string {
    const digest = createHash("sha256").update(canonicalCwd).digest("hex");
    const safe = canonicalCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-");
    return join(digest, `--${safe}--`);
}

// The checked spec for a route entry's model, its price the entry's own
// where the route sets one, which the sources say.
function specFor(
    entry: RouteEntry,
    catalog: readonly PiModelSpec[],
): PiModelSpec | undefined {
    const spec = catalog.find((candidate) => candidate.id === entry.model);
    if (!spec || !entry.price) return spec;
    const [input, output] = entry.price;
    return {
        ...spec,
        price: { ...spec.price, input, output },
        sources: [...spec.sources, CONFIGURED_PRICE],
    };
}

// The first Featherless entry of the chat route, or the one a user names as
// provider:model. No model falls back to another, and none of another
// provider is offered.
export function selectPiModel(
    route: readonly RouteEntry[],
    requested: string | null,
    catalog: readonly PiModelSpec[],
): PiSelection {
    const candidates = route.filter((entry) => entry.kind === "featherless");
    if (candidates.length === 0) {
        throw new Error(
            "pi_route_featherless: the chat route has no Featherless entry; " +
                "add a [providers.<name>] of kind featherless to config.toml " +
                "and list it in the chat route",
        );
    }
    const entry =
        requested === null
            ? candidates[0]
            : candidates.find((candidate) => label(candidate) === requested);
    if (!entry) {
        throw new Error(
            `pi_model_unknown: ${requested}; the Featherless entries of ` +
                `the chat route are ${candidates.map(label).join(", ")}`,
        );
    }
    const chosen = specFor(entry, catalog);
    if (!chosen) {
        throw new Error(
            `pi_model_unlisted: ${label(entry)} is not in the checked ` +
                "Pi model manifest (assets/pi/models.json)",
        );
    }
    const models = [chosen];
    for (const sibling of candidates) {
        if (sibling.provider !== entry.provider) continue;
        const spec = specFor(sibling, catalog);
        if (spec && !models.some((model) => model.id === spec.id)) {
            models.push(spec);
        }
    }
    return { entry, models };
}
