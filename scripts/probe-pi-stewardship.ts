// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/probe-pi-stewardship.ts
//
//

// The stewardship probe, offline part:
//
//   bun scripts/probe-pi-stewardship.ts --offline --out <dir>
//
// Runs every stewardship scenario with simulated workers (a fake herdr,
// sender and interrupter; no pane is created or written to), under the
// default cast and a held-out one with every worker, pane, terminal and
// task id renamed and the registry, reports and scenarios reordered, then
// one scenario through the published Pi 1.5.0 with a scripted provider on
// loopback. The owner's runner verifies each submission from the worker's
// clone, on an export of the revision it computed itself, outside every
// clone; only its receipt verifies a task. A receipt is evidence against a
// worker's report, not against hostile code running as the runner's user.
//
// Everything runs in a temporary root, with that root as HOME, every XDG
// directory and TMPDIR, and only synthetic credentials: the real user's
// directories, `~/.pi` and `secrets.json` are never read. The model is
// scripted, so a pass proves the plumbing and the ledger, never a model's
// competence; each call it makes is recorded as a scripted decision. The
// result goes to <dir>/result.json and <dir>/report.md. Its own test runs
// it once as a process.
//
// This script imports the CLI's sources by relative path, as
// probe-pi-delivery.ts does, a documented exception to the package
// boundary for probes.

import {
    chmod,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolvePiRuntime } from "../packages/cli/src/hosts/pi/runtime.js";
import {
    processAlive,
    processStart,
} from "../packages/cli/src/hosts/pi/steward/engine.js";
import { createHerdrRun } from "../packages/cli/src/hosts/pi/steward/herdr.js";
import { runPiScenario } from "../packages/cli/src/hosts/pi/steward/pi-scenario.js";
import {
    runSuite,
    type ScenarioResult,
    summaryOf,
    type Totals,
    totalsOf,
} from "../packages/cli/src/hosts/pi/steward/scenarios.js";
import {
    DEFAULT_CAST,
    HELD_OUT_CAST,
} from "../packages/cli/src/hosts/pi/steward/simulation.js";
import { CLI_DIR, MODEL } from "../packages/cli/src/hosts/pi/testing.js";
import {
    FEATHERLESS,
    liveKey,
    refreshMetadata,
    startForwardingProxy,
} from "./pi-proxy.js";
import {
    type LoginStatus,
    layoutOf,
    operatorRelease,
    type ReleaseResult,
    runTrial,
    type TrialDeps,
} from "./pi-stewardship-trial.js";

export type ProbeArgs =
    | { mode: "offline"; out: string }
    | {
          mode: "live";
          registry: string;
          out: string;
          maxUsd: number;
          maxTurns: number;
          timeoutMs: number;
      }
    | {
          mode: "release";
          registry: string;
          taskId: string;
          reason: string;
      };

const USAGE =
    "usage: probe-pi-stewardship.ts --offline --out <dir>\n" +
    "       probe-pi-stewardship.ts --live --registry <path> --out <dir> " +
    "--max-usd <n> [--max-turns 30] [--timeout-ms 1800000]\n" +
    "       probe-pi-stewardship.ts --release <task-id> --registry <path> " +
    "[--reason <text>]";

// The probe's arguments, or what is wrong with them.
export function parseProbeArgs(argv: readonly string[]): ProbeArgs | string {
    let offline = false;
    let live = false;
    let release: string | null = null;
    let out: string | null = null;
    let registry: string | null = null;
    let reason = "the user released it from the probe";
    let maxUsd: number | null = null;
    let maxTurns = 30;
    let timeoutMs = 1_800_000;
    for (let i = 0; i < argv.length; i++) {
        const word = argv[i];
        const value = argv[i + 1];
        const number = () => {
            i++;
            const n = Number(value);
            return value !== undefined && Number.isFinite(n) && n > 0
                ? n
                : null;
        };
        if (word === "--offline") {
            offline = true;
        } else if (word === "--live") {
            live = true;
        } else if (word === "--release" && value !== undefined) {
            release = value;
            i++;
        } else if (word === "--out" && value !== undefined) {
            out = resolve(value);
            i++;
        } else if (word === "--registry" && value !== undefined) {
            registry = resolve(value);
            i++;
        } else if (word === "--reason" && value !== undefined) {
            reason = value;
            i++;
        } else if (word === "--max-usd") {
            maxUsd = number();
            if (maxUsd === null) return `${USAGE}\n--max-usd takes a number`;
        } else if (word === "--max-turns") {
            const n = number();
            if (n === null || !Number.isInteger(n))
                return `${USAGE}\n--max-turns takes a whole number`;
            maxTurns = n;
        } else if (word === "--timeout-ms") {
            const n = number();
            if (n === null) return `${USAGE}\n--timeout-ms takes a number`;
            timeoutMs = n;
        } else {
            return `${USAGE}\nunknown argument ${word}`;
        }
    }
    const modes = [offline, live, release !== null].filter(Boolean).length;
    if (modes !== 1) return `${USAGE}\none of --offline, --live, --release`;
    if (offline) return out !== null ? { mode: "offline", out } : USAGE;
    if (release !== null) {
        if (registry === null) return `${USAGE}\n--release needs --registry`;
        return { mode: "release", registry, taskId: release, reason };
    }
    if (registry === null) return `${USAGE}\n--live needs --registry`;
    if (out === null) return `${USAGE}\n--live needs --out`;
    if (maxUsd === null)
        return `${USAGE}\n--live needs --max-usd: no spending limit is assumed`;
    return { mode: "live", registry, out, maxUsd, maxTurns, timeoutMs };
}

export type ProbeResult = {
    mode: "offline";
    // Every decision was scripted: this measures plumbing, not a model.
    kind: "plumbing";
    note: string;
    outcome: "pass" | "fail";
    casts: { cast: string; scenarios: ScenarioResult[]; totals: Totals }[];
    pi: ScenarioResult;
    totals: Totals;
};

const NOTE =
    "The coordinator's decisions are scripted: this run shows the plumbing, " +
    "the ledger and the owner's verification hold, not that a model " +
    "chooses well. An owner receipt is evidence against a worker's report, " +
    "not against hostile code running as the runner's user.";

// The environment variables of the user's own that could name a real root
// or carry a credential; the probe holds none of them.
const SCRUBBED = [
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "XDG_RUNTIME_DIR",
    "PI_CODING_AGENT_DIR",
    "SOPS_AGE_KEY_FILE",
    "DOROTHY_MEMORY_URL",
    "DOROTHY_PI_MANIFEST",
    "FEATHERLESS_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
];

export async function probe(): Promise<ProbeResult> {
    const work = await mkdtemp(join(tmpdir(), "dorothy-probe-stewardship-"));
    const keep = new Map(
        [...SCRUBBED, "HOME", "TMPDIR"].map((name) => [
            name,
            process.env[name],
        ]),
    );
    for (const name of SCRUBBED) {
        delete process.env[name];
    }
    process.env.HOME = join(work, "home");
    process.env.XDG_CONFIG_HOME = join(work, "config");
    process.env.XDG_DATA_HOME = join(work, "data");
    process.env.XDG_STATE_HOME = join(work, "state");
    process.env.XDG_CACHE_HOME = join(work, "cache");
    process.env.TMPDIR = join(work, "tmp");
    await mkdir(process.env.TMPDIR, { recursive: true, mode: 0o700 });
    try {
        const casts = [];
        for (const cast of [DEFAULT_CAST, HELD_OUT_CAST]) {
            const scenarios = await runSuite(cast);
            casts.push({
                cast: cast.label,
                scenarios,
                totals: totalsOf(scenarios),
            });
        }
        const pi = await runPiScenario();
        const all = [...casts.flatMap((c) => c.scenarios), pi];
        const totals = totalsOf(all);
        const pass =
            totals.failedChecks.length === 0 &&
            totals.duplicateDispatches === 0 &&
            totals.falseVerifiedTasks.length === 0;
        return {
            mode: "offline",
            kind: "plumbing",
            note: NOTE,
            outcome: pass ? "pass" : "fail",
            casts,
            pi,
            totals,
        };
    } finally {
        for (const [name, value] of keep) {
            if (value === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = value;
            }
        }
        await rm(work, { recursive: true, force: true });
    }
}

export function markdown(result: ProbeResult): string {
    const lines = [
        "# Stewardship probe, offline",
        "",
        result.note,
        "",
        `Outcome: ${result.outcome}. ${result.totals.scenarios} scenario ` +
            `runs, ${result.totals.checks} checks, ` +
            `${result.totals.failedChecks.length} failed, ` +
            `${result.totals.duplicateDispatches} duplicate dispatches, ` +
            `${result.totals.falseVerifiedTasks.length} false verified tasks.`,
        "",
        "| Cast | Scenario | Checks | Failed | Duplicates | False verified | Pending or unknown |",
        "| ---- | -------- | ------ | ------ | ---------- | -------------- | ------------------ |",
    ];
    const row = (r: ScenarioResult) =>
        `| ${r.cast} | ${r.name} | ${r.checks.length} | ` +
        `${r.checks.filter((c) => !c.ok).length} | ${r.duplicateDispatches} | ` +
        `${r.falseVerifiedTasks.length} | ` +
        `${r.unresolvedTasks.map((t) => `${t} (${r.states[t]})`).join(", ") || "none"} |`;
    for (const cast of result.casts) {
        lines.push(...cast.scenarios.map(row));
    }
    lines.push(row(result.pi), "");
    const reviews = [...result.casts.flatMap((c) => c.scenarios)].flatMap((r) =>
        r.reviews.map((m) => ({ ...m, cast: r.cast, scenario: r.name })),
    );
    lines.push(
        "Reviews: the ledger ends a right rejection and a wrong approval " +
            "`failed` alike, so each review's verdict (its report's claim) " +
            "is shown beside the owner's receipt on the reviewed revision. " +
            `${result.totals.reviews.agree} agree, ` +
            `${result.totals.reviews.disagree} disagree, ` +
            `${result.totals.reviews.undecided} undecided.`,
        "",
        "| Cast | Scenario | Review | Verdict | Owner passed | Agree |",
        "| ---- | -------- | ------ | ------- | ------------ | ----- |",
        ...reviews.map(
            (m) =>
                `| ${m.cast} | ${m.scenario} | ${m.taskId} | ${m.verdict} | ` +
                `${m.ownerPassed ?? "none"} | ${m.agree ?? "undecided"} |`,
        ),
        "",
        "Scenarios:",
        "",
    );
    for (const r of result.casts[0]?.scenarios ?? []) {
        lines.push(`- \`${r.name}\`: ${summaryOf(r.name)}`);
    }
    lines.push(
        "- `pi-scripted-turn`: Pi 1.5.0 with a scripted provider lists, " +
            "dispatches and waits; only the owner's receipt verifies.",
        "",
    );
    if (result.totals.failedChecks.length > 0) {
        lines.push("Failed checks:", "");
        lines.push(...result.totals.failedChecks.map((c) => `- ${c}`), "");
    }
    return lines.join("\n");
}

type Env = Record<string, string | undefined>;

// The memory contract's health route, from @dorothy/core's SERVICE_PATHS.
const HEALTH = "/v1/health";

function freePort(): number {
    const probe = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => new Response(""),
    });
    const { port } = probe;
    probe.stop(true);
    if (port === undefined) throw new Error("trial: no free port");
    return port;
}

// Her real memory service on the trial's private roots, started from its
// package entry as `--serve` starts it, with reviews off and no secret.
async function startMemory(
    root: string,
    env: Env,
): Promise<{ url: string; stop(): Promise<void> }> {
    const port = freePort();
    const config = join(
        env.XDG_CONFIG_HOME ?? join(root, "config"),
        "dorothy",
        "config.toml",
    );
    await mkdir(dirname(config), { recursive: true, mode: 0o700 });
    await writeFile(
        config,
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
        '    noReviews: "trial" }));',
    ].join("\n");
    const child = Bun.spawn([process.execPath, "--no-env-file", "-e", code], {
        cwd: root,
        env: {
            ...env,
            DOROTHY_MEMORY_URL: url,
            BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
        },
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
        const up = await fetch(`${url}${HEALTH}`)
            .then((response) => response.ok)
            .catch(() => false);
        if (up) break;
        if (tries > 100 || child.exitCode !== null) {
            child.kill("SIGKILL");
            throw new Error(`trial: memory service down: ${log}`);
        }
        await Bun.sleep(100);
    }
    return {
        url,
        stop: async () => {
            child.kill("SIGTERM");
            await child.exited;
            await reading;
        },
    };
}

// A worker home's own status command, never a read of its credential.
async function loginStatus(
    harness: "codex" | "claude",
    home: string,
    env: Env,
): Promise<LoginStatus> {
    const command =
        harness === "codex"
            ? ["codex", "login", "status"]
            : ["claude", "auth", "status", "--text"];
    const name = harness === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR";
    const child = Bun.spawn(command, {
        env: {
            PATH: env.PATH ?? "",
            HOME: home,
            [name]: home,
            TERM: "dumb",
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30_000,
        killSignal: "SIGKILL",
    });
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    const detail = (stdout.trim() || stderr.trim())
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join(" ")
        .slice(0, 240);
    return {
        loggedIn: code === 0,
        detail: detail || `${harness}: status exit ${code}`,
    };
}

// A herdr call under the pane's lock, as the stewardship scripts hold it,
// so an interrupt never lands among another sender's text and Enter.
async function lockedHerdr(
    pane: string,
    args: string[],
    env: Env,
): Promise<{ code: number; stdout: string; stderr: string }> {
    const runtime = env.XDG_RUNTIME_DIR;
    if (!runtime) throw new Error("trial: XDG_RUNTIME_DIR is not set");
    const dir = join(runtime, "dorothy-agents");
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    const lock = join(dir, `${pane.replace(/[^A-Za-z0-9]/g, "_")}.lock`);
    const flock = Bun.which("flock", { PATH: env.PATH ?? "" });
    if (!flock) throw new Error("trial: flock is missing");
    const child = Bun.spawn([flock, "-w", "5", lock, "herdr", ...args], {
        env,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 15_000,
        killSignal: "SIGKILL",
    });
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    return { code, stdout, stderr };
}

async function versions(env: Env): Promise<Record<string, string>> {
    const runtime = await resolvePiRuntime(CLI_DIR, env).catch(() => null);
    const seen = (command: string[]): string => {
        const run = Bun.spawnSync([...command, "--version"], {
            env,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "ignore",
        });
        if (run.exitCode !== 0) return "unknown";
        return run.stdout.toString().trim().split("\n")[0] ?? "unknown";
    };
    return {
        pi: runtime?.version ?? "unknown",
        node: runtime ? seen([runtime.command[0] as string]) : "unknown",
        herdr: seen(["herdr"]),
        bun: Bun.version,
    };
}

// The live trial's real dependencies: herdr, the worker homes' own status
// commands, the memory service, Featherless and the shared proxy.
export async function liveDeps(): Promise<TrialDeps> {
    const env = process.env;
    return {
        env,
        now: () => new Date(),
        sleep: (ms) => Bun.sleep(ms),
        platform: process.platform,
        uid: process.getuid?.() ?? 0,
        herdr: createHerdrRun(),
        lockedHerdr: (pane, args) => lockedHerdr(pane, args, env),
        loginStatus: (harness, home) => loginStatus(harness, home, env),
        startProxy: startForwardingProxy,
        upstream: async () => ({ url: FEATHERLESS, key: await liveKey() }),
        metadata: () => refreshMetadata(MODEL).catch(() => null),
        memory: startMemory,
        versions: () => versions(env),
        alive: processAlive,
        self: {
            pid: process.pid,
            startedAt: await processStart(process.pid),
        },
    };
}

// A task the user releases by hand, from the trial's own log, never a
// model tool. The private roots and fleet id come from the runner's state.
export async function releaseTask(
    args: Extract<ProbeArgs, { mode: "release" }>,
): Promise<ReleaseResult> {
    const registry = resolve(args.registry);
    const layout = layoutOf(registry, join(dirname(registry), "release-out"));
    const text = await readFile(layout.state, "utf8").catch(() => null);
    if (text === null) return { code: "RELEASE_NO_STATE" };
    let state: {
        fleetId?: unknown;
        owned?: unknown;
        env?: { XDG_STATE_HOME?: unknown; HOME?: unknown };
    };
    try {
        state = JSON.parse(text);
    } catch {
        return { code: "RELEASE_STATE_INVALID" };
    }
    const owned = Array.isArray(state.owned)
        ? state.owned.filter((id): id is string => typeof id === "string")
        : [];
    const home =
        typeof state.env?.HOME === "string" ? state.env.HOME : undefined;
    const xdg =
        typeof state.env?.XDG_STATE_HOME === "string"
            ? state.env.XDG_STATE_HOME
            : undefined;
    if (typeof state.fleetId !== "string" || owned.length === 0 || !home)
        return { code: "RELEASE_STATE_INVALID" };
    return operatorRelease({
        env: { HOME: home, XDG_STATE_HOME: xdg },
        fleetId: state.fleetId,
        owned,
        taskId: args.taskId,
        reason: args.reason,
        by: "user",
        log: layout.interventions,
        now: () => new Date(),
    });
}

if (import.meta.main) {
    const args = parseProbeArgs(process.argv.slice(2));
    if (typeof args === "string") {
        process.stderr.write(`${args}\n`);
        process.exit(2);
    }
    if (args.mode === "release") {
        const released = await releaseTask(args);
        process.stdout.write(
            `release ${args.taskId}: ${released.code}` +
                `${released.from ? ` from ${released.from}` : ""}\n`,
        );
        process.exit(released.code === "TASK_RELEASED" ? 0 : 2);
    }
    if (args.mode === "live") {
        const result = await runTrial(args, await liveDeps());
        process.stdout.write(
            `probe live (${result.kind}): ${result.status}, ` +
                `${result.cost.calls} request(s), ` +
                `${result.cost.measuredUsd === null ? "cost unknown" : `US$${result.cost.measuredUsd.toFixed(6)}`}; ` +
                `${args.out}\n`,
        );
        process.exit(
            result.status === "pass" ? 0 : result.status === "pending" ? 2 : 1,
        );
    }
    await mkdir(args.out, { recursive: true, mode: 0o700 });
    const result = await probe();
    await writeFile(
        join(args.out, "result.json"),
        `${JSON.stringify(result, null, 2)}\n`,
    );
    await writeFile(join(args.out, "report.md"), markdown(result));
    const t = result.totals;
    process.stdout.write(
        `probe ${result.mode} (${result.kind}): ${result.outcome}, ` +
            `${t.scenarios} scenario runs, ${t.checks} checks, ` +
            `${t.failedChecks.length} failed, ` +
            `${t.duplicateDispatches} duplicate dispatches, ` +
            `${t.falseVerifiedTasks.length} false verified, ` +
            `${t.unresolvedTasks.length} pending or unknown, ` +
            `${t.reviews.agree}/${t.reviews.total} reviews agree with the ` +
            `owner; ${args.out}\n`,
    );
    process.exit(result.outcome === "pass" ? 0 : 1);
}
