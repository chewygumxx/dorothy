// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/codex.ts
//
//

// dorothy --codex: Codex, with Dorothy's persona, tools and hooks given
// as session flags before the user's own. Nothing of Codex's is written;
// Codex asks the user, once, to trust her hooks, and keeps that itself.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Env } from "@dorothy/core";
import { identityPrompt } from "@dorothy/identity";
import {
    type Spawned,
    selfCommand,
    shellWord,
    spawnInherited,
} from "../self.js";

const CODEX = "codex";
const SERVER = "dorothy";

// A TOML basic string: JSON's escapes are TOML's for these characters.
const toml = (text: string) => JSON.stringify(text);
const tomlArray = (words: readonly string[]) =>
    `[${words.map(toml).join(",")}]`;

const hook = (self: readonly string[], event: string) =>
    `[{hooks=[{type="command",command=${toml(
        [...self, "--hook", "codex", event].map(shellWord).join(" "),
    )}}]}]`;

export function codexArgs(options: {
    self: readonly string[];
    persona: string;
    theirs: string | null;
}): string[] {
    const { self, persona, theirs } = options;
    const instructions = theirs === null ? persona : `${persona}\n\n${theirs}`;
    const set = [
        `developer_instructions=${toml(instructions)}`,
        `mcp_servers.${SERVER}.command=${toml(self[0] ?? "")}`,
        `mcp_servers.${SERVER}.args=${tomlArray([
            ...self.slice(1),
            "--mcp",
            "--host",
            "codex",
        ])}`,
        `hooks.SessionStart=${hook(self, "session-start")}`,
        `hooks.UserPromptSubmit=${hook(self, "prompt")}`,
        "memories.use_memories=false",
        "memories.generate_memories=false",
    ];
    return ["--enable", "hooks", ...set.flatMap((flag) => ["-c", flag])];
}

// The user's own developer_instructions, which a session flag would
// otherwise replace: the last config holding one, as Codex lets the
// project's override the user's; null for none, or for a file that
// does not parse.
export function userInstructions(...configs: (string | null)[]): string | null {
    let found: string | null = null;
    for (const config of configs) {
        if (config === null) {
            continue;
        }
        try {
            const value = (Bun.TOML.parse(config) as Record<string, unknown>)
                .developer_instructions;
            if (typeof value === "string" && value !== "") {
                found = value;
            }
        } catch {}
    }
    return found;
}

export type CodexDeps = {
    env?: Env;
    cwd?: string;
    which?: (command: string, options: { PATH: string }) => string | null;
    // The user's config.toml and the project's, either null.
    readConfigs?: (env: Env, cwd: string) => Promise<(string | null)[]>;
    // `codex --version`'s version, or null.
    version?: (codex: string) => string | null;
    spawn?: (cmd: string[], env: Env) => Spawned;
    write?: (text: string) => void;
    signals?: Pick<NodeJS.EventEmitter, "on" | "off">;
    self?: readonly string[];
    persona?: string;
};

const codexHome = (env: Env) =>
    env.CODEX_HOME || join(env.HOME || homedir(), ".codex");

const readText = (path: string) => readFile(path, "utf8").catch(() => null);

const readCodexConfigs = async (env: Env, cwd: string) => [
    await readText(join(codexHome(env), "config.toml")),
    await readText(join(cwd, ".codex", "config.toml")),
];

const codexVersion = (codex: string): string | null => {
    const run = Bun.spawnSync([codex, "--version"], { stderr: "ignore" });
    return run.stdout.toString().match(/\d+\.\d+\.\d+/)?.[0] ?? null;
};

const stateDir = (env: Env) =>
    join(
        env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local/state"),
        "dorothy",
    );

export async function codexCommand(
    args: readonly string[],
    deps: CodexDeps = {},
): Promise<string[] | null> {
    const {
        env = process.env,
        cwd = process.cwd(),
        which = Bun.which,
        readConfigs = readCodexConfigs,
        write = (text) => process.stderr.write(text),
        self = selfCommand(),
        persona = identityPrompt(),
    } = deps;
    const codex = which(CODEX, { PATH: env.PATH ?? "" });
    if (codex === null) {
        write("dorothy: codex is not on PATH\n");
        return null;
    }
    const theirs = userInstructions(...(await readConfigs(env, cwd)));
    return [codex, ...codexArgs({ self, persona, theirs }), ...args];
}

// Codex asks the user to trust a hook whose command it has not seen:
// said before the first session, and again when her command changes.
async function noteTrust(
    env: Env,
    self: readonly string[],
    write: (text: string) => void,
): Promise<void> {
    const path = join(stateDir(env), "codex-hooks.digest");
    const digest = Bun.hash(self.join("\0")).toString(16);
    if ((await readText(path))?.trim() === digest) {
        return;
    }
    write(
        "dorothy: Codex will ask you to trust her two hooks; trust them for her memory.\n",
    );
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, `${digest}\n`);
}

// The terminal sends SIGINT to the whole foreground group, codex
// included: forwarding it would send codex a second, which it may read
// as a request to quit. TERM, and HUP from anything but a hangup, can
// reach dorothy alone, so codex is told; after a hangup it gets HUP
// twice, which does no harm.
const FORWARDED = ["SIGTERM", "SIGHUP"] as const;

export async function runCodex(
    args: readonly string[],
    deps: CodexDeps = {},
): Promise<number> {
    const {
        env = process.env,
        spawn = spawnInherited,
        version = codexVersion,
        write = (text) => process.stderr.write(text),
        signals = process,
        self = selfCommand(),
    } = deps;
    const command = await codexCommand(args, deps);
    if (command === null) {
        return 1;
    }
    const { loadProfiles } = await import("@dorothy/memory/host-hook");
    const checked = (await loadProfiles()).get("codex")?.checked ?? [];
    const running = version(command[0] ?? "");
    if (running !== null && !checked.includes(running)) {
        write(
            `dorothy: Codex ${running} is not one her profile was checked against (${checked.join(", ")})\n`,
        );
    }
    await noteTrust(env, self, write);
    const ignore = () => {};
    const handlers: (readonly [NodeJS.Signals, () => void])[] = [];
    try {
        const child = spawn(command, env);
        signals.on("SIGINT", ignore);
        for (const signal of FORWARDED) {
            const handler = () => child.kill(signal);
            handlers.push([signal, handler]);
            signals.on(signal, handler);
        }
        return await child.exited;
    } finally {
        signals.off("SIGINT", ignore);
        for (const [signal, handler] of handlers) {
            signals.off(signal, handler);
        }
    }
}
