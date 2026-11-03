// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/profile.ts
//
//

import {
    chmod,
    link,
    lstat,
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    unlink,
    writeFile,
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { type Env, xdgDir } from "@dorothy/core";
import { type PiLaunchManifest, sessionDirFor } from "./models.js";

// A server some Pi MCP file names, which Pi would connect.
export type PiMcpServer = { source: "profile" | "project"; name: string };

export type PiProfile = {
    // The dedicated agent directory, which the user's Pi settings,
    // keybindings and trust decisions live in.
    agentDir: string;
    // Where this working directory's sessions are saved.
    sessionDir: string;
    // This launch's private files; cleanup removes only this.
    launchDir: string;
    manifestPath: string;
    personaPath: string;
    // The servers the profile's and the project's static MCP files name,
    // read as data for the launcher to show before project trust.
    mcpServers: PiMcpServer[];
    cleanup(): Promise<void>;
};

const MARKER = "dorothy-owner.json";
const OWNER = { owner: "dorothy", kind: "pi-profile", version: 1 };
const TEMPORARY = ".owner-";
const MEMORY_SERVER = "dorothy_memory";
const LAUNCH_ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const failure = (code: string, path: string) => new Error(`${code}: ${path}`);
const isMissing = (error: unknown) =>
    (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
const isExisting = (error: unknown) =>
    (error as NodeJS.ErrnoException | null)?.code === "EEXIST";

// Whether the directory holds Dorothy's marker; a marker that is anything
// else is refused. Written once, by publishing a finished file.
async function marked(agentDir: string): Promise<boolean> {
    const path = join(agentDir, MARKER);
    let text: string;
    try {
        text = await readFile(path, "utf8");
    } catch (error) {
        if (isMissing(error)) return false;
        throw failure("pi_profile_unowned", agentDir);
    }
    try {
        const value = JSON.parse(text) as Record<string, unknown>;
        if (
            value.owner === OWNER.owner &&
            value.kind === OWNER.kind &&
            value.version === OWNER.version
        ) {
            return true;
        }
    } catch {}
    throw failure("pi_profile_unowned", agentDir);
}

// The agent directory is Dorothy's to use when it carries her marker or is
// empty to begin with. link fails where the marker exists, so of several
// first launches one publishes it and the rest find it.
async function claim(agentDir: string): Promise<void> {
    await mkdir(agentDir, { recursive: true, mode: 0o700 });
    if (await marked(agentDir)) return;
    const entries = (await readdir(agentDir)).filter(
        (name) => !name.startsWith(TEMPORARY),
    );
    if (entries.length > 0) {
        if (await marked(agentDir)) return;
        throw failure("pi_profile_unowned", agentDir);
    }
    const temporary = join(agentDir, `${TEMPORARY}${crypto.randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(OWNER)}\n`, {
        mode: 0o600,
        flag: "wx",
    });
    try {
        await link(temporary, join(agentDir, MARKER));
    } catch (error) {
        if (!isExisting(error)) throw error;
    } finally {
        await unlink(temporary).catch(() => {});
    }
    if (!(await marked(agentDir)))
        throw failure("pi_profile_unowned", agentDir);
}

// $XDG_RUNTIME_DIR/dorothy, or else a directory of the user's own under the
// temporary directory, as the Claude launcher's private files (claude.ts
// privateWriter), made once and checked to be the user's own.
async function runtimeDir(env: Env): Promise<string> {
    const uid = process.getuid?.() ?? 0;
    const runtime = env.XDG_RUNTIME_DIR ?? "";
    const dir = isAbsolute(runtime)
        ? join(runtime, "dorothy")
        : join(env.TMPDIR || "/tmp", `dorothy-${uid}`);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const info = await lstat(dir);
    if (!info.isDirectory() || info.uid !== uid) {
        throw new Error(`${dir} is not a directory of your own`);
    }
    await chmod(dir, 0o700);
    return dir;
}

// A finished file or none: written under another name, then renamed.
async function publish(path: string, text: string): Promise<void> {
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    try {
        await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
        await rename(temporary, path);
    } catch (error) {
        await unlink(temporary).catch(() => {});
        throw error;
    }
}

// The server names an MCP file holds, read as data and never run. A file
// Pi would skip as invalid names none. Pi 1.5.0 reads user servers from
// <agent dir>/mcp.json and project servers from <cwd>/.pi/mcp.json under
// "mcpServers" (docs/mcp.md), where names differing only in - and _ are one.
async function serversIn(path: string): Promise<string[]> {
    try {
        const value = JSON.parse(await readFile(path, "utf8")) as {
            mcpServers?: unknown;
        };
        const servers = value?.mcpServers;
        if (!servers || typeof servers !== "object" || Array.isArray(servers)) {
            return [];
        }
        return Object.keys(servers);
    } catch {
        return [];
    }
}

// Every server the profile's and the project's files name; Dorothy's own
// name taken by either is refused, as Pi would let the file override it.
async function inspectMcp(agentDir: string, cwd: string) {
    const files = [
        { source: "profile", path: join(agentDir, "mcp.json") },
        { source: "project", path: join(cwd, ".pi", "mcp.json") },
    ] as const;
    const found: PiMcpServer[] = [];
    for (const { source, path } of files) {
        for (const name of await serversIn(path)) {
            if (name.replaceAll("-", "_") === MEMORY_SERVER) {
                throw failure("pi_mcp_collision", path);
            }
            found.push({ source, name });
        }
    }
    return found;
}

// A launch's private files below Dorothy's runtime directory, and the
// profile Pi runs in. The agent directory and the sessions are the user's:
// cleanup leaves them, and nothing here rewrites what a user set there.
export async function preparePiProfile(input: {
    env: Env;
    cwd: string;
    launchId: string;
    persona: string;
    manifest: PiLaunchManifest;
}): Promise<PiProfile> {
    const { env, cwd, launchId, persona, manifest } = input;
    if (!LAUNCH_ID.test(launchId)) throw failure("pi_launch_id", launchId);
    if (manifest.launchId !== launchId || manifest.cwd !== cwd) {
        throw failure("pi_manifest_mismatch", launchId);
    }
    const agentDir = join(
        xdgDir(env, "XDG_CONFIG_HOME", ".config"),
        "dorothy",
        "pi",
    );
    const sessionDir = join(
        xdgDir(env, "XDG_DATA_HOME", ".local/share"),
        "dorothy",
        "pi",
        "sessions",
        sessionDirFor(cwd),
    );
    await claim(agentDir);
    const mcpServers = await inspectMcp(agentDir, cwd);
    await mkdir(sessionDir, { recursive: true, mode: 0o700 });
    const launchDir = join(await runtimeDir(env), `pi-${launchId}`);
    try {
        await mkdir(launchDir, { mode: 0o700 });
    } catch (error) {
        throw isExisting(error) ? failure("pi_launch_exists", launchId) : error;
    }
    const cleanup = () => rm(launchDir, { recursive: true, force: true });
    const personaPath = join(launchDir, "persona.md");
    const manifestPath = join(launchDir, "manifest.json");
    try {
        await publish(personaPath, persona);
        await publish(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    } catch (error) {
        await cleanup();
        throw error;
    }
    return {
        agentDir,
        sessionDir,
        launchDir,
        manifestPath,
        personaPath,
        mcpServers,
        cleanup,
    };
}

// The arguments that give Pi this profile's sessions and only the resources
// Dorothy declares: discovered extensions and skills off, Pi's built-in MCP
// kept, then her extensions and skills by path. The agent directory is
// PI_CODING_AGENT_DIR, which the launcher sets with the rest of the
// environment.
export function piProfileArgs(
    profile: PiProfile,
    manifest: PiLaunchManifest,
): string[] {
    return [
        "--session-dir",
        profile.sessionDir,
        "--no-extensions",
        "--no-skills",
        "-e",
        "builtin:mcp",
        ...manifest.extensions.flatMap((path) => ["-e", path]),
        ...manifest.skills.flatMap((path) => ["--skill", path]),
    ];
}
