// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/launch.test.ts
//
//

import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import {
    mkdir,
    readdir,
    readFile,
    realpath,
    symlink,
    writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { Env, RouteEntry, Routing } from "@dorothy/core";
import { type PiDeps, type PiOptions, runPi } from "./launch.js";
import { type PiLaunchManifest, sessionDirFor } from "./models.js";
import {
    EXTENSION,
    entry,
    hookRequests,
    KEY_NAME,
    MODEL,
    mcpEvents,
    PROVIDER,
    piRoots,
    type Roots,
    reply,
    SYNTHETIC_KEY,
    startFakeProvider,
    writeFakeDorothy,
} from "./testing.js";

const opened: Roots[] = [];
afterEach(async () => {
    await Promise.all(opened.splice(0).map((roots) => roots.close()));
});

const FAKE_NODE = "/fixture/bin/node";
const FAKE_PI = "/fixture/pi/dist/cli.js";
const PERSONA = "Dorothy, as the fixture has her.";
const OTHER_KEY = "other-provider-synthetic-0123";

const routing = (route: RouteEntry[]): Routing => ({
    routes: { chat: route, review: [], compaction: [], maintenance: [] },
    keys: [],
});

type Call = {
    cmd: string[];
    env: Env;
    cwd: string | undefined;
    manifest: PiLaunchManifest;
    persona: string;
};

// A launch with every dependency injected: Pi's runtime stands in, the
// spawn records what it was given and exits 17.
async function rig(over: { env?: Env; cwd?: string } = {}) {
    const roots = await piRoots();
    opened.push(roots);
    const calls: Call[] = [];
    const writes: string[] = [];
    const printed: string[] = [];
    const events: string[] = [];
    const secretTargets: string[][] = [];
    const runtimeEnvs: Env[] = [];
    let exitCode = 17;
    let failSpawn: Error | null = null;
    let route: RouteEntry[] = [entry("http://127.0.0.1:9/v1")];
    const deps = (env: Env = over.env ?? roots.env): PiDeps => ({
        env,
        cwd: over.cwd ?? roots.project,
        self: ["/fixture/bun", "--no-env-file", "/fixture/cli/index.ts"],
        loadRouting: async () => routing(route),
        loadSecrets: async (target) => {
            secretTargets.push(Object.keys(target));
            target[KEY_NAME] = SYNTHETIC_KEY;
            target.OTHER_PROVIDER_KEY = OTHER_KEY;
        },
        spawn: (cmd, childEnv, cwd) => {
            events.push("spawn");
            if (failSpawn !== null) throw failSpawn;
            const at = cmd.indexOf("--append-system-prompt");
            calls.push({
                cmd,
                env: childEnv,
                cwd,
                manifest: JSON.parse(
                    readFileSync(childEnv.DOROTHY_PI_MANIFEST ?? "", "utf8"),
                ),
                persona:
                    at === -1 ? "" : readFileSync(cmd[at + 1] ?? "", "utf8"),
            });
            return { exited: Promise.resolve(exitCode), kill: () => {} };
        },
        write: (text) => {
            events.push(`write:${text}`);
            writes.push(text);
        },
        print: (text) => {
            printed.push(text);
        },
        runtime: async (runtimeEnv) => {
            runtimeEnvs.push(runtimeEnv);
            return { command: [FAKE_NODE, FAKE_PI], version: "1.5.0" };
        },
        persona: PERSONA,
        launchId: () => "launch-under-test",
        signals: new EventEmitter(),
    });
    const run = (options: Partial<PiOptions> = {}, env?: Env) =>
        runPi({ args: [], model: null, dump: false, ...options }, deps(env));
    const launchDirs = async () =>
        (
            await readdir(join(roots.root, "runtime", "dorothy")).catch(
                () => [] as string[],
            )
        ).filter((name) => name === "pi-launch-under-test");
    return {
        roots,
        calls,
        writes,
        printed,
        events,
        secretTargets,
        runtimeEnvs,
        run,
        launchDirs,
        exits: (code: number) => {
            exitCode = code;
        },
        failSpawn: (error: Error) => {
            failSpawn = error;
        },
        route: (entries: RouteEntry[]) => {
            route = entries;
        },
    };
}

const sessionRoot = (roots: Roots) =>
    join(roots.root, "data", "dorothy", "pi", "sessions");

// Everything a hostile caller might have exported.
const hostile = (roots: Roots): Env => ({
    ...roots.env,
    OTHER_PROVIDER_KEY: "ambient-other-key",
    ANTHROPIC_API_KEY: "ambient-anthropic-key",
    CLAUDE_CODE_OAUTH_TOKEN: "ambient-oauth-token",
    GITHUB_TOKEN: "ambient-github-token",
    NODE_OPTIONS: "--require /evil/preload.js",
    BUN_OPTIONS: "--preload /evil/preload.ts",
    LD_PRELOAD: "/evil/libevil.so",
    PI_CODING_AGENT_SESSION_DIR: "/evil/sessions",
    PI_PACKAGE_DIR: "/evil/package",
    PI_SKIP_VERSION_CHECK: "1",
    DOROTHY_PI_MANIFEST: "/evil/manifest.json",
    DOROTHY_LAUNCH: "a-launch-not-this-one",
    HTTPS_PROXY: "http://proxy-user:proxy-pass@proxy.invalid:3128",
    NO_PROXY: "localhost",
    LANG: "en_GB.UTF-8",
    LC_ALL: "en_GB.UTF-8",
    COLORTERM: "truecolor",
    HERDR_PANE_ID: "w1:p2",
    DOROTHY_MEMORY_URL: "http://127.0.0.1:7357",
});

describe("dorothy --pi", () => {
    it("launches Pi with her profile, persona and the selected key alone", async () => {
        const r = await rig();
        const env = hostile(r.roots);
        const exitedLaunch = r.run({ args: ["--thinking", "high"] }, env);
        expect(await exitedLaunch).toBe(17);
        expect(r.calls).toHaveLength(1);
        const [call] = r.calls as [Call];
        const childEnv = call.env;
        const childArgs = call.cmd;
        const agentDir = join(r.roots.root, "config", "dorothy", "pi");
        const sessionDir = join(
            sessionRoot(r.roots),
            sessionDirFor(r.roots.project),
        );
        const launchDir = join(
            r.roots.root,
            "runtime/dorothy/pi-launch-under-test",
        );
        expect(childArgs).toEqual([
            FAKE_NODE,
            FAKE_PI,
            "--offline",
            "--session-dir",
            sessionDir,
            "--no-extensions",
            "--no-skills",
            "-e",
            "builtin:mcp",
            "-e",
            EXTENSION,
            "--append-system-prompt",
            join(launchDir, "persona.md"),
            "--model",
            `${PROVIDER}/${MODEL}`,
            "--thinking",
            "high",
        ]);
        expect(call.cwd).toBe(r.roots.project);
        expect(call.persona).toBe(PERSONA);
        // The selected key under its own name; nothing else credential-like.
        expect(childEnv[KEY_NAME]).toBe(SYNTHETIC_KEY);
        expect(childEnv.OTHER_PROVIDER_KEY).toBeUndefined();
        expect(Object.keys(childEnv).sort()).toEqual(
            [
                KEY_NAME,
                "COLORTERM",
                "DOROTHY_PI_MANIFEST",
                "HERDR_PANE_ID",
                "HOME",
                "HTTPS_PROXY",
                "LANG",
                "LC_ALL",
                "NO_PROXY",
                "PATH",
                "PI_CODING_AGENT_DIR",
                "TERM",
                "XDG_CACHE_HOME",
                "XDG_CONFIG_HOME",
                "XDG_DATA_HOME",
                "XDG_RUNTIME_DIR",
                "XDG_STATE_HOME",
            ].sort(),
        );
        expect(childEnv.PI_CODING_AGENT_DIR).toBe(agentDir);
        expect(childEnv.DOROTHY_PI_MANIFEST).toBe(
            join(launchDir, "manifest.json"),
        );
        // The key went in from an isolated loader environment.
        expect(r.secretTargets).toEqual([[]]);
        // The helpers' environment holds no model key.
        const helperEnv = call.manifest.helperEnv;
        expect(helperEnv[KEY_NAME]).toBeUndefined();
        expect(helperEnv.OTHER_PROVIDER_KEY).toBeUndefined();
        expect(helperEnv.ANTHROPIC_API_KEY).toBeUndefined();
        expect(helperEnv.DOROTHY_MEMORY_URL).toBe("http://127.0.0.1:7357");
        expect(helperEnv.XDG_DATA_HOME).toBe(env.XDG_DATA_HOME);
        expect(helperEnv.XDG_STATE_HOME).toBe(env.XDG_STATE_HOME);
        expect(call.manifest).toMatchObject({
            version: 1,
            launchId: "launch-under-test",
            cwd: r.roots.project,
            self: ["/fixture/bun", "--no-env-file", "/fixture/cli/index.ts"],
            entry: { provider: PROVIDER, model: MODEL, key: KEY_NAME },
            extensions: [EXTENSION],
            skills: [],
        });
        expect(call.manifest.models.map((model) => model.id)).toEqual([MODEL]);
        // No key in argv, the manifest or anything said.
        const syntheticKey = SYNTHETIC_KEY;
        expect(childArgs).not.toContain(syntheticKey);
        expect(childArgs.join(" ")).not.toContain(syntheticKey);
        expect(JSON.stringify(call.manifest)).not.toContain(syntheticKey);
        expect(r.writes.join("")).not.toContain(syntheticKey);
        expect(r.writes.join("")).toContain(`${PROVIDER}:${MODEL}`);
        // The launch's private files are gone once Pi has exited.
        expect(existsSync(launchDir)).toBe(false);
        expect(await r.launchDirs()).toEqual([]);
    });

    it("prints a redacted dump, loading no secrets", async () => {
        const r = await rig();
        const env = hostile(r.roots);
        expect(await r.run({ dump: true, args: ["--resume"] }, env)).toBe(0);
        const loadSecretCallsForDump = r.secretTargets.length;
        expect(loadSecretCallsForDump).toBe(0);
        expect(r.calls).toHaveLength(0);
        const dump = JSON.parse(r.printed.join(""));
        expect(dump.command.slice(0, 3)).toEqual([
            FAKE_NODE,
            FAKE_PI,
            "--offline",
        ]);
        expect(dump.command.at(-1)).toBe("--resume");
        expect(dump.cwd).toBe(r.roots.project);
        expect(dump.env).toContain(KEY_NAME);
        expect(dump.env).toContain("PI_CODING_AGENT_DIR");
        expect(dump.env).not.toContain("OTHER_PROVIDER_KEY");
        expect(dump.helperEnv).not.toContain(KEY_NAME);
        // Names only: no value of the caller's reaches the dump.
        const text = r.printed.join("");
        for (const value of [
            "proxy-pass",
            "ambient-other-key",
            "ambient-oauth-token",
            SYNTHETIC_KEY,
            "en_GB",
        ]) {
            expect(text).not.toContain(value);
        }
        expect(await r.launchDirs()).toEqual([]);
    });

    it("passes native help without decrypting secrets", async () => {
        const r = await rig();
        expect(await r.run({ args: ["--help"] })).toBe(17);
        expect(r.secretTargets).toHaveLength(0);
        expect(r.calls[0]?.env[KEY_NAME]).toBeUndefined();
        expect(r.calls[0]?.cmd.at(-1)).toBe("--help");
        // Her extension, which would ask for the key, stays out.
        expect(r.calls[0]?.cmd).not.toContain(EXTENSION);
        expect(r.calls[0]?.cmd).not.toContain("--model");
        expect(r.calls[0]?.cmd).toContain("--no-extensions");
    });

    it("selects the entry --model names, refusing an unknown one first", async () => {
        const r = await rig();
        const other: RouteEntry = {
            ...entry("http://127.0.0.1:9/v1"),
            provider: "other-featherless",
            key: "OTHER_PROVIDER_KEY",
        };
        r.route([entry("http://127.0.0.1:9/v1"), other]);
        expect(await r.run({ model: `other-featherless:${MODEL}` })).toBe(17);
        const call = r.calls[0] as Call;
        expect(call.cmd).toContain(`other-featherless/${MODEL}`);
        expect(call.env.OTHER_PROVIDER_KEY).toBe(OTHER_KEY);
        expect(call.env[KEY_NAME]).toBeUndefined();
        expect(call.manifest.entry.key).toBe("OTHER_PROVIDER_KEY");

        expect(await r.run({ model: "nobody:nothing" })).toBe(1);
        expect(r.writes.join("")).toContain("pi_model_unknown: nobody:nothing");
        r.route([{ ...entry("http://127.0.0.1:9/v1"), kind: "openrouter" }]);
        expect(await r.run()).toBe(1);
        expect(r.writes.join("")).toContain("pi_route_featherless");
        // Neither refusal loaded a secret or made a launch.
        expect(r.secretTargets).toHaveLength(1);
        expect(r.calls).toHaveLength(1);
        expect(await r.launchDirs()).toEqual([]);
    });

    it("stops before launch when the selected key is nowhere", async () => {
        const r = await rig();
        r.route([{ ...entry("http://127.0.0.1:9/v1"), key: "ABSENT_KEY" }]);
        expect(await r.run()).toBe(1);
        expect(r.writes.join("")).toContain("pi_key_missing: ABSENT_KEY");
        expect(r.calls).toHaveLength(0);
        expect(await r.launchDirs()).toEqual([]);
    });

    it("keeps the caller's own value of the selected key", async () => {
        const r = await rig();
        const env = { ...r.roots.env, [KEY_NAME]: "ambient-selected-key" };
        expect(await r.run({}, env)).toBe(17);
        // The loader saw that one name, seeded, and kept it.
        expect(r.secretTargets).toEqual([[KEY_NAME]]);
    });

    it("forwards Pi's exit code and cleans up when it fails to start", async () => {
        const r = await rig();
        r.exits(0);
        expect(await r.run()).toBe(0);
        const error = Object.assign(new Error("spawn /fixture failed"), {
            code: "ENOENT",
        });
        r.failSpawn(error);
        expect(await r.run()).toBe(1);
        expect(r.writes.join("")).toContain("Pi could not start (ENOENT)");
        expect(await r.launchDirs()).toEqual([]);
    });

    it("names the other MCP servers before Pi starts", async () => {
        const r = await rig();
        await mkdir(join(r.roots.project, ".pi"), { recursive: true });
        await writeFile(
            join(r.roots.project, ".pi", "mcp.json"),
            JSON.stringify({ mcpServers: { "project-tools": {} } }),
        );
        expect(await r.run()).toBe(17);
        const note = r.events.findIndex((event) =>
            event.includes("project-tools"),
        );
        expect(note).toBeGreaterThan(-1);
        expect(note).toBeLessThan(r.events.indexOf("spawn"));
        expect(r.events[note]).toContain("project");
    });

    it("refuses a server of her name before anything starts", async () => {
        const r = await rig();
        await mkdir(join(r.roots.project, ".pi"), { recursive: true });
        await writeFile(
            join(r.roots.project, ".pi", "mcp.json"),
            JSON.stringify({ mcpServers: { "dorothy-memory": {} } }),
        );
        expect(await r.run()).toBe(1);
        expect(r.writes.join("")).toContain("pi_mcp_collision");
        expect(r.calls).toHaveLength(0);
    });
});

describe("Pi's own arguments", () => {
    it.each([
        [["--system-prompt", "--api-key"]],
        [["--append-system-prompt", "--session-dir"]],
        [["--name", "--no-mcp"]],
        [["--", "--api-key", "a-prompt-word"]],
        [["--plan", "value", "--thinking", "high"]],
        [["-p", "---api-key"]],
        [["-p", "say --model x"]],
        [["--list-models", "deepseek"]],
        [["--session-id", "0190c2d8-1111-7222-8333-444455556666"]],
    ])("passes %j, whose option words are values", async (args) => {
        const r = await rig();
        expect(await r.run({ args })).toBe(17);
        expect(r.calls[0]?.cmd.slice(-args.length)).toEqual(args);
    });

    it.each([
        [["--api-key", "secret-value-xyz"], "--api-key"],
        [["--api-key=secret-value-xyz"], "--api-key"],
        [["-p", "--api-key", "secret-value-xyz"], "--api-key"],
        [["--mode", "--api-key", "secret-value-xyz"], "--api-key"],
        [["--plan", "--api-key", "secret-value-xyz"], "--api-key"],
        [["--session-dir", "/secret-value-xyz"], "--session-dir"],
        [["--session-dir=/secret-value-xyz"], "--session-dir"],
        [["--no-mcp"], "--no-mcp"],
        [["--model", "secret-value-xyz"], "--model"],
        [["--model=secret-value-xyz"], "--model"],
        [["--provider", "secret-value-xyz"], "--provider"],
    ])("refuses %j by name alone", async (args, name) => {
        const r = await rig();
        expect(await r.run({ args })).toBe(2);
        const said = r.writes.join("");
        expect(said).toContain(name);
        expect(said).not.toContain("secret-value-xyz");
        expect(r.secretTargets).toHaveLength(0);
        expect(r.calls).toHaveLength(0);
        expect(await r.launchDirs()).toEqual([]);
    });
});

describe("Pi's sessions", () => {
    it("keeps two paths that share Pi's name in their own session dirs", async () => {
        const r = await rig();
        const nested = join(r.roots.root, "a", "b");
        const dashed = join(r.roots.root, "a-b");
        await mkdir(nested, { recursive: true });
        await mkdir(dashed, { recursive: true });
        const sessionDirOf = async (cwd: string, args: string[]) => {
            const launch = await rig({ cwd });
            // One profile and one session root for both.
            const env = {
                ...launch.roots.env,
                XDG_CONFIG_HOME: r.roots.env.XDG_CONFIG_HOME,
                XDG_DATA_HOME: r.roots.env.XDG_DATA_HOME,
            };
            expect(await launch.run({ args }, env)).toBe(17);
            const cmd = launch.calls[0]?.cmd ?? [];
            expect(cmd.slice(-args.length)).toEqual(args);
            return cmd[cmd.indexOf("--session-dir") + 1] ?? "";
        };
        const a = await sessionDirOf(nested, ["--resume"]);
        const b = await sessionDirOf(dashed, ["--resume"]);
        expect(a).not.toBe(b);
        // Pi's own name for each is the same; the digest keeps them apart.
        const name = `--${r.roots.root.slice(1).replaceAll("/", "-")}-a-b--`;
        expect(a.endsWith(name)).toBe(true);
        expect(b.endsWith(name)).toBe(true);
        expect(a).toBe(join(sessionRoot(r.roots), sessionDirFor(nested)));
        expect(b).toBe(join(sessionRoot(r.roots), sessionDirFor(dashed)));
        expect(await sessionDirOf(nested, ["--fork", "0190c2d8"])).toBe(a);
    });

    it("opens a named session file only inside her session root", async () => {
        const r = await rig();
        const root = sessionRoot(r.roots);
        const inside = join(root, sessionDirFor("/elsewhere"), "s.jsonl");
        await mkdir(join(root, sessionDirFor("/elsewhere")), {
            recursive: true,
        });
        await writeFile(inside, "");
        expect(await r.run({ args: ["--session", inside] })).toBe(17);
        expect(await r.run({ args: ["--fork", inside] })).toBe(17);
        expect(await r.run({ args: ["--session", "0190c2d8"] })).toBe(17);
        expect(r.calls).toHaveLength(3);

        const outside = join(r.roots.root, "plain-pi", "s.jsonl");
        await mkdir(join(r.roots.root, "plain-pi"), { recursive: true });
        await writeFile(outside, "");
        const linked = join(root, "linked.jsonl");
        await symlink(outside, linked);
        for (const args of [
            ["--session", outside],
            ["--fork", outside],
            ["--session", "../plain-pi/s.jsonl"],
            ["--session", "~/plain-pi/s.jsonl"],
            ["--session", `file://${outside}`],
            ["--session", linked],
            ["--session", join(root, "..", "x.jsonl")],
        ]) {
            const before = r.writes.length;
            expect(await r.run({ args })).toBe(2);
            expect(r.writes.slice(before).join("")).toContain(
                `${args[0]} must name a session below ${await realpath(root)}`,
            );
        }
        expect(r.calls).toHaveLength(3);
        expect(r.secretTargets).toHaveLength(3);
    });

    it("says a launch without a session is not recorded", async () => {
        const r = await rig();
        expect(await r.run({ args: ["--no-session"] })).toBe(17);
        expect(r.writes.join("")).toContain("not recorded");
    });
});

describe("Node for Pi", () => {
    it("never takes Bun's node alias from the PATH", async () => {
        const r = await rig();
        const alias = join(r.roots.root, "bun-node");
        await mkdir(alias);
        await symlink(process.execPath, join(alias, "node"));
        const real = r.roots.env.PATH ?? "";
        // A package script's PATH: the alias and node_modules/.bin first.
        const scripted = {
            ...r.roots.env,
            npm_lifecycle_event: "dev",
            npm_config_local_prefix: r.roots.project,
            PATH: [
                alias,
                join(r.roots.root, "node_modules/.bin"),
                "/node_modules/.bin",
                real,
            ].join(":"),
        };
        expect(await r.run({}, scripted)).toBe(17);
        // Bun's alias anywhere else on PATH is dropped as well.
        const plain = { ...r.roots.env, PATH: `${alias}:${real}` };
        expect(await r.run({}, plain)).toBe(17);
        for (const env of r.runtimeEnvs) {
            expect(env.PATH?.split(":")).not.toContain(alias);
            expect(env.PATH).toBe(real);
        }
        for (const call of r.calls) {
            expect(call.env.PATH).toBe(real);
            expect(
                Object.keys(call.env).some((n) => n.startsWith("npm_")),
            ).toBe(false);
        }
    });
});

// The published Pi, under a real Node, against a scripted endpoint: the
// launcher's own composition, run through.
describe("Pi itself", () => {
    async function real(roots: Roots, baseUrl: string) {
        const node = Bun.which("node", { PATH: roots.env.PATH ?? "" });
        const self = [node ?? "", await writeFakeDorothy(roots.fake)];
        const writes: string[] = [];
        const commands: string[][] = [];
        const launch = async (cwd: string, args: string[], env = roots.env) => {
            let stdout = "";
            let stderr = "";
            const code = await runPi(
                { args, model: null, dump: false },
                {
                    env: { ...env, OTHER_PROVIDER_KEY: "ambient-other-key" },
                    cwd,
                    self,
                    loadRouting: async () => routing([entry(baseUrl)]),
                    loadSecrets: async (target) => {
                        target[KEY_NAME] = SYNTHETIC_KEY;
                        target.OTHER_PROVIDER_KEY = OTHER_KEY;
                    },
                    spawn: (cmd, childEnv, childCwd) => {
                        commands.push(cmd);
                        const child = Bun.spawn(cmd, {
                            env: childEnv,
                            cwd: childCwd,
                            stdin: "ignore",
                            stdout: "pipe",
                            stderr: "pipe",
                        });
                        const read = Promise.all([
                            new Response(child.stdout).text(),
                            new Response(child.stderr).text(),
                        ]).then(([out, err]) => {
                            stdout = out;
                            stderr = err;
                        });
                        return {
                            exited: child.exited.then(async (code) => {
                                await read;
                                return code;
                            }),
                            kill: (signal) => child.kill(signal),
                        };
                    },
                    write: (text) => {
                        writes.push(text);
                    },
                    persona: PERSONA,
                    signals: new EventEmitter(),
                },
            );
            return { code, stdout, stderr };
        };
        return { launch, writes, commands };
    }

    const sessions = async (roots: Roots, cwd: string) => {
        const dir = join(sessionRoot(roots), sessionDirFor(cwd));
        const files = (await readdir(dir).catch(() => [] as string[])).filter(
            (name) => name.endsWith(".jsonl"),
        );
        return Promise.all(
            files.sort().map(async (name) => ({
                path: join(dir, name),
                text: await readFile(join(dir, name), "utf8"),
            })),
        );
    };

    it("resumes, forks and opens sessions natively, keeping preferences", async () => {
        const roots = await piRoots();
        opened.push(roots);
        const provider = startFakeProvider([
            reply("one"),
            reply("two"),
            reply("three"),
            reply("four"),
            reply("five"),
        ]);
        try {
            const nested = join(roots.root, "a", "b");
            const dashed = join(roots.root, "a-b");
            await mkdir(nested, { recursive: true });
            await mkdir(dashed, { recursive: true });
            const { launch, writes } = await real(roots, provider.baseUrl);

            const first = await launch(nested, ["-p", "first prompt"]);
            expect(first.code).toBe(0);
            expect(first.stdout).toContain("one");
            const [file] = await sessions(roots, nested);
            expect(file?.text).toContain("first prompt");

            // A preference the user sets in her profile stays theirs.
            const settings = join(roots.agentDir, "settings.json");
            const kept = JSON.parse(
                await readFile(settings, "utf8").catch(() => "{}"),
            );
            await writeFile(
                settings,
                JSON.stringify({ ...kept, quietStartup: true }),
            );

            const second = await launch(nested, ["-c", "-p", "second"]);
            expect(second.code).toBe(0);
            const continued = await sessions(roots, nested);
            expect(continued).toHaveLength(1);
            expect(continued[0]?.text).toContain("second");
            expect(
                JSON.parse(await readFile(settings, "utf8")).quietStartup,
            ).toBe(true);

            // The path Pi names alike continues nothing of the other's.
            const third = await launch(dashed, ["-c", "-p", "third"]);
            expect(third.code).toBe(0);
            const own = await sessions(roots, dashed);
            expect(own).toHaveLength(1);
            expect(own[0]?.text).not.toContain("first prompt");

            const fourth = await launch(nested, [
                "--fork",
                file?.path ?? "",
                "-p",
                "fourth",
            ]);
            expect(fourth.code).toBe(0);
            const forked = await sessions(roots, nested);
            expect(forked).toHaveLength(2);
            const child = forked.find((s) => s.path !== file?.path);
            const header = JSON.parse(child?.text.split("\n")[0] ?? "{}");
            expect(header.parentSession).toBe(file?.path);

            const fifth = await launch(nested, [
                "--session",
                file?.path ?? "",
                "-p",
                "fifth",
            ]);
            expect(fifth.code).toBe(0);
            const reopened = await sessions(roots, nested);
            expect(reopened).toHaveLength(2);
            expect(reopened.find((s) => s.path === file?.path)?.text).toContain(
                "fifth",
            );

            // Every request carried the key; no helper or server had it.
            expect(provider.requests).toHaveLength(5);
            for (const request of provider.requests) {
                expect(request.authorization).toBe(`Bearer ${SYNTHETIC_KEY}`);
                expect(JSON.stringify(request.body)).toContain(PERSONA);
            }
            const hooks = await hookRequests(roots.fake);
            expect(hooks.length).toBeGreaterThan(0);
            const mcp = await mcpEvents(roots.fake);
            expect(mcp.some((event) => event.kind === "start")).toBe(true);
            for (const seen of hooks) {
                const helperEnv = Object.fromEntries(
                    seen.envNames.map((name) => [name, name]),
                );
                expect(helperEnv[KEY_NAME]).toBeUndefined();
                expect(helperEnv.OTHER_PROVIDER_KEY).toBeUndefined();
            }
            // Her server gets the key's name blanked, as Pi starts
            // it beneath its own environment (assets/pi/index.ts).
            for (const seen of mcp) {
                if (seen.kind !== "start") continue;
                expect(seen.env[KEY_NAME] ?? "").toBe("");
                expect(seen.env.OTHER_PROVIDER_KEY).toBeUndefined();
            }
            const logged = JSON.stringify(mcp) + JSON.stringify(hooks);
            expect(logged).not.toContain(SYNTHETIC_KEY);
            expect(logged).not.toContain(OTHER_KEY);
            expect(writes.join("")).not.toContain(SYNTHETIC_KEY);
        } finally {
            await provider.close();
        }
    }, 120_000);

    it("shows Pi's help with no key decrypted", async () => {
        const roots = await piRoots();
        opened.push(roots);
        const { launch } = await real(roots, "http://127.0.0.1:9/v1");
        const help = await launch(roots.project, ["--help"]);
        expect(help.code).toBe(0);
        expect(help.stdout).toContain("--session <path|id>");
        expect(help.stderr).toBe("");
    }, 60_000);

    it("runs Pi under a real Node with Bun's alias first on PATH", async () => {
        const roots = await piRoots();
        opened.push(roots);
        const alias = join(roots.root, "bun-node");
        await mkdir(alias);
        await symlink(process.execPath, join(alias, "node"));
        const provider = startFakeProvider([reply("hello")]);
        try {
            const { launch, commands } = await real(roots, provider.baseUrl);
            const env = {
                ...roots.env,
                PATH: `${alias}:${roots.env.PATH ?? ""}`,
            };
            const run = await launch(roots.project, ["-p", "hi"], env);
            expect(run.code).toBe(0);
            expect(run.stdout).toContain("hello");
            const node = commands[0]?.[0] ?? "";
            expect(node.startsWith(alias)).toBe(false);
            expect(await realpath(node)).not.toBe(
                await realpath(process.execPath),
            );
        } finally {
            await provider.close();
        }
    }, 60_000);
});
