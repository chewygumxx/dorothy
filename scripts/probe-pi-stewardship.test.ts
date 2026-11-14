// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/scripts/probe-pi-stewardship.test.ts
//
//

// The offline probe as a process: its arguments, its result files, and
// that it touches nothing of the user's. The user's roots here are
// sentinels, empty directories the probe must leave empty.

import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processStart } from "../packages/cli/src/hosts/pi/steward/engine.js";
import {
    interruptWorker,
    type ProbeResult,
    parseProbeArgs,
    trialControlEnv,
    workerHomeMatches,
} from "./probe-pi-stewardship.js";

const roots: string[] = [];
const scratch = () => {
    const root = mkdtempSync(join(tmpdir(), "dorothy-probe-test-"));
    roots.push(root);
    return root;
};
afterAll(() => {
    for (const root of roots) {
        rmSync(root, { recursive: true, force: true });
    }
});

describe("the arguments", () => {
    it("take offline, live and release modes, with their own limits", () => {
        expect(parseProbeArgs(["--offline", "--out", "x"])).toEqual({
            mode: "offline",
            out: join(process.cwd(), "x"),
        });
        expect(
            parseProbeArgs([
                "--live",
                "--registry",
                "r",
                "--out",
                "x",
                "--max-usd",
                "5",
                "--max-turns",
                "6",
                "--timeout-ms",
                "120000",
            ]),
        ).toEqual({
            mode: "live",
            registry: join(process.cwd(), "r"),
            out: join(process.cwd(), "x"),
            maxUsd: 5,
            maxTurns: 6,
            timeoutMs: 120000,
        });
        expect(
            parseProbeArgs(["--release", "fix-1", "--registry", "r"]),
        ).toEqual({
            mode: "release",
            registry: join(process.cwd(), "r"),
            taskId: "fix-1",
            reason: "the user released it from the probe",
        });
        for (const argv of [
            [],
            ["--offline"],
            ["--out", "x"],
            ["--offline", "--out"],
            ["--offline", "--out", "x", "--extra"],
            ["--live", "--out", "x"],
            ["--live", "--registry", "r", "--out", "x"],
            ["--release", "fix-1"],
        ]) {
            expect(typeof parseProbeArgs(argv)).toBe("string");
        }
    });
});

const oneLine = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

// Waits until another process holds the lock: `flock -n` exits with the
// conflict code only while it is held. Fails the test past the bound.
const waitForLockHeld = async (lock: string, boundMs = 5000) => {
    const conflict = 200;
    const deadline = Date.now() + boundMs;
    while (Date.now() < deadline) {
        const probe = Bun.spawn(
            ["flock", "-n", "-E", String(conflict), lock, "true"],
            { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
        );
        if ((await probe.exited) === conflict) {
            return;
        }
        await Bun.sleep(20);
    }
    throw new Error(`the lock ${lock} was not held within ${boundMs} ms`);
};

const fakeHerdr = async ({
    path,
    log,
    socket,
    runtime,
    pid,
}: {
    path: string;
    log: string;
    socket: string;
    runtime: string;
    pid: number;
}) => {
    await writeFile(
        path,
        `#!/bin/sh
printf '%s|%s\\n' "$HERDR_SOCKET_PATH" "$XDG_RUNTIME_DIR" >>${oneLine(log)}
env >${oneLine(`${log}.env`)}
[ "$HERDR_SOCKET_PATH" = ${oneLine(socket)} ] || exit 1
[ "$XDG_RUNTIME_DIR" = ${oneLine(runtime)} ] || exit 1
case "$1 $2" in
"agent get")
    printf '%s\\n' '{"result":{"agent":{"name":"trial-codex","pane_id":"w1:p1","agent_status":"working","terminal_id":"term_1"}}}'
    ;;
"pane process-info")
    printf '%s\\n' '{"result":{"process_info":{"foreground_process_group_id":${pid}}}}'
    ;;
"pane send-keys") ;;
*) exit 1 ;;
esac
`,
    );
    await chmod(path, 0o755);
};

describe("the live control boundary", () => {
    it("keeps the declared socket and trial runtime, and no credential", () => {
        const control = trialControlEnv(
            {
                PATH: "/bin",
                HOME: "/owner/home",
                HERDR_ENV: "1",
                HERDR_SOCKET_PATH: "/owner/herdr.sock",
                XDG_RUNTIME_DIR: "/owner/run",
                XDG_STATE_HOME: "/owner/state",
                FEATHERLESS_API_KEY: "provider-secret",
                SOPS_AGE_KEY_FILE: "/owner/age.txt",
            },
            "/trial/run",
        );
        expect(control).toMatchObject({
            PATH: "/bin",
            HOME: "/owner/home",
            HERDR_ENV: "1",
            HERDR_SOCKET_PATH: "/owner/herdr.sock",
            XDG_RUNTIME_DIR: "/trial/run",
        });
        expect(control.FEATHERLESS_API_KEY).toBeUndefined();
        expect(control.SOPS_AGE_KEY_FILE).toBeUndefined();
        expect(control.XDG_STATE_HOME).toBeUndefined();
    });

    it("feeds home inspection the declared socket and trial runtime", async () => {
        const root = scratch();
        const home = join(root, "home");
        const cwd = join(root, "cwd");
        const bin = join(root, "bin");
        const socket = join(root, "owner", "herdr.sock");
        const runtime = join(root, "trial", "run");
        const log = join(root, "calls.log");
        await Promise.all([
            mkdir(home, { recursive: true, mode: 0o700 }),
            mkdir(cwd, { recursive: true, mode: 0o700 }),
            mkdir(bin, { recursive: true, mode: 0o700 }),
            mkdir(runtime, { recursive: true, mode: 0o700 }),
        ]);
        const child = Bun.spawn(["sh", "-c", "sleep 30"], {
            cwd,
            env: {
                PATH: process.env.PATH ?? "",
                HOME: home,
                CODEX_HOME: home,
            },
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
        });
        try {
            await Bun.sleep(50);
            await fakeHerdr({
                path: join(bin, "herdr"),
                log,
                socket,
                runtime,
                pid: child.pid,
            });
            const owner = {
                PATH: `${bin}:${process.env.PATH ?? ""}`,
                HOME: join(root, "owner"),
                HERDR_ENV: "1",
                HERDR_SOCKET_PATH: socket,
                XDG_RUNTIME_DIR: join(root, "owner-run"),
                FEATHERLESS_API_KEY: "provider-secret",
                SOPS_AGE_KEY_FILE: join(root, "age.txt"),
            };
            expect(
                await workerHomeMatches(
                    "codex",
                    home,
                    cwd,
                    "w1:p1",
                    2000,
                    trialControlEnv(owner, runtime),
                ),
            ).toBe(true);
            expect(await readFile(log, "utf8")).toContain(
                `${socket}|${runtime}`,
            );
            const seen = await readFile(`${log}.env`, "utf8");
            expect(seen).not.toContain("provider-secret");
            expect(seen).not.toContain("SOPS_AGE_KEY_FILE");
            expect(
                await workerHomeMatches(
                    "codex",
                    home,
                    cwd,
                    "w1:p1",
                    2000,
                    trialControlEnv(
                        {
                            ...owner,
                            HERDR_SOCKET_PATH: join(root, "other.sock"),
                        },
                        runtime,
                    ),
                ),
            ).toBe(false);
            expect(
                await workerHomeMatches(
                    "codex",
                    home,
                    cwd,
                    "w1:p1",
                    2000,
                    trialControlEnv(
                        { ...owner, HERDR_SOCKET_PATH: undefined },
                        runtime,
                    ),
                ),
            ).toBe(false);
        } finally {
            child.kill("SIGKILL");
            await child.exited;
        }
    }, 20_000);

    it("locks the interrupter and prompt sender in one trial namespace", async () => {
        const root = scratch();
        const bin = join(root, "bin");
        const runtime = join(root, "trial", "run");
        const socket = join(root, "owner", "herdr.sock");
        const log = join(root, "calls.log");
        await Promise.all([
            mkdir(bin, { recursive: true, mode: 0o700 }),
            mkdir(runtime, { recursive: true, mode: 0o700 }),
            mkdir(join(runtime, "dorothy-agents"), {
                recursive: true,
                mode: 0o700,
            }),
        ]);
        await fakeHerdr({
            path: join(bin, "herdr"),
            log,
            socket,
            runtime,
            pid: process.pid,
        });
        const started = await processStart(process.pid);
        const control = trialControlEnv(
            {
                PATH: `${bin}:${process.env.PATH ?? ""}`,
                HOME: join(root, "owner"),
                HERDR_ENV: "1",
                HERDR_SOCKET_PATH: socket,
                XDG_RUNTIME_DIR: join(root, "owner-run"),
                FEATHERLESS_API_KEY: "provider-secret",
            },
            runtime,
        );
        const worker = {
            id: "trial-codex",
            name: "trial-codex",
            pane: "w1:p1",
            harness: "codex" as const,
            role: "implementer" as const,
            cwd: root,
            accountLabel: "fixture",
            availability: "available" as const,
            observedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
        };
        const pin = {
            terminalId: "term_1",
            occupant: {
                kind: "process" as const,
                pid: process.pid,
                startedAt: started,
            },
        };
        expect(
            (
                await interruptWorker(worker, pin, 1000, undefined, {
                    ...control,
                    HERDR_SOCKET_PATH: undefined,
                })
            ).code,
        ).toBe(4);
        const lock = join(runtime, "dorothy-agents", "w1_p1.lock");
        // The final sleep owns fd 9, so killing it releases the lock.
        const holder = Bun.spawn(
            ["sh", "-c", `exec 9>${oneLine(lock)}; flock 9; exec sleep 30`],
            {
                stdin: "ignore",
                stdout: "ignore",
                stderr: "ignore",
            },
        );
        try {
            await waitForLockHeld(lock);
            expect(
                (
                    await interruptWorker(
                        worker,
                        pin,
                        3000,
                        Date.now() + 800,
                        control,
                    )
                ).code,
            ).toBe(7);
            const sendPrompt = join(
                import.meta.dir,
                "..",
                ".agents",
                "skills",
                "agent-stewardship",
                "scripts",
                "send-prompt.sh",
            );
            const prompt = Bun.spawn(
                [
                    sendPrompt,
                    "--from",
                    "dorothy",
                    "--expect-pane",
                    worker.pane,
                    "--expect-process",
                    String(process.pid),
                    started,
                    "--deadline-at",
                    String(Date.now() + 800),
                    worker.name,
                ],
                {
                    env: control,
                    stdin: new Blob(["controlled"]),
                    stdout: "ignore",
                    stderr: "ignore",
                },
            );
            expect(await prompt.exited).toBe(7);
            expect(await readFile(log, "utf8")).toContain(
                `${socket}|${runtime}`,
            );
            expect(await readFile(`${log}.env`, "utf8")).not.toContain(
                "provider-secret",
            );
        } finally {
            holder.kill("SIGKILL");
            await holder.exited;
        }
        expect(
            (await interruptWorker(worker, pin, 3000, undefined, control)).code,
        ).toBe(0);
    }, 20_000);
});

describe("the offline run", () => {
    it("passes with zero duplicates and false verifications, touching no user root", async () => {
        const user = scratch();
        const out = join(scratch(), "out");
        const sentinels = [
            "home",
            "config",
            "data",
            "state",
            "cache",
            "run",
            "tmp",
        ];
        const env: Record<string, string> = {
            PATH: process.env.PATH ?? "",
            HOME: join(user, "home"),
            XDG_CONFIG_HOME: join(user, "config"),
            XDG_DATA_HOME: join(user, "data"),
            XDG_STATE_HOME: join(user, "state"),
            XDG_CACHE_HOME: join(user, "cache"),
            XDG_RUNTIME_DIR: join(user, "run"),
            TMPDIR: join(user, "tmp"),
            // A real-looking credential the run must never use or print.
            FEATHERLESS_API_KEY: "synthetic-must-not-leak-0123456789",
        };
        for (const name of sentinels) {
            Bun.spawnSync(["mkdir", "-p", join(user, name)]);
        }
        const child = Bun.spawnSync(
            [
                process.execPath,
                "--no-env-file",
                join(import.meta.dir, "probe-pi-stewardship.ts"),
                "--offline",
                "--out",
                out,
            ],
            { env, stdout: "pipe", stderr: "pipe" },
        );
        const stdout = child.stdout.toString();
        expect(child.stderr.toString()).toBe("");
        expect(child.exitCode).toBe(0);
        expect(stdout).toContain("pass");

        const result = JSON.parse(
            await readFile(join(out, "result.json"), "utf8"),
        ) as ProbeResult;
        expect(result.outcome).toBe("pass");
        expect(result.kind).toBe("plumbing");
        expect(result.note).toContain("scripted");
        expect(result.totals.duplicateDispatches).toBe(0);
        expect(result.totals.falseVerifiedTasks).toEqual([]);
        expect(result.totals.failedChecks).toEqual([]);
        // Irresolvable fixtures end pending, never dropped or called done.
        expect(result.totals.unresolvedTasks).toEqual(
            expect.arrayContaining([
                "coordinator-crash/trial-uncertain",
                "coordinator-crash/x7q-uncertain",
                "claimed-revision/trial-invented",
            ]),
        );
        // Per review: the verdict beside the owner's receipt. One wrong
        // approval per cast (a disagreement), the rest agreeing.
        expect(result.totals.reviews).toEqual({
            total: 6,
            agree: 4,
            disagree: 2,
            undecided: 0,
        });
        expect(await readFile(join(out, "report.md"), "utf8")).toContain(
            "| Cast | Scenario | Review | Verdict | Owner passed | Agree |",
        );
        expect(result.casts.map((c) => c.cast)).toEqual([
            "default",
            "held-out",
        ]);
        const decisions = [
            ...result.casts.flatMap((c) => c.scenarios),
            result.pi,
        ].flatMap((r) => r.decisions);
        expect(decisions.length).toBeGreaterThan(50);
        expect(decisions.every((d) => d.scripted)).toBe(true);

        const text = stdout + (await readFile(join(out, "report.md"), "utf8"));
        expect(text + JSON.stringify(result)).not.toContain("must-not-leak");
        // The user's roots are as they were: empty, but for Bun's own
        // transpiler cache, which the runtime makes before the probe runs.
        for (const name of sentinels) {
            expect(
                readdirSync(join(user, name)).filter(
                    (entry) => !(name === "cache" && entry === "bun"),
                ),
            ).toEqual([]);
        }
    }, 300_000);

    it("wires live to a pending gate when the worker homes are absent", async () => {
        const root = scratch();
        const trial = join(root, "trial");
        mkdirSync(trial, { recursive: true, mode: 0o700 });
        const out = join(root, "out");
        const child = Bun.spawnSync(
            [
                process.execPath,
                "--no-env-file",
                join(import.meta.dir, "probe-pi-stewardship.ts"),
                "--live",
                "--registry",
                join(trial, "registry.json"),
                "--out",
                out,
                "--max-usd",
                "1",
            ],
            {
                env: {
                    PATH: process.env.PATH ?? "",
                    HOME: join(root, "home"),
                    HERDR_ENV: "1",
                    HERDR_SOCKET_PATH: join(root, "herdr.sock"),
                    XDG_STATE_HOME: join(root, "state"),
                },
                stdout: "pipe",
                stderr: "pipe",
            },
        );
        expect(child.exitCode).toBe(2);
        expect(child.stderr.toString()).toBe("");
        expect(child.stdout.toString()).toContain("pending");
        const result = JSON.parse(
            await readFile(join(out, "result.json"), "utf8"),
        );
        expect(result.status).toBe("pending");
        expect(result.pending.join("\n")).toContain("CODEX_HOME=");
        // The evidence left behind carries placeholders, not the trial path.
        const kept = await Promise.all(
            ["result.json", "events.jsonl", "report.md"].map((name) =>
                readFile(join(out, name), "utf8"),
            ),
        );
        expect(kept.join("\n")).not.toContain(trial);
        expect(kept.join("\n")).not.toContain(out);
    });

    it("prints actionable preflight errors when no evidence path is safe", async () => {
        const root = scratch();
        const trial = join(root, "trial");
        const out = join(root, "out");
        const original = "keep this prior result\n";
        mkdirSync(trial, { recursive: true, mode: 0o700 });
        mkdirSync(out, { recursive: true, mode: 0o700 });
        await writeFile(join(out, "result.json"), original);
        const child = Bun.spawnSync(
            [
                process.execPath,
                "--no-env-file",
                join(import.meta.dir, "probe-pi-stewardship.ts"),
                "--live",
                "--registry",
                join(trial, "custom-fleet.json"),
                "--out",
                out,
                "--max-usd",
                "1",
            ],
            {
                env: {
                    PATH: process.env.PATH ?? "",
                    HOME: join(root, "home"),
                    HERDR_ENV: "1",
                    HERDR_SOCKET_PATH: join(root, "herdr.sock"),
                    XDG_STATE_HOME: join(root, "state"),
                },
                stdout: "pipe",
                stderr: "pipe",
            },
        );
        expect(child.exitCode).toBe(2);
        expect(child.stderr.toString()).toContain("--out");
        expect(child.stderr.toString()).toContain("already exists");
        expect(await readFile(join(out, "result.json"), "utf8")).toBe(original);
    });

    it("refuses live without its registry and spending limit", () => {
        const child = Bun.spawnSync(
            [
                process.execPath,
                "--no-env-file",
                join(import.meta.dir, "probe-pi-stewardship.ts"),
                "--live",
                "--out",
                scratch(),
            ],
            { stdout: "pipe", stderr: "pipe" },
        );
        expect(child.exitCode).toBe(2);
        expect(child.stderr.toString()).toContain("--live needs --registry");
    });
});
