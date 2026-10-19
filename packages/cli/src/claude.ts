// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/claude.ts
//
//

import { spawn as spawnChild } from "node:child_process";
import {
    chmodSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
    CLAUDE_ALLOWED_TOOLS,
    CLAUDE_SERVER_NAME,
    type Config,
    type Env,
    isUuid,
    readConfig,
} from "@dorothy/core";
import {
    type Gateway,
    MARKER,
    startGateway,
    upstreamFrom,
} from "@dorothy/gateway";
// A type, erased: the CLI still loads memory lazily.
import type { LaunchNote } from "@dorothy/memory";

export type Spawned = {
    exited: Promise<number>;
    kill: (signal?: NodeJS.Signals) => void;
};

export type ClaudeDeps = {
    env?: Env;
    which?: (command: string, options: { PATH: string }) => string | null;
    startGateway?: (options: { upstream: string; section: string }) => Gateway;
    spawn?: (cmd: string[], env: Env, cwd?: string) => Spawned;
    write?: (text: string) => void;
    signals?: Pick<NodeJS.EventEmitter, "on" | "off">;
    config?: (env: Env) => Promise<{ config: Config; warnings: string[] }>;
    memory?: ClaudeMemory;
    // Where dorothy runs; claude starts there unless a package script
    // says otherwise.
    cwd?: string;
    // This program as a command, as claude starts the recall server.
    self?: readonly string[];
    // Reads a file the user's own --settings names.
    read?: (path: string) => string;
    // Writes text to a new file only the user can read, and says where.
    writePrivate?: (text: string) => string;
    // Removes a file writePrivate made.
    remove?: (path: string) => void;
    // Starts a process that outlives dorothy and the terminal, for a
    // catch-up.
    spawnDetached?: (cmd: string[]) => void;
    // A new uuid, for a launch and a new session.
    newId?: () => string;
    now?: () => Date;
};

// A new file of mode 0600 in $XDG_RUNTIME_DIR/dorothy, or else in a
// directory of mode 0700 of the user's own under the temporary directory.
export function privateWriter(env: Env): (text: string) => string {
    return (text) => {
        const uid = process.getuid?.() ?? 0;
        const dir =
            env.XDG_RUNTIME_DIR === undefined || env.XDG_RUNTIME_DIR === ""
                ? join(env.TMPDIR || "/tmp", `dorothy-${uid}`)
                : join(env.XDG_RUNTIME_DIR, "dorothy");
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        const info = lstatSync(dir);
        if (!info.isDirectory() || info.uid !== uid) {
            throw new Error(`${dir} is not a directory of your own`);
        }
        chmodSync(dir, 0o700);
        const path = join(dir, `settings-${crypto.randomUUID()}.json`);
        writeFileSync(path, text, { mode: 0o600, flag: "wx" });
        return path;
    };
}

// The terminal sends SIGINT to the whole foreground group, claude
// included: forwarding it would send claude a second, which it reads as
// a request to quit. TERM, and HUP from anything but a hangup, can reach
// dorothy alone, so claude is told; after a hangup it gets HUP twice,
// which does no harm.
const FORWARDED = ["SIGTERM", "SIGHUP"] as const;

// What --claude asks of memory, loaded only when it is asked.
export type ClaudeMemory = {
    // Chat's memory block, rendered by chat's code, leaving out the
    // conversation of the session the arguments resume by id; "" for
    // none.
    block(
        env: Env,
        session: string | null,
    ): Promise<{ block: string; warnings: string[] }>;
    // Syncs the project of a directory, if it is in one: null, or why
    // the sync failed.
    sync(dir: string, env: Env): Promise<string | null>;
    // Notes the launch, for its hooks, its recall server and its
    // catch-up.
    note(note: Omit<LaunchNote, "v">, env: Env): Promise<void>;
    // The launches whose dorothy is gone, left to catch up.
    stale(env: Env): Promise<string[]>;
    // What hooks could not tell, and the lines left unread.
    notices(env: Env): Promise<string[]>;
};

const MEMORY: ClaudeMemory = {
    block: async (env, session) =>
        (await import("@dorothy/memory")).claudeBlock({ env, session }),
    sync: async (dir, env) =>
        (await import("@dorothy/memory")).syncDirectory(dir, { env }),
    note: async (note, env) =>
        (await import("@dorothy/memory")).noteLaunch(env, note),
    stale: async (env) => (await import("@dorothy/memory")).staleLaunches(env),
    notices: async (env) => (await import("@dorothy/memory")).startNotices(env),
};

const APPEND = "--append-system-prompt";

// claude's argument at index as a flag and its value: a long flag's
// --flag=value holds its own, one word; otherwise the value is the next
// word, if any, two.
function flagAt(
    args: readonly string[],
    index: number,
): { flag: string; value: string | undefined; words: 1 | 2 } {
    const word = args[index] as string;
    const equals = word.startsWith("--") ? word.indexOf("=") : -1;
    return equals === -1
        ? { flag: word, value: args[index + 1], words: 2 }
        : {
              flag: word.slice(0, equals),
              value: word.slice(equals + 1),
              words: 1,
          };
}

// The arguments claude is run with: the marker appended to its system
// prompt, then the user's. Claude Code keeps only the last
// --append-system-prompt it is given, so the user's own, if any, goes in
// the same one, before the marker; anything after -- is the user's alone.
export function claudeArgs(args: readonly string[]): string[] {
    let appended: string | undefined;
    const rest: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === "--") {
            rest.push(...args.slice(index));
            break;
        }
        const { flag, value, words } = flagAt(args, index);
        if (flag === APPEND && value !== undefined) {
            appended = value;
            index += words - 1;
        } else {
            rest.push(args[index] as string);
        }
    }
    const text = appended === undefined ? MARKER : `${appended}\n\n${MARKER}`;
    return [APPEND, text, ...rest];
}

// How claude's arguments start its session, from those before --.
export type ClaudeSession =
    // A new session, which Dorothy names with --session-id.
    | { kind: "new" }
    // The user named it with their own --session-id.
    | { kind: "named"; id: string }
    // Continued or resumed: by id where the arguments name one. A
    // malformed --session-id is here too; claude refuses it.
    | { kind: "resumed"; id: string | null };

const RESUMING: ReadonlySet<string> = new Set([
    "-c",
    "--continue",
    "-r",
    "--resume",
    "--from-pr",
]);

const uuidOf = (value: string | undefined) =>
    value !== undefined && isUuid(value) ? value : null;

export function claudeSession(args: readonly string[]): ClaudeSession {
    for (let index = 0; index < args.length; index += 1) {
        if (args[index] === "--") {
            break;
        }
        const { flag, value } = flagAt(args, index);
        const id = uuidOf(value);
        if (flag === "--session-id") {
            return id === null
                ? { kind: "resumed", id: null }
                : { kind: "named", id };
        }
        if (RESUMING.has(flag)) {
            return {
                kind: "resumed",
                id: flag === "-r" || flag === "--resume" ? id : null,
            };
        }
    }
    return { kind: "new" };
}

// SessionEnd's hook only hands its session to a detached catch-up.
export const END_TIMEOUT_S = 10;

// Claude Code runs a hook's command through a shell: each word quoted.
const shellWord = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;

// Dorothy's hooks, this program run again: after each reply, off its
// path (async), and at the session's end.
export function hookSettings(self: readonly string[]): Json {
    const command = [...self, "--claude-hook"].map(shellWord).join(" ");
    return {
        hooks: {
            Stop: [{ hooks: [{ type: "command", command, async: true }] }],
            SessionEnd: [
                {
                    hooks: [
                        { type: "command", command, timeout: END_TIMEOUT_S },
                    ],
                },
            ],
        },
    };
}

// Claude Code's config directory, under whose projects/ its transcripts
// are.
export const claudeConfigDir = (env: Env) =>
    env.CLAUDE_CONFIG_DIR || join(env.HOME || homedir(), ".claude");

// This program as a command: the interpreter and the entry script it
// was started with, so bun run dev records too. Claude Code runs hooks
// and servers in the user's project, whose .env Bun would load into
// their environment, a key of the project's among it, kept over
// Dorothy's by dotenvx: --no-env-file, for the recall server too.
const selfCommand = () => [
    process.execPath,
    "--no-env-file",
    resolve(process.argv[1] ?? ""),
];

// A process of its own session, which outlives dorothy and a terminal
// that hangs up.
function spawnDetached(cmd: string[]): void {
    const [command, ...rest] = cmd;
    if (command === undefined) {
        return;
    }
    spawnChild(command, rest, { detached: true, stdio: "ignore" })
        .on("error", () => {})
        .unref();
}

const SETTINGS = "--settings";
const MCP_CONFIG = "--mcp-config";
// The flags of which Claude Code keeps only the last it is given, as the
// delivery probe found: a user's own is merged into Dorothy's. Repeated
// --mcp-config flags accumulate, so the user's are passed as given.
const MERGED: ReadonlySet<string> = new Set([SETTINGS]);

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json =>
    typeof value === "object" && value !== null && !Array.isArray(value);
const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

// b merged into a: objects key by key, arrays joined without repeats,
// anything else b's.
export function mergeJson(a: Json, b: Json): Json {
    const out: Json = { ...a };
    for (const [key, value] of Object.entries(b)) {
        const before = out[key];
        out[key] =
            isJson(before) && isJson(value)
                ? mergeJson(before, value)
                : Array.isArray(before) && Array.isArray(value)
                  ? [...new Set([...before, ...value])]
                  : value;
    }
    return out;
}

const isInline = (value: string) => value.trimStart().startsWith("{");

// A flag's value as JSON: inline, or the file it names.
function jsonOf(
    value: string,
    cwd: string,
    read: (path: string) => string,
): Json | { problem: string } {
    try {
        const text = isInline(value)
            ? value
            : read(isAbsolute(value) ? value : resolve(cwd, value));
        const parsed: unknown = JSON.parse(text);
        return isJson(parsed) ? parsed : { problem: "it is not a JSON object" };
    } catch (error) {
        return { problem: describeError(error) };
    }
}

export type DorothyFlags = { settings: Json | null; mcpConfig: Json | null };

// Dorothy's --settings and --mcp-config, each in its = form so that a
// variadic flag never takes the user's prompt, before the user's
// arguments. A user's own value of a flag in MERGED is merged into it,
// Dorothy's keys winning; one that cannot be read is passed on after
// hers, with a warning. Anything after -- is the user's alone.
export function dorothyFlags(
    args: readonly string[],
    flags: DorothyFlags,
    {
        cwd,
        read,
        writePrivate,
    }: {
        cwd: string;
        read: (path: string) => string;
        writePrivate: (text: string) => string;
    },
): { args: string[]; warnings: string[]; files: string[] } {
    const merged = mergeTheirs(args, flags, { cwd, read });
    const front = frontFlags(merged, flags, writePrivate);
    return {
        args: [...front.args, ...merged.rest, ...front.passedOn],
        warnings: [...merged.warnings, ...front.warnings],
        files: front.files,
    };
}

// Dorothy's flags with the user's own merged in, and the user's arguments
// left: theirs where it could not be read, with a warning. filed holds
// each flag whose value was a file, as the user gave it.
type Merged = {
    values: Record<string, Json | null>;
    filed: string[][];
    rest: string[];
    warnings: string[];
};

function mergeTheirs(
    args: readonly string[],
    flags: DorothyFlags,
    { cwd, read }: { cwd: string; read: (path: string) => string },
): Merged {
    const values: Record<string, Json | null> = {
        [SETTINGS]: flags.settings,
        [MCP_CONFIG]: flags.mcpConfig,
    };
    const filed: string[][] = [];
    const rest: string[] = [];
    const warnings: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index] as string;
        if (arg === "--") {
            rest.push(...args.slice(index));
            break;
        }
        const { flag, value, words } = flagAt(args, index);
        const ours = MERGED.has(flag) ? (values[flag] ?? null) : null;
        if (ours === null || value === undefined) {
            rest.push(arg);
            continue;
        }
        // The flag as the user gave it, with its value.
        const given = args.slice(index, index + words);
        index += words - 1;
        const theirs = jsonOf(value, cwd, read);
        if ("problem" in theirs && typeof theirs.problem === "string") {
            rest.push(...given);
            warnings.push(
                `your ${flag} could not be read (${theirs.problem}); it is passed on as given, and may override Dorothy's`,
            );
            continue;
        }
        values[flag] = mergeJson(theirs as Json, ours);
        if (!isInline(value)) {
            filed.push(given);
        }
    }
    return { values, filed, rest, warnings };
}

// Dorothy's flags as claude takes them. What the user's --settings files
// held may be secret (an env block of tokens), and argv is readable by
// other users: a merge that includes a file goes to a private file,
// passed by path. Without one the secrets stay with the user's own
// flags, passed on as given, and Dorothy's settings go in alone.
type Front = {
    args: string[];
    passedOn: string[];
    warnings: string[];
    files: string[];
};

function frontFlags(
    { values, filed }: Merged,
    flags: DorothyFlags,
    writePrivate: (text: string) => string,
): Front {
    const front: Front = { args: [], passedOn: [], warnings: [], files: [] };
    const settings = values[SETTINGS] ?? null;
    if (settings !== null && filed.length > 0) {
        const written = writeSettings(settings, writePrivate);
        if ("path" in written) {
            front.files.push(written.path);
            front.args.push(`${SETTINGS}=${written.path}`);
        } else {
            front.passedOn.push(...filed.flat());
            front.warnings.push(
                `a private settings file could not be written (${written.problem}); your --settings is passed on as given, and may override Dorothy's`,
            );
            front.args.push(jsonFlag(SETTINGS, flags.settings));
        }
    } else if (settings !== null) {
        front.args.push(jsonFlag(SETTINGS, settings));
    }
    const mcpConfig = values[MCP_CONFIG] ?? null;
    if (mcpConfig !== null) {
        front.args.push(jsonFlag(MCP_CONFIG, mcpConfig));
    }
    return front;
}

const jsonFlag = (flag: string, value: Json | null) =>
    `${flag}=${JSON.stringify(value)}`;

// Settings that hold a user's file, written where only the user can read
// them: the path, or why it could not be written.
function writeSettings(
    settings: Json,
    writePrivate: (text: string) => string,
): { path: string } | { problem: string } {
    try {
        return { path: writePrivate(JSON.stringify(settings)) };
    } catch (error) {
        return { problem: describeError(error) };
    }
}

// The recall server as claude starts it: this program again, in the
// project claude starts in.
function recallServer(self: readonly string[], dir: string): Json {
    return {
        mcpServers: {
            [CLAUDE_SERVER_NAME]: {
                type: "stdio",
                command: self[0],
                args: [...self.slice(1), "--recall-server", "--project", dir],
            },
        },
    };
}

// Where claude runs and with what environment. A package script, such as
// `bun run dev -- --claude`, starts in this checkout with the script's
// variables set and node_modules/.bin first on PATH, for the directory
// it was run from and each above it down to /node_modules/.bin, behind
// Bun's node shim or the project's root. claude gets the directory and
// the PATH the user ran it from.
export function userShell(env: Env): { env: Env; cwd?: string } {
    if (env.npm_lifecycle_event === undefined) {
        return { env };
    }
    const shell: Env = {};
    for (const [name, value] of Object.entries(env)) {
        if (!name.startsWith("npm_")) {
            shell[name] = value;
        }
    }
    const path = (env.PATH ?? "").split(":");
    const end = path.indexOf("/node_modules/.bin");
    if (end !== -1) {
        shell.PATH = path.slice(end + 1).join(":");
    }
    const cwd = env.npm_config_local_prefix;
    return cwd === undefined ? { env: shell } : { env: shell, cwd };
}

const spawnInherited = (cmd: string[], env: Env, cwd?: string): Spawned =>
    Bun.spawn(cmd, {
        env,
        cwd,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
    });

// The user's own Claude Code, with Dorothy as its main agent: the gateway
// replaces the marker appended to its system prompt with her identity.
// Dorothy's .env is not loaded; claude signs in as it always does.
export type Launch = {
    cmd: string[];
    env: Env;
    cwd?: string;
    gateway: Gateway;
    // The launch noted for recording, caught up once claude exits; null
    // when nothing is recorded.
    launch: string | null;
    // Removes the private files the launch wrote; call it once claude
    // has exited.
    cleanup: () => void;
};

// --claude runs claude with everything; its dump takes the block alone,
// so it records nothing and starts no server.
export type LaunchPurpose = "run" | "dump";

// What running claude through the gateway needs, for --claude and its
// dump alike: claude from the user's PATH, the marker in its arguments,
// and a gateway in front of the upstream. With [memory] enabled, the
// project claude starts in is synced first, the memory block goes after
// her identity, and auto memory is off; with recall too, the recall
// server is offered as dorothy-memory, its tools allowed. A number is
// the exit code of a failure already reported.
export async function launchClaude(
    args: readonly string[],
    upstream: string,
    {
        env = process.env,
        which = (command, options) => Bun.which(command, options),
        startGateway: start = startGateway,
        write = (text) => {
            process.stderr.write(text);
        },
        config: loadConfig = readConfig,
        memory = MEMORY,
        cwd = process.cwd(),
        self = selfCommand(),
        newId = () => crypto.randomUUID(),
        now = () => new Date(),
        read = (path) => readFileSync(path, "utf8"),
        writePrivate = privateWriter(env),
        remove = (path) => rmSync(path, { force: true }),
    }: ClaudeDeps = {},
    purpose: LaunchPurpose = "run",
): Promise<Launch | number> {
    const shell = userShell(env);
    const claude = which("claude", { PATH: shell.env.PATH ?? "" });
    if (claude === null) {
        write("dorothy: claude is not on PATH\n");
        return 127;
    }
    const dir = shell.cwd ?? cwd;
    const { config, warnings } = await loadConfig(env);
    warnAll(warnings, write);
    const on = config.memory.enabled;
    // Its dump records nothing, so syncs nothing and notes no launch.
    const records = on && purpose === "run";
    if (records) {
        await syncProject(memory, dir, env, write);
    }
    const session = claudeSession(args);
    const section = on ? await memorySection(memory, env, session, write) : "";
    let gateway: Gateway;
    try {
        gateway = start({ upstream, section });
    } catch (error) {
        write(
            `dorothy: the gateway could not start: ${describeError(error)}\n`,
        );
        return 1;
    }
    const noted = records
        ? await noteLaunch(memory, env, write, {
              dir,
              session,
              claude: claudeConfigDir(shell.env),
              newId,
              now,
          })
        : null;
    const recall = records && config.memory.recall;
    // A new session gets the id Dorothy noted; a named one has its own.
    const named = session.kind === "new" ? noted?.session : undefined;
    const flagged = dorothyFlags(
        named === undefined ? args : [`--session-id=${named}`, ...args],
        {
            settings: launchSettings(recall, noted !== null, self),
            mcpConfig: recall ? recallServer(self, dir) : null,
        },
        { cwd: dir, read, writePrivate },
    );
    warnAll(flagged.warnings, write);
    const launch: Launch = {
        cmd: [claude, ...claudeArgs(flagged.args)],
        env: launchEnv(shell.env, env, gateway.url, on, noted?.launch ?? null),
        gateway,
        launch: noted?.launch ?? null,
        cleanup: () => removeAll(flagged.files, remove),
    };
    return shell.cwd === undefined ? launch : { ...launch, cwd: shell.cwd };
}

type Write = (text: string) => void;

function warnAll(warnings: readonly string[], write: Write): void {
    for (const warning of warnings) {
        write(`dorothy: ${warning}\n`);
    }
}

// Syncs the project claude starts in; a failure is told, not fatal.
async function syncProject(
    memory: ClaudeMemory,
    dir: string,
    env: Env,
    write: Write,
): Promise<void> {
    const failed = await memory.sync(dir, env).catch(describeError);
    if (failed !== null) {
        write(`dorothy: sync failed: ${failed}\n`);
    }
}

// Chat's memory block, the gateway's section after her identity; ""
// where it cannot be built, so claude starts without it.
async function memorySection(
    memory: ClaudeMemory,
    env: Env,
    session: ClaudeSession,
    write: Write,
): Promise<string> {
    try {
        const built = await memory.block(
            env,
            session.kind === "resumed" ? session.id : null,
        );
        warnAll(built.warnings, write);
        return built.block;
    } catch (error) {
        write(
            `dorothy: the memory block could not be built (${describeError(error)}); starting without it\n`,
        );
        return "";
    }
}

// The launch noted and the session it records: Dorothy's new id, the
// user's own, or undefined when resumed.
type NotedLaunch = { launch: string; session: string | undefined };

// Her sessions are recorded by hooks, under a launch noted before
// claude starts; a launch that cannot be noted records nothing, null.
async function noteLaunch(
    memory: ClaudeMemory,
    env: Env,
    write: Write,
    {
        dir,
        session,
        claude,
        newId,
        now,
    }: {
        dir: string;
        session: ClaudeSession;
        claude: string;
        newId: () => string;
        now: () => Date;
    },
): Promise<NotedLaunch | null> {
    const launch = newId();
    const named =
        session.kind === "new"
            ? newId()
            : session.kind === "named"
              ? session.id
              : undefined;
    try {
        await memory.note(
            {
                launch,
                pid: process.pid,
                started: now().toISOString(),
                dir,
                session: named ?? null,
                claude,
            },
            env,
        );
        return { launch, session: named };
    } catch (error) {
        write(
            `dorothy: this launch could not be noted (${describeError(error)}); its sessions will not be recorded\n`,
        );
        return null;
    }
}

// The settings Dorothy adds to claude's: recall's tools allowed, and
// the hooks that record a noted launch. null for none.
function launchSettings(
    recall: boolean,
    noted: boolean,
    self: readonly string[],
): Json | null {
    const settings: Json = {
        ...(recall
            ? { permissions: { allow: [...CLAUDE_ALLOWED_TOOLS] } }
            : {}),
        ...(noted ? hookSettings(self) : {}),
    };
    return Object.keys(settings).length > 0 ? settings : null;
}

// The environment claude runs in: the user's shell's, pointed at the
// gateway. The user's own base URL, which claude's hooks lose, goes on
// as DOROTHY_ANTHROPIC_BASE_URL for the reviews of the hook.
function launchEnv(
    shellEnv: Env,
    env: Env,
    url: string,
    on: boolean,
    noted: string | null,
): Env {
    const proxy = env.ANTHROPIC_BASE_URL;
    const launchEnv: Env = {
        ...shellEnv,
        ANTHROPIC_BASE_URL: url,
        ...(proxy === undefined || proxy === ""
            ? {}
            : { DOROTHY_ANTHROPIC_BASE_URL: proxy }),
        // Claude Code turns tool search off for a base URL not
        // Anthropic's; a user's own choice stands.
        ENABLE_TOOL_SEARCH: env.ENABLE_TOOL_SEARCH ?? "1",
        // remember is her one way to write a memory in her sessions.
        ...(on ? { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" } : {}),
        // Her hooks and her recall server find the launch by it.
        ...(noted === null ? {} : { DOROTHY_LAUNCH: noted }),
    };
    if (noted === null) {
        // A launch this one runs inside is not this one's.
        delete launchEnv.DOROTHY_LAUNCH;
    }
    if (proxy === undefined || proxy === "") {
        // Nor is its proxy.
        delete launchEnv.DOROTHY_ANTHROPIC_BASE_URL;
    }
    return launchEnv;
}

function removeAll(
    paths: readonly string[],
    remove: (path: string) => void,
): void {
    for (const path of paths) {
        try {
            remove(path);
        } catch {
            // A file already gone needs no removing.
        }
    }
}

export function warnDrift(
    { drift }: Gateway["stats"],
    write: (text: string) => void,
): void {
    if (drift > 0) {
        write(
            `dorothy: ${drift} ${drift === 1 ? "request" : "requests"} carried the identity marker but could not be rewritten; Claude Code may have changed how it sends its prompt\n`,
        );
    }
}

export async function runClaude(
    args: readonly string[],
    deps: ClaudeDeps = {},
): Promise<number> {
    const {
        env = process.env,
        spawn = spawnInherited,
        write = (text) => {
            process.stderr.write(text);
        },
        signals = process,
        memory = MEMORY,
        self = selfCommand(),
        spawnDetached: detach = spawnDetached,
    } = deps;
    const catchUp = (launch: string) =>
        detach([...self, "--claude-hook", "--catch-up", launch]);
    // Launches whose dorothy was killed before its catch-up, with memory
    // off too: their notes were written with it on.
    for (const launch of await memory.stale(env).catch(() => [])) {
        catchUp(launch);
    }
    // What hooks could not tell, and lines left unread, before claude
    // takes the terminal.
    for (const notice of await memory.notices(env).catch(() => [])) {
        write(`dorothy: ${notice}\n`);
    }
    const launch = await launchClaude(args, upstreamFrom(env), {
        ...deps,
        write,
        self,
    });
    if (typeof launch === "number") {
        return launch;
    }
    const child = spawn(launch.cmd, launch.env, launch.cwd);
    const ignore = () => {};
    const handlers = FORWARDED.map(
        (signal) => [signal, () => child.kill(signal)] as const,
    );
    signals.on("SIGINT", ignore);
    for (const [signal, handler] of handlers) {
        signals.on(signal, handler);
    }
    try {
        return await child.exited;
    } finally {
        signals.off("SIGINT", ignore);
        for (const [signal, handler] of handlers) {
            signals.off(signal, handler);
        }
        launch.gateway.stop();
        launch.cleanup();
        warnDrift(launch.gateway.stats, write);
        // Its sessions recorded, synced and reviewed as SessionEnd would,
        // by a process that outlives this one.
        if (launch.launch !== null) {
            catchUp(launch.launch);
        }
    }
}
