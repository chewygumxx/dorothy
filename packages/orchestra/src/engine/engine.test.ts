// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/engine/engine.test.ts
//
//

// The engine on the fake agent in real boxes: a worker from its start to
// its stop, the refusals, an agent failing while another goes on, a mode
// not the box's, and permission requests through the gate. No test
// reaches a real agent, a provider or the network.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
    chmod,
    mkdir,
    readdir,
    readFile,
    realpath,
    rm,
    writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StructuredCall, StructuredRequest } from "@dorothy/core";
import { boxAvailable } from "../box/box.js";
import { processTree, survivors } from "../box/processes.js";
import type { Adapter } from "../box/worker-box.js";
import { resolveGit } from "../broker/git.js";
import { DEFAULT_ORCHESTRA, type OrchestraConfig } from "../config.js";
import { makeRepos, type Repos } from "../fixtures/repos.js";
import { ManualTime } from "../fixtures/time.js";
import type { Answer } from "../gate.js";
import { Engine, type EngineDeps, type StartInput } from "./engine.js";

const FAKE = join(import.meta.dir, "..", "fixtures", "fake-agent.ts");

const available = await boxAvailable();

let repos: Repos;
let adapter: Adapter;
let clones: string;
const engines: Engine[] = [];

beforeEach(async () => {
    repos = await makeRepos();
    const runtime = await realpath(process.execPath);
    adapter = {
        runtime,
        entry: FAKE,
        readOnly: [dirname(runtime), dirname(FAKE)],
    };
    // Both agents' subscription logins, in one directory.
    await mkdir(join(repos.root, "logins"));
    await writeFile(join(repos.root, "logins", ".credentials.json"), "{}");
    await writeFile(join(repos.root, "logins", "auth.json"), "{}");
    clones = join(await realpath(repos.worktrees), "s1");
});

afterEach(async () => {
    for (const engine of engines.splice(0)) {
        await engine.close();
    }
    await rm(repos.root, { recursive: true, force: true });
});

// An engine on the test's roots, its judge allowing, its user a fake
// whose questions the test answers.
function harness(
    config: Partial<OrchestraConfig> = {},
    over: Partial<EngineDeps> = {},
) {
    const time = new ManualTime();
    const logged: Record<string, unknown>[] = [];
    const judged: StructuredRequest[] = [];
    // Each worker whose questions were stopped, and how many of its
    // questions were still open then.
    const stopped: [string, number][] = [];
    const open = new Map<
        string,
        { worker: string; signal: AbortSignal; answer: (a: Answer) => void }
    >();
    let asked = 0;
    const call: StructuredCall = async (request) => {
        judged.push(request);
        return {
            ok: true,
            output: { decision: "allow", reason: "harmless" },
            model: "fake",
            costUsd: 0,
        };
    };
    const engine = new Engine({
        server: "s1",
        config: {
            ...DEFAULT_ORCHESTRA,
            enabled: true,
            worktreeRoot: repos.worktrees,
            ...config,
        },
        env: repos.env,
        state: repos.state,
        git: resolveGit(repos.env),
        secrets: {},
        logins: {
            claude: join(repos.root, "logins"),
            codex: join(repos.root, "logins"),
        },
        call,
        questions: {
            ask: (question, signal) =>
                new Promise((resolve) => {
                    const id = `question-${++asked}`;
                    const answer = (value: Answer) => {
                        open.delete(id);
                        resolve(value);
                    };
                    open.set(id, { worker: question.workerId, signal, answer });
                    signal.addEventListener("abort", () =>
                        answer({
                            decision: "deny",
                            source: "user",
                            reason: "stopped",
                        }),
                    );
                }),
            stop: async (worker) => {
                const left = [...open.values()].filter(
                    (question) => question.worker === worker,
                );
                stopped.push([worker, left.length]);
            },
            pending: (worker) =>
                [...open]
                    .filter(([, question]) => question.worker === worker)
                    .map(([id]) => id),
        },
        log: (entry) => logged.push(entry),
        clock: time,
        timers: time,
        localRemotes: true,
        adapter: async () => adapter,
        agentArgs: { codex: ["--as", "codex"] },
        resolve: async () => {
            throw new Error("offline");
        },
        ...over,
    });
    engines.push(engine);
    return { engine, time, logged, judged, stopped, open };
}

const start = (
    engine: Engine,
    over: Partial<StartInput> = {},
): ReturnType<Engine["start"]> =>
    engine.start({
        agent: "claude",
        repo: repos.checkout,
        branch: "feature",
        task: "Reply with the word: one",
        operationId: "op-start",
        ...over,
    });

// Polls until the condition holds; the test's own timeout bounds it.
async function until(condition: () => boolean): Promise<void> {
    while (!condition()) {
        await Bun.sleep(25);
    }
}

const settled = (engine: Engine, operationId: string) =>
    until(() => {
        const { status } = engine.operations.read(operationId);
        return status !== "pending" && status !== "running";
    });

const replies = (events: string[]) =>
    events.filter((event) => event.startsWith("reply: "));

// The box bubblewrap runs for a clone, found in the process table.
async function boxOf(clone: string): Promise<number> {
    for (const name of await readdir("/proc")) {
        const argv = (
            await readFile(`/proc/${name}/cmdline`, "utf8").catch(() => "")
        ).split("\0");
        if (argv[0] === "bwrap" && argv.includes(clone)) {
            return Number(name);
        }
    }
    throw new Error(`no box for ${clone}`);
}

describe.if(available)("the engine, on the fake agent in real boxes", () => {
    it("runs a worker from its start to its stop, its turns in order", async () => {
        const { engine, logged } = harness();
        const started = await start(engine);
        expect(started.worker).toBe("claude-1");
        expect(started.operation).toMatchObject({
            tool: "start_worker",
            worker: "claude-1",
            status: "pending",
        });
        expect(engine.list()).toEqual([
            {
                worker: "claude-1",
                agent: "claude",
                branch: "feature",
                clone: null,
                status: "starting",
                reason: "",
            },
        ]);
        expect((await start(engine)).operation.operationId).toBe("op-start");
        engine.prompt("claude-1", "Run `git status`", "op-2");
        engine.prompt("claude-1", "Reply with the word: three", "op-3");
        await settled(engine, "op-3");

        const clone = join(clones, "claude-1");
        const report = engine.read("claude-1");
        expect(report).toMatchObject({ status: "idle", clone, questions: [] });
        expect(
            report.operations.map(({ operationId, status }) => [
                operationId,
                status,
            ]),
        ).toEqual([
            ["op-start", "succeeded"],
            ["op-2", "succeeded"],
            ["op-3", "succeeded"],
        ]);
        const said = replies(report.events);
        expect(said).toHaveLength(3);
        expect(said[1]).toContain("permission: allow-once");
        expect(report.events).toContain("called git status");
        expect(report.events).toContainEqual(
            expect.stringMatching(/^permission for git status: allow by rule/),
        );
        expect(engine.read("claude-1").events).toEqual([]);
        expect(repos.git(["symbolic-ref", "--short", "HEAD"], clone)).toBe(
            "feature",
        );
        expect(repos.git(["rev-parse", "HEAD"], clone)).toBe(repos.remoteMain);
        expect(logged).toContainEqual(
            expect.objectContaining({
                event: "decision",
                workerId: "claude-1",
                decision: "allow",
                source: "rule",
            }),
        );

        engine.stop("claude-1", "op-stop");
        await settled(engine, "op-stop");
        expect(engine.read("claude-1").status).toBe("stopped");
        expect(existsSync(clone)).toBe(true);
        const hex = Buffer.from("feature").toString("hex");
        expect(
            existsSync(join(repos.state, "branches", "acme", "widget", hex)),
        ).toBe(true);
        expect(() => engine.prompt("claude-1", "more", "op-4")).toThrow(
            "claude-1 has stopped",
        );
    }, 60_000);

    it("waits for a worker to need the user, stops it with no process left", async () => {
        const { engine, stopped, open, time } = harness();
        await start(engine, { task: "Run `echo $(git status)`" });
        const waited = await engine.wait("claude-1", 45);
        expect(waited.timedOut).toBe(false);
        expect(waited.workers.map(({ status }) => status)).toEqual([
            "waiting-on-user",
        ]);
        expect(engine.read("claude-1").questions).toEqual(["question-1"]);

        const idle = engine.wait(undefined, 100);
        time.advance(44_999);
        expect(await Promise.race([idle, Bun.sleep(50)])).toBeUndefined();
        time.advance(1);
        expect((await idle).timedOut).toBe(true);

        const tree = await processTree(await boxOf(join(clones, "claude-1")));
        const question = [...open.values()][0];
        engine.stop("claude-1", "op-stop");
        await settled(engine, "op-stop");
        expect(question?.signal.aborted).toBe(true);
        // The worker's end denied its gate's request before its questions
        // were stopped.
        expect(stopped[0]).toEqual(["claude-1", 0]);
        expect(engine.read("claude-1").status).toBe("stopped");
        expect(engine.operations.read("op-start").status).toBe("failed");
        expect(tree.length).toBeGreaterThan(0);
        expect(await survivors(tree, 5000)).toEqual([]);
    }, 60_000);

    it("answers by the agent's exact option: the user's, the judge's, a rule's", async () => {
        const { engine, judged, open } = harness();
        await start(engine, {
            agent: "codex",
            task: "Run `echo $(git status)`",
        });
        await until(() => open.size > 0);
        [...open.values()][0]?.answer({
            decision: "allow",
            source: "user",
            reason: "User allowed once",
        });
        await settled(engine, "op-start");
        engine.prompt("codex-1", "Run `touch judged`", "op-2");
        engine.prompt("codex-1", "Run `git push origin HEAD`", "op-3");
        await settled(engine, "op-3");

        const clone = join(clones, "codex-1");
        const said = replies(engine.read("codex-1").events);
        expect(said[0]).toContain("permission: allow_once");
        expect(said[1]).toContain("permission: allow_once");
        expect(said[2]).toContain("permission: decline");
        expect(existsSync(join(clone, "judged"))).toBe(true);
        expect(judged).toHaveLength(1);
        expect(judged[0]?.prompt).toContain(clone);
    }, 60_000);

    it("refuses an agent, a repository, a branch, a start and a login", async () => {
        const { engine } = harness({ agents: ["claude"], maxWorkers: 1 });
        await expect(
            start(engine, { agent: "codex", operationId: "op-a" }),
        ).rejects.toThrow("codex is not among [orchestra] agents");
        const elsewhere = join(repos.root, "elsewhere");
        repos.git(["init", "-q", elsewhere], repos.root);
        repos.git(
            ["remote", "add", "origin", "https://example.test/a/b.git"],
            elsewhere,
        );
        await expect(
            start(engine, { repo: elsewhere, operationId: "op-b" }),
        ).rejects.toThrow("origin names no GitHub repository");
        await start(engine);
        await expect(start(engine, { operationId: "op-c" })).rejects.toThrow(
            "feature is reserved already",
        );
        await expect(
            start(engine, { branch: "other", operationId: "op-d" }),
        ).rejects.toThrow("max-workers is 1, and as many run already");
        expect(engine.list().map(({ worker }) => worker)).toEqual(["claude-1"]);

        const keyless = harness({ claudeLogin: "api-key" }).engine;
        await expect(start(keyless)).rejects.toThrow(
            "claude-login is api-key, but ANTHROPIC_API_KEY is not in Dorothy's secrets",
        );
        expect(keyless.list()).toEqual([]);
    }, 60_000);

    it("fails a start whose branch is on the remote, its base ref deleted", async () => {
        const { engine } = harness({ maxWorkers: 1 });
        await start(engine, { branch: "main" });
        await settled(engine, "op-start");
        expect(engine.operations.read("op-start")).toMatchObject({
            status: "failed",
            detail: "main is on the remote already",
        });
        expect(engine.list()[0]).toMatchObject({
            status: "failed",
            reason: "main is on the remote already",
        });
        const broker = join(repos.state, "repos", "acme", "widget.git");
        expect(repos.git(["for-each-ref", "refs/orchestra"], broker)).toBe("");
        expect((await start(engine, { operationId: "op-next" })).worker).toBe(
            "claude-2",
        );
    }, 60_000);

    it("fails a worker whose agent exits, while another goes on", async () => {
        const { engine, logged } = harness(
            {},
            { agentArgs: { codex: ["--as", "codex", "--exit-after-prompt"] } },
        );
        await start(engine);
        await start(engine, {
            agent: "codex",
            branch: "other",
            operationId: "op-codex",
        });
        await settled(engine, "op-start");
        await until(() => engine.read("codex-1").status === "failed");
        expect(engine.list()[1]?.reason).toContain("its session is lost");
        expect(() => engine.prompt("codex-1", "more", "op-more")).toThrow(
            "codex-1 has failed",
        );
        engine.prompt("claude-1", "Reply with the word: two", "op-2");
        await settled(engine, "op-2");
        expect(engine.operations.read("op-2").status).toBe("succeeded");
        expect(logged).toContainEqual(
            expect.objectContaining({
                event: "worker",
                worker: "codex-1",
                status: "failed",
            }),
        );
        await engine.close();
        expect(engine.list().map(({ status }) => status)).toEqual([
            "stopped",
            "failed",
        ]);
    }, 60_000);

    it("fails a Codex worker whose session reports the agent mode, before its turn", async () => {
        const { engine } = harness(
            {},
            { agentArgs: { codex: ["--as", "codex", "--pin-mode", "agent"] } },
        );
        await start(engine, { agent: "codex", task: "Run `touch ran`" });
        await settled(engine, "op-start");
        const reason = "its session reports mode agent, not workspace-write";
        expect(engine.operations.read("op-start")).toMatchObject({
            status: "failed",
            detail: reason,
        });
        const report = engine.read("codex-1");
        expect(report).toMatchObject({ status: "failed", reason });
        expect(replies(report.events)).toEqual([]);
        expect(existsSync(join(clones, "codex-1", "ran"))).toBe(false);
    }, 60_000);
});

describe("the engine, closing", () => {
    it("cancels a startup broker process before close returns", async () => {
        const git = resolveGit(repos.env);
        const wrapper = join(repos.root, "git-wrapper");
        const pidfile = join(repos.root, "startup.pid");
        await writeFile(
            wrapper,
            `#!/bin/sh\ncase " $* " in *" ls-remote "*) echo $$ > '${pidfile}'; exec sleep 60;; esac\nexec '${git}' "$@"\n`,
        );
        await chmod(wrapper, 0o755);
        const { engine, time } = harness({}, { git: wrapper });
        await start(engine);
        await until(() => existsSync(pidfile));
        const pid = Number(await readFile(pidfile, "utf8"));
        try {
            const closing = engine.close();
            time.advance(10_000);
            await Bun.sleep(50);
            time.advance(10_000);
            await closing;
            const stat = readFileSync(`/proc/${pid}/stat`, "utf8").split(
                ") ",
            )[1];
            expect(stat?.startsWith("Z") ?? true).toBe(true);
            expect(engine.list()[0]?.clone).toBeNull();
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                throw error;
            }
        } finally {
            try {
                process.kill(pid, "SIGKILL");
            } catch {}
        }
    });

    it("refuses a start begun as the server closes, naming no worker", async () => {
        const { engine } = harness();
        await engine.close();
        await expect(start(engine)).rejects.toThrow("the server is closing");
        expect(engine.list()).toEqual([]);
    });
});
