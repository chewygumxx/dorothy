// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/launch.ts
//
//

// dorothy --pi: the published Pi 1.5.0 under a real Node, in Dorothy's
// profile, with her extension, persona and one Featherless entry of the
// chat route. Pi's own arguments are read as Pi reads them, so a value is
// never taken for an option; those that would supply a key, change the
// model, move the sessions or drop her MCP are refused by name alone. The
// route is checked before any secret is decrypted, and only the selected
// key reaches Pi (env.ts). Help and the dump decrypt nothing.

import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
    basename,
    dirname,
    isAbsolute,
    join,
    relative,
    resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { type Env, label, type Routing } from "@dorothy/core";
import { identityPrompt } from "@dorothy/identity";
import { piSessionRoot } from "@dorothy/memory/host-hook";
import { userShell } from "../../claude.js";
import { runForwarding, type Spawned } from "../../self.js";
import {
    helperEnvOf,
    names,
    nodePath,
    passedEnv,
    piEnvOf,
    reservedKey,
} from "./env.js";
import {
    type PiLaunchManifest,
    readPiCatalog,
    selectPiModel,
} from "./models.js";
import { type PiProfile, piProfileArgs, preparePiProfile } from "./profile.js";
import { type PiRuntime, resolvePiRuntime } from "./runtime.js";

export type PiOptions = { args: string[]; model: string | null; dump: boolean };

export type PiDeps = {
    env: Env;
    cwd: string;
    self: string[];
    loadRouting: () => Promise<Routing>;
    // Loads Dorothy's secrets into the target; a failure is said by it.
    loadSecrets: (target: Env) => Promise<void>;
    spawn: (cmd: string[], env: Env, cwd?: string) => Spawned;
    // Dorothy's notes, on stderr.
    write: (text: string) => void;
    // The dump, on stdout.
    print?: (text: string) => void;
    runtime?: (env: Env) => Promise<PiRuntime>;
    persona?: string;
    launchId?: () => string;
    signals?: Pick<NodeJS.EventEmitter, "on" | "off">;
};

const CLI_DIR = resolve(import.meta.dir, "../../..");
const EXTENSION = join(CLI_DIR, "assets/pi/index.ts");
// The skills she declares for Pi: none yet.
const SKILLS: readonly string[] = [];

// Pi 1.5.0's options that take the next word whatever it is, when there is
// one (dist/cli/args.js parseArgs).
const VALUED = new Set([
    "--provider",
    "--model",
    "--api-key",
    "--system-prompt",
    "--append-system-prompt",
    "--name",
    "-n",
    "--session",
    "--session-id",
    "--fork",
    "--session-dir",
    "--models",
    "--tools",
    "-t",
    "--exclude-tools",
    "-xt",
    "--thinking",
    "--export",
    "--extension",
    "-e",
    "--skill",
    "--prompt-template",
    "--theme",
]);
// Those that take it only when it is no option of its own.
const UNLESS_OPTION = new Set(["--mode", "--use-theme", "--tui-mode"]);

// What Dorothy sets herself, or would lose: refused, by name.
const REFUSED: Record<string, string> = {
    "--api-key": "her key comes from secrets.json",
    "--provider": "use dorothy --pi --model <provider:id>",
    "--model": "use dorothy --pi --model <provider:id>",
    "--session-dir": "her sessions stay below her session root",
    "--no-mcp": "her memory tools come through Pi's MCP",
};

type PiArgs = {
    // --session and --fork values, each with its option.
    sessions: { option: string; value: string }[];
    help: boolean;
    private: boolean;
};

// Whether an option takes the next word as its value, as Pi decides.
function takesValue(option: string, next: string | undefined): boolean {
    if (next === undefined) return false;
    if (VALUED.has(option)) return true;
    if (UNLESS_OPTION.has(option)) return !next.startsWith("-");
    if (option === "--print" || option === "-p") {
        return (
            !next.startsWith("@") &&
            (!next.startsWith("-") || next.startsWith("---"))
        );
    }
    if (option === "--list-models") {
        return !next.startsWith("-") && !next.startsWith("@");
    }
    // An extension's flag, unknown to Pi, takes a plain word. One after
    // Pi's own switches is a message instead, which holds nothing read
    // here, so the two need no telling apart.
    if (option.startsWith("--") && !option.includes("=")) {
        return !next.startsWith("-") && !next.startsWith("@");
    }
    return false;
}

// Pi's arguments read as Pi reads them, or the problem with them.
export function readPiArgs(args: readonly string[]): PiArgs | string {
    const read: PiArgs = { sessions: [], help: false, private: false };
    for (let i = 0; i < args.length; i++) {
        const word = args[i] as string;
        if (word === "--") break;
        const name = word.startsWith("--")
            ? (word.split("=")[0] ?? word)
            : word;
        const reason = REFUSED[name];
        if (reason !== undefined) {
            return `--pi does not pass ${name} to pi: ${reason}`;
        }
        if (["--help", "-h", "--version", "-v"].includes(word))
            read.help = true;
        if (word === "--no-session") read.private = true;
        if (!takesValue(word, args[i + 1])) continue;
        i++;
        if (word === "--session" || word === "--fork") {
            read.sessions.push({ option: word, value: args[i] as string });
        }
    }
    return read;
}

// Whether a --session or --fork value names a file below the session root,
// resolved as Pi resolves it; an id is looked up there by Pi itself.
async function insideRoot(
    value: string,
    cwd: string,
    root: string,
    home: string,
): Promise<boolean> {
    if (!/[/\\]/.test(value) && !value.endsWith(".jsonl")) return true;
    let path = value;
    if (path === "~" || path.startsWith("~/")) path = join(home, path.slice(1));
    if (path.startsWith("file://")) {
        // A URL that names no local path is outside the root.
        try {
            path = fileURLToPath(path);
        } catch {
            return false;
        }
    }
    path = resolve(cwd, path);
    const within = (base: string, target: string) => {
        const rest = relative(base, target);
        return (
            rest !== "" &&
            rest !== ".." &&
            !rest.startsWith("../") &&
            !isAbsolute(rest)
        );
    };
    if (!within(root, path)) return false;
    // A link inside that leads out is as outside.
    const real = await realpath(path)
        .catch(async () => join(await realpath(dirname(path)), basename(path)))
        .catch(() => null);
    return real !== null && within(await realpath(root), real);
}

const describe = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export async function runPi(options: PiOptions, deps: PiDeps): Promise<number> {
    const { write } = deps;
    const fail = (message: string) => {
        write(`dorothy: ${message}\n`);
        return 1;
    };
    const native = readPiArgs(options.args);
    if (typeof native === "string") {
        write(`dorothy: ${native}\n`);
        return 2;
    }
    const shell = userShell(deps.env);
    const env = shell.env;
    let cwd: string;
    try {
        cwd = await realpath(shell.cwd ?? deps.cwd);
    } catch {
        return fail(`pi_cwd: ${shell.cwd ?? deps.cwd}`);
    }
    const root = piSessionRoot(env);
    for (const { option, value } of native.sessions) {
        if (!(await insideRoot(value, cwd, root, env.HOME ?? ""))) {
            const shown = await realpath(root).catch(() => root);
            write(`dorothy: ${option} must name a session below ${shown}\n`);
            return 2;
        }
    }

    let selection: ReturnType<typeof selectPiModel>;
    try {
        const routing = await deps.loadRouting();
        selection = selectPiModel(
            routing.routes.chat,
            options.model,
            await readPiCatalog(),
        );
    } catch (error) {
        return fail(describe(error));
    }
    const { entry, models } = selection;
    const keyName = entry.key;
    if (keyName === null || reservedKey(keyName)) {
        return fail(`pi_key_name: ${label(entry)} needs a key of its own`);
    }
    write(`dorothy: Pi on ${label(entry)}\n`);

    const passed = passedEnv(env);
    passed.PATH = await nodePath(passed.PATH ?? "");
    let runtime: PiRuntime;
    try {
        runtime = await (
            deps.runtime ?? ((at: Env) => resolvePiRuntime(CLI_DIR, at))
        )(passed);
    } catch (error) {
        return fail(describe(error));
    }

    // The key alone, from a loader environment of its own: the caller's
    // value of that name, else secrets.json's.
    let key: string | null = null;
    if (!options.dump && !native.help) {
        const isolated: Env = {};
        if (env[keyName]) isolated[keyName] = env[keyName];
        await deps.loadSecrets(isolated);
        key = isolated[keyName] || null;
        if (key === null) {
            return fail(
                `pi_key_missing: ${keyName} is in neither secrets.json nor the environment`,
            );
        }
    }

    const launchId = (deps.launchId ?? randomUUID)();
    const manifest: PiLaunchManifest = {
        version: 1,
        launchId,
        cwd,
        self: [...deps.self],
        entry,
        models,
        extensions: [EXTENSION],
        skills: [...SKILLS],
        helperEnv: helperEnvOf(passed, env),
    };
    let profile: PiProfile;
    try {
        profile = await preparePiProfile({
            env,
            cwd,
            launchId,
            persona: deps.persona ?? identityPrompt(),
            manifest,
        });
    } catch (error) {
        return fail(describe(error));
    }
    // The dump names the key's variable; it loads no value.
    const pair: [string, string] | null =
        key !== null ? [keyName, key] : options.dump ? [keyName, ""] : null;
    try {
        return await launch(options, deps, {
            runtime,
            profile,
            manifest,
            cwd,
            env: piEnvOf(passed, {
                agentDir: profile.agentDir,
                manifestPath: profile.manifestPath,
                key: pair,
            }),
            native,
        });
    } finally {
        await profile.cleanup();
    }
}

async function launch(
    options: PiOptions,
    deps: PiDeps,
    run: {
        runtime: PiRuntime;
        profile: PiProfile;
        manifest: PiLaunchManifest;
        cwd: string;
        env: Env;
        native: PiArgs;
    },
): Promise<number> {
    const { profile, manifest, native } = run;
    const { entry } = manifest;
    // Help and the version need no model: her extension, which would ask
    // for the key, stays out, and so does anything discovered.
    const cmd = native.help
        ? [
              ...run.runtime.command,
              "--offline",
              ...piProfileArgs(profile, {
                  ...manifest,
                  extensions: [],
                  skills: [],
              }),
              ...options.args,
          ]
        : [
              ...run.runtime.command,
              "--offline",
              ...piProfileArgs(profile, manifest),
              "--model",
              `${entry.provider}/${entry.model}`,
              ...options.args,
          ];
    if (options.dump) {
        const print = deps.print ?? ((text) => process.stdout.write(text));
        const dump = {
            command: cmd,
            cwd: run.cwd,
            env: names(run.env),
            helperEnv: names(manifest.helperEnv),
            mcpServers: profile.mcpServers,
        };
        print(`${JSON.stringify(dump, null, 2)}\n`);
        return 0;
    }
    // Before Pi asks to trust a project: what would join her loadout.
    for (const server of profile.mcpServers) {
        deps.write(
            `dorothy: Pi will also connect the ${server.source} MCP server ${server.name}, outside her tested loadout\n`,
        );
    }
    if (native.private) {
        deps.write("dorothy: --no-session: this launch is not recorded\n");
    }
    try {
        return await runForwarding(
            deps.spawn,
            cmd,
            run.env,
            deps.signals ?? process,
            run.cwd,
        );
    } catch (error) {
        const code = (error as NodeJS.ErrnoException | null)?.code;
        deps.write(`dorothy: Pi could not start (${code ?? "unknown"})\n`);
        return 1;
    }
}
