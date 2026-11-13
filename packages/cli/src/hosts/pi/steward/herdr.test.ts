// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/herdr.test.ts
//
//

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    agentInfoReply,
    fakeHerdr,
    herdrAgentOf,
    NOW,
    notFoundReply,
    type Reply,
    writeRegistry,
} from "./fixtures.js";
import {
    createHerdrRun,
    MAX_OUTPUT_BYTES,
    METADATA_TIMEOUT_MS,
    observeWorker,
} from "./herdr.js";
import { readFleet } from "./registry.js";
import type { Worker } from "./types.js";

const env = { HERDR_ENV: "1", PATH: "/usr/bin" };
const clock = () => NOW;
const options = {
    env,
    now: clock,
    timeoutMs: 50,
    processStart: async (pid: number) => `boot:${pid}`,
};

let codex: Worker;
let claude: Worker;
let cleanup: () => Promise<void>;
let root: string;
let scratch: string;

beforeAll(async () => {
    const reg = await writeRegistry();
    const fleet = await readFleet(reg.path, NOW);
    [codex, claude] = fleet.workers as [Worker, Worker];
    cleanup = reg.cleanup;
    scratch = reg.root;
    root = await mkdtemp(join(tmpdir(), "dorothy-herdr-run-"));
});

afterAll(async () => {
    await cleanup();
    await rm(root, { recursive: true, force: true });
});

const replying = (reply: Reply | "hang" | Error) => {
    const herdr = fakeHerdr([codex, claude]);
    herdr.queue(reply);
    return herdr;
};

describe("the synthetic fixtures", () => {
    const common = [
        "agent",
        "agent_status",
        "cwd",
        "focused",
        "foreground_cwd",
        "name",
        "pane_id",
        "revision",
        "state_change_seq",
        "tab_id",
        "terminal_id",
        "terminal_title",
        "terminal_title_stripped",
        "workspace_id",
    ];

    it("have the key sets of herdr 0.9.5's agent", () => {
        const keys = (worker: Worker, status: string) =>
            Object.keys(herdrAgentOf(worker, status)).sort();
        expect(keys(codex, "idle")).toEqual(
            [...common, "completion_seq"].sort(),
        );
        expect(keys(codex, "working")).toEqual([...common].sort());
        expect(keys(claude, "idle")).toEqual(
            [...common, "agent_session", "completion_seq"].sort(),
        );
        expect(keys(claude, "working")).toEqual(
            [...common, "agent_session", "interactive_ready"].sort(),
        );
    });

    it("wrap the agent in the get envelope, and errors in theirs", () => {
        const ok = JSON.parse(agentInfoReply(herdrAgentOf(codex)).stdout);
        expect(Object.keys(ok).sort()).toEqual(["id", "result"]);
        expect(Object.keys(ok.result).sort()).toEqual(["agent", "type"]);
        const missing = notFoundReply("x");
        expect(missing.code).toBe(1);
        expect(JSON.parse(missing.stdout)).toEqual({
            error: {
                code: "agent_not_found",
                message: "agent target x not found",
            },
            id: "cli:agent:get",
        });
    });

    it("hold nothing of this machine", () => {
        const text = JSON.stringify([
            herdrAgentOf(codex),
            herdrAgentOf(claude, "working"),
        ]);
        expect(text).not.toContain(process.env.HOME ?? "\0");
        // The scratch root is random, and may spell "w3" by chance.
        expect(text.replaceAll(scratch, "<scratch>")).not.toContain("w3");
    });
});

describe("observeWorker", () => {
    it("matches a worker where it is declared, asking by name alone", async () => {
        const herdr = fakeHerdr([codex, claude]);
        const seen = await observeWorker(codex, herdr.run, options);
        expect(seen).toEqual({
            id: codex.id,
            matches: true,
            state: "idle",
            observedAt: NOW.toISOString(),
            code: null,
            terminalId: "term_0000000000000a1",
            occupant: {
                kind: "process",
                pid: 4101,
                startedAt: "boot:4101",
            },
        });
        expect(herdr.calls).toHaveLength(2);
        expect(herdr.calls[0]?.args).toEqual(["agent", "get", codex.name]);
        expect(herdr.calls[1]?.args).toEqual([
            "pane",
            "process-info",
            "--pane",
            codex.pane,
        ]);
        expect(herdr.calls[0]?.env.HERDR_ENV).toBe("1");
    });

    it("prefers a validated agent session to the terminal resource", async () => {
        const herdr = fakeHerdr([codex, claude]);
        const seen = await observeWorker(claude, herdr.run, options);
        expect(seen.occupant).toEqual({
            kind: "session",
            value: "00000000-0000-4000-8000-0000000000a1",
        });
        expect(herdr.calls.map((call) => call.args[1])).toEqual(["get"]);
    });

    it("uses Linux process start when a fresh worker has no session", async () => {
        const herdr = fakeHerdr([codex, claude]);
        const seen = await observeWorker(codex, herdr.run, options);
        expect(seen.occupant).toEqual({
            kind: "process",
            pid: 4101,
            startedAt: "boot:4101",
        });
        expect(herdr.calls.map((call) => call.args.slice(0, 2))).toEqual([
            ["agent", "get"],
            ["pane", "process-info"],
        ]);
    });

    it("reports each recognized state, as a match", async () => {
        for (const state of [
            "idle",
            "working",
            "blocked",
            "done",
            "unknown",
        ] as const) {
            const herdr = fakeHerdr([codex, claude]);
            herdr.agents.set(claude.name, herdrAgentOf(claude, state));
            const seen = await observeWorker(claude, herdr.run, options);
            expect(seen.matches).toBe(true);
            expect(seen.state).toBe(state);
            expect(seen.code).toBeNull();
        }
    });

    it("never takes an unrecognized status for idle", async () => {
        for (const status of ["stopped", "IDLE", "ready", "", "idle "]) {
            const herdr = fakeHerdr([codex, claude]);
            herdr.agents.set(codex.name, herdrAgentOf(codex, status));
            const seen = await observeWorker(codex, herdr.run, options);
            expect(seen.state).toBe("unknown");
            expect(seen.code).toBe("HERDR_STATE_UNRECOGNIZED");
        }
        const herdr = fakeHerdr([codex, claude]);
        const agent = herdrAgentOf(codex) as Record<string, unknown>;
        delete agent.agent_status;
        herdr.agents.set(codex.name, agent as never);
        expect((await observeWorker(codex, herdr.run, options)).state).toBe(
            "unknown",
        );
    });

    it("exposes herdr's terminal id, bounded, without matching on it", async () => {
        const herdr = fakeHerdr([codex, claude]);
        herdr.agents.set(codex.name, {
            ...herdrAgentOf(codex),
            terminal_id: "term_other0000000b2",
        });
        const seen = await observeWorker(codex, herdr.run, options);
        expect([seen.matches, seen.terminalId]).toEqual([
            true,
            "term_other0000000b2",
        ]);
        for (const bad of [7, null, "", "x".repeat(65), "a b", "a\nb", {}]) {
            herdr.agents.set(codex.name, {
                ...herdrAgentOf(codex),
                terminal_id: bad as never,
            });
            const odd = await observeWorker(codex, herdr.run, options);
            expect([odd.matches, odd.state, odd.terminalId]).toEqual([
                true,
                "idle",
                null,
            ]);
        }
        const gone = herdrAgentOf(codex) as Record<string, unknown>;
        delete gone.terminal_id;
        herdr.agents.set(codex.name, gone as never);
        expect(
            (await observeWorker(codex, herdr.run, options)).terminalId,
        ).toBe(null);
    });

    it("gives no terminal id for an occupant that is not the worker", async () => {
        const herdr = fakeHerdr([codex, claude]);
        herdr.agents.set(codex.name, {
            ...herdrAgentOf(codex),
            pane_id: "w9:p7",
        });
        const seen = await observeWorker(codex, herdr.run, options);
        expect([seen.matches, seen.terminalId]).toEqual([false, null]);
    });

    it("refuses a pane the name has moved to", async () => {
        const herdr = fakeHerdr([codex, claude]);
        herdr.agents.set(codex.name, {
            ...herdrAgentOf(codex),
            pane_id: "w9:p7",
        });
        const seen = await observeWorker(codex, herdr.run, options);
        expect(seen.matches).toBe(false);
        expect(seen.state).toBe("unknown");
        expect(seen.code).toBe("HERDR_PANE_MOVED");
    });

    it("refuses a reply for another name, or for none", async () => {
        const other = { ...herdrAgentOf(codex), name: "other" };
        const named = await observeWorker(
            codex,
            replying(agentInfoReply(other)).run,
            options,
        );
        expect([named.matches, named.code]).toEqual([
            false,
            "HERDR_NAME_MISMATCH",
        ]);
        const bare = herdrAgentOf(codex) as Record<string, unknown>;
        delete bare.name;
        const seen = await observeWorker(
            codex,
            replying(agentInfoReply(bare as never)).run,
            options,
        );
        expect([seen.matches, seen.code]).toEqual([
            false,
            "HERDR_NAME_MISMATCH",
        ]);
    });

    it("refuses another harness in the pane, and another cwd", async () => {
        const herdr = fakeHerdr([codex, claude]);
        herdr.agents.set(codex.name, {
            ...herdrAgentOf(codex),
            agent: "claude",
        });
        let seen = await observeWorker(codex, herdr.run, options);
        expect([seen.matches, seen.code]).toEqual([
            false,
            "HERDR_HARNESS_MISMATCH",
        ]);
        herdr.agents.set(codex.name, {
            ...herdrAgentOf(codex),
            cwd: `${codex.cwd}/..`,
        });
        seen = await observeWorker(codex, herdr.run, options);
        expect([seen.matches, seen.code]).toEqual([
            false,
            "HERDR_CWD_MISMATCH",
        ]);
        herdr.agents.set(codex.name, {
            ...herdrAgentOf(codex),
            cwd: "/somewhere/else",
        });
        expect((await observeWorker(codex, herdr.run, options)).matches).toBe(
            false,
        );
    });

    it("refuses an agent herdr cannot find, as a stopped one", async () => {
        const herdr = fakeHerdr([codex, claude]);
        herdr.agents.delete(codex.name);
        const seen = await observeWorker(codex, herdr.run, options);
        expect(seen).toEqual({
            id: codex.id,
            matches: false,
            state: "unknown",
            observedAt: NOW.toISOString(),
            code: "HERDR_AGENT_NOT_FOUND",
            terminalId: null,
            occupant: null,
        });
    });

    it("treats malformed replies as unmatched and unknown", async () => {
        const good = agentInfoReply(herdrAgentOf(codex)).stdout;
        const cases: [string, Reply][] = [
            ["empty", { code: 0, stdout: "", stderr: "" }],
            ["not json", { code: 0, stdout: "idle", stderr: "" }],
            ["array", { code: 0, stdout: "[]", stderr: "" }],
            ["null", { code: 0, stdout: "null", stderr: "" }],
            ["no result", { code: 0, stdout: "{}", stderr: "" }],
            [
                "no agent",
                {
                    code: 0,
                    stdout: '{"result":{"type":"agent_info"}}',
                    stderr: "",
                },
            ],
            [
                "agent a string",
                {
                    code: 0,
                    stdout: '{"result":{"type":"agent_info","agent":"x"}}',
                    stderr: "",
                },
            ],
            [
                "wrong type",
                {
                    code: 0,
                    stdout: good.replace("agent_info", "agent_list"),
                    stderr: "",
                },
            ],
            [
                "pane not a string",
                { code: 0, stdout: good.replace('"w1:p1"', "1"), stderr: "" },
            ],
            ["failed, not json", { code: 2, stdout: "boom", stderr: "x" }],
            ["failed with good body", { code: 1, stdout: good, stderr: "" }],
        ];
        for (const [label, reply] of cases) {
            const seen = await observeWorker(
                codex,
                replying(reply).run,
                options,
            );
            expect([label, seen.matches, seen.state]).toEqual([
                label,
                false,
                "unknown",
            ]);
            expect(seen.code).toMatch(/^HERDR_/);
        }
    });

    it("names a failed call by herdr's own code when it gives one", async () => {
        const seen = await observeWorker(
            codex,
            replying({
                code: 1,
                stdout: '{"error":{"code":"server_unavailable"}}',
                stderr: "",
            }).run,
            options,
        );
        expect([seen.matches, seen.code]).toEqual([false, "HERDR_FAILED"]);
    });

    it("refuses an oversized reply", async () => {
        const reply = {
            code: 0,
            stdout: " ".repeat(MAX_OUTPUT_BYTES + 1),
            stderr: "",
        };
        const seen = await observeWorker(codex, replying(reply).run, options);
        expect([seen.matches, seen.code]).toEqual([
            false,
            "HERDR_REPLY_TOO_LARGE",
        ]);
    });

    it("gives unmatched and unknown when the process cannot run", async () => {
        const seen = await observeWorker(
            codex,
            replying(new Error("spawn herdr ENOENT")).run,
            options,
        );
        expect([seen.matches, seen.state, seen.code]).toEqual([
            false,
            "unknown",
            "HERDR_UNAVAILABLE",
        ]);
    });

    it("times out a call that honours its signal", async () => {
        const herdr = replying("hang");
        const seen = await observeWorker(codex, herdr.run, options);
        expect([seen.matches, seen.state, seen.code]).toEqual([
            false,
            "unknown",
            "HERDR_TIMEOUT",
        ]);
    });

    it("times out a call that ignores its signal", async () => {
        const stuck = () => new Promise<never>(() => {});
        const seen = await observeWorker(codex, stuck, options);
        expect(seen.code).toBe("HERDR_TIMEOUT");
    });

    it("allows two seconds to a metadata call by default", () => {
        expect(METADATA_TIMEOUT_MS).toBe(2000);
        expect(MAX_OUTPUT_BYTES).toBe(32 * 1024);
    });

    it("needs HERDR_ENV=1, and calls nothing without it", async () => {
        for (const bad of [undefined, "", "0", "true", "1 "]) {
            const herdr = fakeHerdr([codex, claude]);
            const seen = await observeWorker(codex, herdr.run, {
                ...options,
                env: { ...env, HERDR_ENV: bad },
            });
            expect([seen.matches, seen.state, seen.code]).toEqual([
                false,
                "unknown",
                "HERDR_ENV_MISSING",
            ]);
            expect(herdr.calls).toHaveLength(0);
        }
    });

    it("calls nothing for an expired worker or an unsafe name", async () => {
        const herdr = fakeHerdr([codex, claude]);
        const expired = await observeWorker(codex, herdr.run, {
            ...options,
            now: () => new Date(codex.expiresAt),
        });
        expect([expired.matches, expired.code]).toEqual([
            false,
            "REGISTRY_EXPIRED",
        ]);
        for (const name of ["--help", "", "a b"]) {
            const seen = await observeWorker(
                { ...codex, name },
                herdr.run,
                options,
            );
            expect([seen.matches, seen.code]).toEqual([
                false,
                "WORKER_NAME_INVALID",
            ]);
        }
        expect(herdr.calls).toHaveLength(0);
    });

    it("stamps the observation with the injected clock", async () => {
        const at = new Date("2026-11-03T12:05:06.789Z");
        const seen = await observeWorker(codex, fakeHerdr([codex]).run, {
            ...options,
            now: () => at,
        });
        expect(seen.observedAt).toBe("2026-11-03T12:05:06.789Z");
    });

    it("sends only `agent get`: the fake refuses anything else", async () => {
        const herdr = fakeHerdr([codex]);
        const ctl = new AbortController();
        for (const args of [
            ["agent", "read", codex.name],
            ["agent", "prompt", codex.name, "hi"],
            ["pane", "send-keys", codex.name],
        ]) {
            await expect(
                herdr.run(args, { env, signal: ctl.signal }),
            ).rejects.toThrow("fake herdr refuses");
        }
    });
});

async function script(body: string): Promise<string> {
    const path = join(root, `herdr-${Math.random().toString(36).slice(2)}`);
    await Bun.write(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    return path;
}

const alive = (pid: number) => {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
};

describe("createHerdrRun", () => {
    it("runs the binary on its arguments directly, without a shell", async () => {
        const bin = await script(
            'printf "%s|" "$@"; printf "env=%s" "$HERDR_ENV"',
        );
        const run = createHerdrRun({ bin });
        const result = await run(["agent", "get", "a b;$(x)"], {
            env: { HERDR_ENV: "1" },
            signal: new AbortController().signal,
        });
        expect(result).toEqual({
            code: 0,
            stdout: "agent|get|a b;$(x)|env=1",
            stderr: "",
        });
    });

    it("gives env alone, never the parent's, and the exit code", async () => {
        process.env.DOROTHY_TEST_LEAK = "leak";
        try {
            const bin = await script(
                `printf "%s" "\${DOROTHY_TEST_LEAK:-none}"; echo oops >&2; exit 3`,
            );
            const result = await createHerdrRun({ bin })([], {
                env: {},
                signal: new AbortController().signal,
            });
            expect(result).toEqual({
                code: 3,
                stdout: "none",
                stderr: "oops\n",
            });
        } finally {
            delete process.env.DOROTHY_TEST_LEAK;
        }
    });

    it("passes stdin when given", async () => {
        const bin = await script("cat");
        const result = await createHerdrRun({ bin })([], {
            env: {},
            signal: new AbortController().signal,
            stdin: "hello",
        });
        expect(result.stdout).toBe("hello");
    });

    it("stops and kills a process that writes past the limit", async () => {
        const pids = join(root, "flood.pid");
        const bin = await script(
            `echo $$ > ${pids}; yes xxxxxxxxxxxxxxxx; exit 0`,
        );
        const run = createHerdrRun({ bin, maxBytes: 1024 });
        await expect(
            run([], { env: {}, signal: new AbortController().signal }),
        ).rejects.toThrow("HERDR_OUTPUT_LIMIT");
        const pid = Number((await Bun.file(pids).text()).trim());
        await Bun.sleep(100);
        expect(alive(pid)).toBe(false);
    });

    it("kills a process whose signal aborts", async () => {
        const pids = join(root, "sleep.pid");
        const bin = await script(`echo $$ > ${pids}; exec sleep 30`);
        const ctl = new AbortController();
        const pending = createHerdrRun({ bin })([], {
            env: {},
            signal: ctl.signal,
        });
        pending.catch(() => {});
        await Bun.sleep(150);
        const pid = Number((await Bun.file(pids).text()).trim());
        expect(alive(pid)).toBe(true);
        ctl.abort();
        await expect(pending).rejects.toThrow("HERDR_ABORTED");
        await Bun.sleep(100);
        expect(alive(pid)).toBe(false);
    });

    it("starts nothing when the signal has already aborted", async () => {
        const marker = join(root, "never.txt");
        const bin = await script(`echo ran > ${marker}`);
        const ctl = new AbortController();
        ctl.abort();
        await expect(
            createHerdrRun({ bin })([], { env: {}, signal: ctl.signal }),
        ).rejects.toThrow("HERDR_ABORTED");
        expect(await Bun.file(marker).exists()).toBe(false);
    });

    it("reports a missing binary as an error, not a reply", async () => {
        await expect(
            createHerdrRun({ bin: join(root, "absent") })([], {
                env: {},
                signal: new AbortController().signal,
            }),
        ).rejects.toThrow();
    });
});
