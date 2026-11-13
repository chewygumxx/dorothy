// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/hosts/pi/delivery-testing.ts
//
//

// What the delivery fixtures and probe share beyond testing.ts: Dorothy's
// memory service run on private roots (her real service, holding nothing
// but what a fixture says), `dorothy --pi` in a terminal of its own
// (native-launch.ts under a pseudo-terminal), the real `--pi-hook`,
// `--mcp` and `--sweep` of this checkout, and the archive they leave.
// Nothing here reads secrets.json or a real root: `--serve`, which would,
// is never started; the service runs from its entry point instead.

import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Env, SERVICE_PATHS } from "@dorothy/core";
import type { NativePlan } from "./native-launch.js";
import { CLI_DIR, type Roots } from "./testing.js";

export const INDEX = join(CLI_DIR, "src/index.ts");
const NATIVE_LAUNCH = join(CLI_DIR, "src/hosts/pi/native-launch.ts");
// This checkout's `dorothy`, as an install names it: Bun, no .env.
export const SELF = [process.execPath, "--no-env-file", INDEX];

// A free loopback port, for the service's config.toml.
function freePort(): number {
    const probe = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => new Response(""),
    });
    const { port } = probe;
    probe.stop(true);
    if (port === undefined) throw new Error("fixture: no free port");
    return port;
}

// The roots' environment for a real terminal and the given service, with
// nothing of Pi's own set: the launcher sets what Pi needs.
export function deliveryEnv(roots: Roots, memoryUrl: string): Env {
    const { PI_OFFLINE, PI_CODING_AGENT_DIR, ...env } = roots.env;
    return {
        ...env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        DOROTHY_MEMORY_URL: memoryUrl,
        // Bun's transpiler cache would keep testing.ts, synthetic key and
        // all, below the roots' cache.
        BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
    };
}

export type MemoryService = {
    url: string;
    log(): string;
    stop(): Promise<void>;
};

// Her memory service on the roots, through `@dorothy/memory/service` as
// `--serve` runs it but with no secrets loaded and reviews off. Pi is
// swept once, at its start, so a later session is new to it; the long
// interval leaves every later sweep to the fixture.
export async function startMemoryService(roots: Roots): Promise<MemoryService> {
    const port = freePort();
    await writeFile(
        join(roots.root, "config", "dorothy", "config.toml"),
        [
            "[service]",
            `port = ${port}`,
            "",
            "[recording]",
            'hosts = ["pi"]',
            "sweep-seconds = 86400",
            "",
        ].join("\n"),
    );
    const url = `http://127.0.0.1:${port}`;
    const entry = Bun.resolveSync(
        "@dorothy/memory/service",
        join(CLI_DIR, "src"),
    );
    const code = [
        `const { runService } = await import(${JSON.stringify(entry)});`,
        "process.exit(await runService({ env: process.env, review: null,",
        '    noReviews: "fixture" }));',
    ].join("\n");
    const child = Bun.spawn([process.execPath, "--no-env-file", "-e", code], {
        cwd: roots.root,
        env: deliveryEnv(roots, url),
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
    });
    let log = "";
    const reading = (async () => {
        for await (const part of child.stderr)
            log += new TextDecoder().decode(part);
    })();
    for (let tries = 0; ; tries++) {
        const up = await fetch(`${url}${SERVICE_PATHS.health}`)
            .then((response) => response.ok)
            .catch(() => false);
        if (up) break;
        if (tries > 100 || child.exitCode !== null) {
            child.kill("SIGKILL");
            throw new Error(`fixture: memory service down: ${log}`);
        }
        await Bun.sleep(100);
    }
    return {
        url,
        log: () => log,
        stop: async () => {
            child.kill("SIGTERM");
            await child.exited;
            await reading;
        },
    };
}

// Text as a terminal would show it, less its control sequences: OSC,
// CSI, character-set and keypad selections.
const CONTROL =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
    /\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b[()][A-Z0-9]|\x1b[=>78]/g;
export const plain = (text: string) => text.replace(CONTROL, "");

export const KEYS = {
    enter: "\r",
    escape: "\x1b",
    up: "\x1b[A",
    down: "\x1b[B",
} as const;

export type NativePi = {
    // Everything drawn so far, as plain text.
    screen(): string;
    // Where the screen has reached, to wait for what comes after.
    mark(): number;
    waitFor(text: string, since?: number, ms?: number): Promise<void>;
    type(text: string): void;
    // A line typed and sent, once the editor shows it.
    send(text: string): Promise<void>;
    exited: Promise<number>;
    // The launcher's process group, killed as a closed terminal would
    // leave it, before anything of hers can catch up.
    // Safe to call again, or once it has exited.
    kill(): Promise<void>;
};

// `dorothy --pi -- <args>` in a pseudo-terminal of its own, its every
// dependency injected (native-launch.ts), with the given `dorothy`.
export async function launchNative(
    roots: Roots,
    plan: Omit<NativePlan, "cwd"> & { cwd?: string },
): Promise<NativePi> {
    const path = join(roots.root, `plan-${crypto.randomUUID()}.json`);
    const full: NativePlan = { cwd: roots.project, ...plan };
    await writeFile(path, JSON.stringify(full), { mode: 0o600 });
    let raw = "";
    const decoder = new TextDecoder();
    const child = Bun.spawn(
        [process.execPath, "--no-env-file", NATIVE_LAUNCH, path],
        {
            cwd: full.cwd,
            env: plan.env,
            terminal: {
                cols: 120,
                rows: 40,
                data(_terminal, data) {
                    raw += decoder.decode(data, { stream: true });
                },
            },
        },
    );
    const screen = () => plain(raw);
    const waitFor = async (text: string, since = 0, ms = 20_000) => {
        const deadline = Date.now() + ms;
        while (!screen().slice(since).includes(text)) {
            if (Date.now() > deadline)
                throw new Error(
                    `fixture: "${text}" never shown; the screen ends:\n${screen().slice(-1500)}`,
                );
            if (child.exitCode !== null && !screen().includes(text))
                throw new Error(
                    `fixture: Pi exited (${child.exitCode}) before "${text}":\n${screen().slice(-1500)}`,
                );
            await Bun.sleep(50);
        }
    };
    const type = (text: string) => {
        child.terminal?.write(text);
    };
    return {
        screen,
        mark: () => screen().length,
        waitFor,
        type,
        async send(text) {
            const at = screen().length;
            type(text);
            // As the editor shows it, wrapped at the terminal's width.
            const squash = (value: string) => value.replace(/\s+/g, "");
            const deadline = Date.now() + 20_000;
            while (!squash(screen().slice(at)).includes(squash(text))) {
                if (Date.now() > deadline || child.exitCode !== null)
                    throw new Error(`fixture: "${text}" never typed`);
                await Bun.sleep(50);
            }
            type(KEYS.enter);
        },
        exited: child.exited.then(async (code) => {
            await rm(path, { force: true });
            return code;
        }),
        async kill() {
            // The group may be gone already: a kill after it is no fault.
            try {
                process.kill(-child.pid, "SIGKILL");
            } catch {}
            await child.exited;
        },
    };
}

// `dorothy --sweep` of this checkout on the roots: its output and code.
export async function sweepOnce(
    env: Env,
): Promise<{ code: number; out: string; err: string }> {
    const child = Bun.spawn([...SELF, "--sweep"], {
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    return { code, out, err };
}

// Her archive on the roots: each conversation's header and events.
export type Conversation = {
    file: string;
    // Its session lines, the first and any a resume added.
    headers: Record<string, unknown>[];
    events: Record<string, unknown>[];
};
export async function archive(env: Env): Promise<Conversation[]> {
    const dir = join(env.XDG_DATA_HOME ?? "", "dorothy", "transcripts");
    const names = (await readdir(dir).catch(() => [] as string[]))
        .filter((name) => name.endsWith(".jsonl"))
        .sort();
    const found: Conversation[] = [];
    for (const name of names) {
        const lines = (await readFile(join(dir, name), "utf8"))
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Record<string, unknown>);
        found.push({
            file: name,
            headers: lines.filter((line) => line.kind === "session"),
            events: lines.filter((line) => line.kind !== "session"),
        });
    }
    return found;
}
