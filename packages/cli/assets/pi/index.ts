// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/assets/pi/index.ts
//
//

// Dorothy's Pi extension, which `dorothy --pi` loads by path. It reads the
// launch manifest DOROTHY_PI_MANIFEST names, registers that launch's
// provider (provider.ts), delivers her memory (context.ts) through
// `dorothy --pi-hook` (helper.ts) and her memory tools as the MCP server
// `dorothy-memory`, run as `dorothy --mcp --host pi` in the live cwd.
//
// - Her server's environment is the manifest's helper environment, with
//   every other variable of Pi's own blanked, since Pi starts a server
//   with its environment beneath the one configured.
// - A project or profile MCP server of her name would take precedence
//   over hers: project trust is declined for it, her own is never
//   registered beside it, and calls to its tools are blocked.
// - What else joins her tested loadout (other servers, tools other
//   extensions register, codemode or tool search) is shown, once each.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
    ExtensionAPI,
    ExtensionContext,
    ProjectTrustContext,
} from "@earendil-works/pi-coding-agent";
import { deliverMemory } from "./context.js";
import { hookInvoker } from "./helper.js";
import { registerProvider } from "./provider.js";

type Env = Record<string, string | undefined>;

// What preparePiProfile writes (src/hosts/pi/models.ts PiLaunchManifest),
// re-declared for Node; extension.test.ts checks the two agree.
export type PiManifest = {
    version: 1;
    launchId: string;
    cwd: string;
    self: string[];
    entry: {
        provider: string;
        kind: string;
        model: string;
        baseUrl: string;
        key: string | null;
        price: [number, number] | null;
    };
    models: {
        id: string;
        contextWindow: number;
        maxTokens: number;
        reasoning: boolean;
        input: ("text" | "image")[];
        price: { input: number; output: number; cacheRead: number | null };
        checkedAt: string;
        sources: string[];
    }[];
    extensions: string[];
    skills: string[];
    helperEnv: Env;
    registryPath?: string;
};

export const MEMORY_SERVER = "dorothy-memory";
const MEMORY_TOOLS = "mcp__dorothy_memory__";
const CAPABILITIES = "dorothy-capabilities";
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INCIDENTAL = ["codemode", "tool_search"];

const strings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string");
const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value);

function sound(value: unknown): value is PiManifest {
    const m = value as Partial<PiManifest> | null;
    const entry = m?.entry;
    return (
        !!m &&
        m.version === 1 &&
        typeof m.launchId === "string" &&
        typeof m.cwd === "string" &&
        strings(m.self) &&
        m.self.length > 0 &&
        !!entry &&
        typeof entry.provider === "string" &&
        entry.provider !== "" &&
        typeof entry.model === "string" &&
        typeof entry.baseUrl === "string" &&
        typeof entry.key === "string" &&
        VARIABLE.test(entry.key) &&
        Array.isArray(m.models) &&
        m.models.some((model) => model?.id === entry.model) &&
        m.models.every(
            (model) =>
                typeof model?.id === "string" &&
                number(model.contextWindow) &&
                number(model.maxTokens) &&
                typeof model.reasoning === "boolean" &&
                strings(model.input) &&
                number(model.price?.input) &&
                number(model.price?.output) &&
                (model.price?.cacheRead === null ||
                    number(model.price?.cacheRead)),
        ) &&
        typeof m.helperEnv === "object" &&
        m.helperEnv !== null &&
        Object.values(m.helperEnv).every((item) => typeof item === "string")
    );
}

// The launch's manifest, or a refusal naming its path and nothing in it.
export function readManifest(path: string | undefined): PiManifest {
    let value: unknown = null;
    try {
        if (path) value = JSON.parse(readFileSync(path, "utf8"));
    } catch {}
    if (!sound(value)) throw new Error(`dorothy_pi_manifest: ${path ?? ""}`);
    return value;
}

// A value Pi takes literally: `$` and a leading `!` would otherwise name a
// variable or run a command (pi 1.5.0 core/resolve-config-value.js).
const literal = (value: string) =>
    value.replaceAll("$", () => "$$").replace(/^!/, () => "$!");

export function memoryServer(manifest: PiManifest, env: Env, cwd: string) {
    const [command = "", ...args] = manifest.self;
    const serverEnv: Record<string, string> = {};
    for (const name of Object.keys(env)) serverEnv[name] = "";
    for (const [name, value] of Object.entries(manifest.helperEnv))
        if (value !== undefined) serverEnv[name] = literal(value);
    return {
        command,
        args: [...args, "--mcp", "--host", "pi"],
        env: serverEnv,
        cwd,
        exposure: "direct" as const,
        description: "Dorothy's memory: her past conversations and facts.",
    };
}

// The server names an MCP file gives, read as data; Pi treats names that
// differ in - and _ alone as one.
function serversIn(path: string): string[] {
    try {
        const servers = JSON.parse(readFileSync(path, "utf8"))?.mcpServers;
        return servers && typeof servers === "object" && !Array.isArray(servers)
            ? Object.keys(servers)
            : [];
    } catch {
        return [];
    }
}
const isHers = (name: string) =>
    name.replaceAll("-", "_") === MEMORY_SERVER.replaceAll("-", "_");

// Her capabilities, as a section of Pi's system prompt: the Markdown
// after its house header.
function capabilities(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    const text = readFileSync(join(here, "capabilities.md"), "utf8");
    const end = text.indexOf("-->");
    return (end < 0 ? text : text.slice(end + 3)).trim();
}

export function dorothyExtension(env: Env): (pi: ExtensionAPI) => void {
    return (pi) => {
        const path = env.DOROTHY_PI_MANIFEST;
        const manifest = readManifest(path);
        const prompt = capabilities();
        const agentDir =
            env.PI_CODING_AGENT_DIR || join(env.HOME ?? "", ".pi", "agent");
        const profileFile = join(agentDir, "mcp.json");
        const projectFile = (cwd: string) => join(cwd, ".pi", "mcp.json");
        const shown = new Set<string>();
        const notify = (
            ctx: ExtensionContext | ProjectTrustContext,
            text: string,
            level: "warning" | "error",
        ) => {
            if (shown.has(text)) return;
            shown.add(text);
            try {
                ctx.ui.notify(text, level);
            } catch {}
        };

        registerProvider(pi, manifest, notify);
        deliverMemory(
            pi,
            hookInvoker(manifest, dirname(path ?? "")),
            (ctx, code) => notify(ctx, `Dorothy's memory: ${code}`, "warning"),
        );

        // Refused before any connection: declining trust keeps a project's
        // server of her name from loading at all.
        pi.on("project_trust", (event, ctx) => {
            if (!serversIn(projectFile(event.cwd)).some(isHers))
                return { trusted: "undecided" };
            notify(
                ctx,
                `pi_mcp_collision: ${projectFile(event.cwd)} names ` +
                    `${MEMORY_SERVER}; the project is not trusted this run`,
                "error",
            );
            return { trusted: "no" };
        });
        let refused = false;
        const servers = (ctx: ExtensionContext) => [
            ...serversIn(profileFile).map((name) => ({
                name,
                path: profileFile,
            })),
            ...(ctx.isProjectTrusted()
                ? serversIn(projectFile(ctx.cwd)).map((name) => ({
                      name,
                      path: projectFile(ctx.cwd),
                  }))
                : []),
        ];
        pi.on("session_start", (_event, ctx) => {
            const shadow = servers(ctx).find((server) => isHers(server.name));
            refused = shadow !== undefined;
            if (shadow) {
                notify(
                    ctx,
                    `pi_mcp_collision: ${shadow.path} names ${MEMORY_SERVER}; ` +
                        "her memory tools are off this run",
                    "error",
                );
                return;
            }
            pi.registerMcpServer(
                MEMORY_SERVER,
                memoryServer(manifest, env, ctx.cwd),
            );
        });
        pi.on("tool_call", (event) => {
            if (refused && event.toolName.startsWith(MEMORY_TOOLS))
                return { block: true, reason: "pi_mcp_collision" };
        });
        pi.on("before_agent_start", (event, ctx) => {
            event.systemPromptOptions.sections[CAPABILITIES] = prompt;
            const deviations = [
                ...servers(ctx)
                    .filter((server) => !isHers(server.name))
                    .map((server) => `MCP server ${server.name}`),
                ...pi
                    .getAllTools()
                    .filter((tool) => tool.sourceInfo.source !== "builtin")
                    .map((tool) => `tool ${tool.name}`),
                ...pi
                    .getActiveTools()
                    .filter((name) => INCIDENTAL.includes(name))
                    .map((name) => `tool ${name}`),
            ].filter((deviation) => !shown.has(deviation));
            if (deviations.length === 0) return;
            for (const deviation of deviations) shown.add(deviation);
            ctx.ui.notify(
                `Dorothy: outside her tested loadout: ${deviations.join(", ")}`,
                "warning",
            );
        });
    };
}

export default dorothyExtension(process.env);
