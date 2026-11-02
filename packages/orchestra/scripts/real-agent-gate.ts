// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/scripts/real-agent-gate.ts
//
//

// The real-agent gate: a live check, run by the coordinating agent
// outside CI once real agents are signed in, that an agent runs in a
// worker box as the spec needs. It builds the box, the proxy and, for an
// API key, the key gateway under a temporary root, drives the agent
// through acpx's embedded runtime with fixed prompts, and judges each
// check by its effects: the proxy's and the gateway's logs, the files the
// agent's commands leave, the host's process table. Where a check needs
// the model's cooperation it records what happened. If the agent cannot
// start boxed, the build stops and returns to the user.
//
//     bun packages/orchestra/scripts/real-agent-gate.ts
//         --agent claude|codex --login subscription|api-key
//         [--login-source <dir>] [--key-env <NAME>] [--root <dir>]
//         [--pause <seconds>]
//
// A subscription's login is copied under the root from --login-source,
// a directory signed in for the run (Claude's config directory, Codex's
// home); an API key is read from the variable --key-env names and given
// to the gateway alone. It never reads secrets.json. Turns run with no
// timeout, as acpx kills the box of a turn that fails; --pause sets the
// idle pause the box must outlive (310 outlasts every timer acpx has).

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
    copyFile,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
    type AcpPermissionDecision,
    type AcpPermissionRequest,
    type AcpRuntimeHandle,
    type AcpRuntimeTurn,
    type AcpxRuntime,
    createAcpRuntime,
    createAgentRegistry,
    createFileSessionStore,
} from "acpx/runtime";
import { boxArgs, bridgeSource, systemLayout } from "../src/box/box.js";
import { processTree, survivors } from "../src/box/processes.js";
import {
    type Adapter,
    adapterFor,
    CONFIG_HOMES,
    KEY_SOCKET,
    MODES,
    PROXY_SOCKET,
    providerHosts,
    workerBox,
} from "../src/box/worker-box.js";
import type { Agent } from "../src/config.js";
import { type GatewayEntry, startKeyGateway } from "../src/net/key-gateway.js";
import {
    type ProxyEntry,
    type ProxyOptions,
    startProxy,
} from "../src/net/proxy.js";

// [orchestra] network-allow's default, which the subprocess check fetches.
const ALLOWED = "registry.npmjs.org";

// The box's processes, which the gate's own tests import from here.
export { processTree, survivors };

export type Check = {
    name: string;
    status: "PASS" | "FAIL" | "SKIP";
    detail: string;
};

export type GateOptions = {
    agent: Agent;
    login: "subscription" | "api-key";
    loginSource?: string;
    key?: string;
    root: string;
    say?: (check: Check) => void;
    // The idle pause the box must outlive; 15 seconds by default.
    pauseMs?: number;
    // Tests alone: the fake agent and its flags in place of the adapter,
    // a resolver keeping the proxy off the network, the gateway's upstream.
    adapter?: Adapter;
    agentArgs?: string[];
    resolve?: ProxyOptions["resolve"];
    upstream?: string;
};

type Policy = "allow" | "deny" | "cancel";
type Asked = { policy: Policy; offered: string[]; optionId?: string };
type Turn = {
    status: string;
    reply: string;
    asked: Asked[];
    proxy: ProxyEntry[];
    gateway: GatewayEntry[];
};

const errorText = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

const turnText = ({ status, reply }: Turn) =>
    `turn ${status}${reply === "" ? "" : `, replied ${JSON.stringify(reply.slice(0, 60))}`}`;

const run = (command: string) =>
    `Run this exact shell command with your shell tool, once, then reply with its output: \`${command}\` If a sandbox blocks it, ask for approval to run it outside the sandbox.`;

// Marks a copied login expired, so that the agent must refresh it:
// Claude's OAuth expiry, Codex's last refresh. False where it has none.
async function expire(file: string, agent: Agent): Promise<boolean> {
    const login = JSON.parse(await readFile(file, "utf8"));
    if (
        agent === "claude" &&
        typeof login.claudeAiOauth?.expiresAt === "number"
    ) {
        login.claudeAiOauth.expiresAt = 0;
    } else if (agent === "codex" && typeof login.last_refresh === "string") {
        login.last_refresh = "2000-01-01T00:00:00Z";
    } else {
        return false;
    }
    await writeFile(file, JSON.stringify(login));
    return true;
}

// Stands in for the server: starts a box, opens a session in it, prints
// the box's pid, and holds it until killed.
const HOLD = `
const [argv, cwd] = [JSON.parse(process.argv[1]), process.argv[2]];
const box = Bun.spawn(argv, { stdin: "pipe", stdout: "pipe", stderr: "ignore" });
const send = (id, method, params) =>
    box.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\\n");
send(1, "initialize", { protocolVersion: 1, clientCapabilities: {} });
send(2, "session/new", { cwd, mcpServers: [] });
const reader = box.stdout.getReader();
for (let text = ""; !/"id":2[,}]/.test(text); ) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
}
console.log(box.pid);
setInterval(() => {}, 1 << 30);
`;

async function firstLine(stream: ReadableStream<Uint8Array>, ms: number) {
    let text = "";
    const reading = (async () => {
        for await (const chunk of stream) {
            text += new TextDecoder().decode(chunk);
            if (text.includes("\n")) {
                break;
            }
        }
    })();
    await Promise.race([reading, Bun.sleep(ms)]);
    return text.trim();
}

export async function runGate(options: GateOptions): Promise<Check[]> {
    const { agent, login, root } = options;
    const checks: Check[] = [];
    const record = (name: string, pass: boolean | null, detail: string) => {
        const status = pass === null ? "SKIP" : pass ? "PASS" : "FAIL";
        checks.push({ name, status, detail });
        options.say?.({ name, status, detail });
    };

    const clone = join(root, "clone");
    const sockets = join(root, "sockets");
    const objects = join(root, "objects");
    const loginDir = join(root, "login");
    const loginFile = join(loginDir, CONFIG_HOMES[agent].login);
    for (const dir of [clone, sockets, objects]) {
        await mkdir(dir, { recursive: true, mode: 0o700 });
    }
    Bun.spawnSync(["git", "init", "--quiet", clone]);
    const admitted = `admitted-${randomUUID()}`;
    const withheld = `withheld-${randomUUID()}`;
    await writeFile(join(clone, "admitted.txt"), `${admitted}\n`);
    await writeFile(join(root, "withheld.txt"), `${withheld}\n`);
    await writeFile(join(root, "bridge.ts"), bridgeSource());
    if (login === "subscription") {
        if (options.loginSource === undefined) {
            throw new Error("a subscription needs --login-source");
        }
        await mkdir(loginDir, { mode: 0o700 });
        await copyFile(
            join(options.loginSource, CONFIG_HOMES[agent].login),
            loginFile,
        );
    } else if (!options.key) {
        throw new Error("an API key needs --key-env naming a set variable");
    }

    const proxyLog: ProxyEntry[] = [];
    const gatewayLog: GatewayEntry[] = [];
    const providers = providerHosts(agent, login);
    const proxy = await startProxy({
        socket: join(sockets, PROXY_SOCKET),
        hosts: new Set([...providers, ALLOWED]),
        log: (entry) => proxyLog.push(entry),
        resolve: options.resolve,
    });
    const gateway =
        login === "api-key"
            ? await startKeyGateway({
                  socket: join(sockets, KEY_SOCKET),
                  provider: agent === "claude" ? "anthropic" : "openai",
                  key: options.key ?? "",
                  log: (entry) => gatewayLog.push(entry),
                  upstream: options.upstream,
              })
            : null;
    const spec = await workerBox({
        agent,
        login:
            login === "subscription"
                ? { kind: "subscription", source: loginDir }
                : { kind: "api-key" },
        clone,
        objects,
        sockets,
        bridge: join(root, "bridge.ts"),
        adapter: options.adapter ?? (await adapterFor(agent)),
    });
    spec.command.push(...(options.agentArgs ?? []));
    const argv = boxArgs(spec, await systemLayout());

    // Every box the runtime starts, and the gate's answer to each request:
    // the first option of the policy's kind in the agent's order.
    const pids: number[] = [];
    const asked: Asked[] = [];
    let policy: Policy = "allow";
    let turn: AcpRuntimeTurn | undefined;
    const answer = async (
        request: AcpPermissionRequest,
    ): Promise<AcpPermissionDecision> => {
        const offered = request.raw.options;
        const kind = policy === "allow" ? "allow_once" : "reject_once";
        const option = offered.find((each) => each.kind === kind);
        asked.push({
            policy,
            offered: offered.map((each) => each.optionId),
            optionId: option?.optionId,
        });
        if (policy === "cancel") {
            void turn?.cancel({ reason: "the gate cancels" });
            return { outcome: "cancel" };
        }
        return option === undefined
            ? { outcome: "cancel" }
            : { outcome: "selected", optionId: option.optionId };
    };
    const runtime = () =>
        createAcpRuntime({
            cwd: clone,
            sessionStore: createFileSessionStore({
                stateDir: join(root, "state"),
            }),
            agentRegistry: createAgentRegistry({ overrides: { worker: argv } }),
            permissionMode: "deny-all",
            fs: false,
            terminal: false,
            agentProcessEnvAllow: [],
            processLifecycle: { onSpawned: ({ pid }) => void pids.push(pid) },
            onPermissionRequest: answer,
        });
    const session = (rt: AcpxRuntime, key: string) =>
        rt.ensureSession({
            sessionKey: key,
            agent: "worker",
            mode: "persistent",
            cwd: clone,
        });
    const prompt = async (
        rt: AcpxRuntime,
        handle: AcpRuntimeHandle,
        text: string,
        as: Policy = "allow",
    ): Promise<Turn> => {
        policy = as;
        const from = [asked.length, proxyLog.length, gatewayLog.length];
        turn = rt.startTurn({
            handle,
            text,
            mode: "prompt",
            requestId: randomUUID(),
        });
        let reply = "";
        for await (const event of turn.events) {
            if (event.type === "text_delta" && event.stream !== "thought") {
                reply += event.text;
            }
        }
        const result = await turn.result;
        return {
            status:
                result.status === "failed"
                    ? `failed (${result.error.message})`
                    : result.status,
            reply: reply.trim(),
            asked: asked.slice(from[0]),
            proxy: proxyLog.slice(from[1]),
            gateway: gatewayLog.slice(from[2]),
        };
    };
    const modeOf = async (rt: AcpxRuntime, handle: AcpRuntimeHandle) => {
        const { details } = await rt.getStatus({ handle });
        const configured = (details?.configOptions ?? []) as {
            id: string;
            currentValue?: unknown;
        }[];
        return String(
            configured.find(({ id }) => id === "mode")?.currentValue ?? "none",
        );
    };
    const ran = (marker: string) => existsSync(join(clone, marker));
    // An answered turn: asked, answered by an option of the policy's
    // kind, and the command run or not as the answer says.
    const answered = (name: string, t: Turn, marker: string) => {
        const as = t.asked[0]?.policy;
        const missing = t.asked.find(
            (each) => as !== "cancel" && each.optionId === undefined,
        );
        const done = ran(marker);
        if (as === undefined) {
            return record(
                name,
                false,
                `incomplete: the agent asked nothing; the command ${done ? "ran" : "did not run"}`,
            );
        }
        if (missing !== undefined) {
            const kind = as === "allow" ? "allow_once" : "reject_once";
            return record(
                name,
                false,
                `no ${kind} among ${missing.offered.join(", ")}`,
            );
        }
        const ids = t.asked.map((each) =>
            as === "cancel" ? "cancel" : each.optionId,
        );
        record(
            name,
            as === "allow"
                ? done
                : !done && (as === "deny" || t.status === "cancelled"),
            `answered ${ids.join(", ")}; ${turnText(t)}; the command ${done ? "ran" : "did not run"}`,
        );
    };

    let rt = runtime();
    try {
        let handle: AcpRuntimeHandle;
        try {
            handle = await session(rt, "gate");
            record(
                "boxed start",
                true,
                `bwrap ${pids[0]}, ${argv.length} arguments`,
            );
        } catch (error) {
            record(
                "boxed start",
                false,
                `${errorText(error)}; the build stops and returns to the user`,
            );
            return checks;
        }
        const mode = await rt
            .setMode({ handle, mode: MODES[agent] })
            .then(() => modeOf(rt, handle), errorText);
        record("mode", mode === MODES[agent], `reports ${mode}`);

        const ready = await prompt(
            rt,
            handle,
            "Reply with the single word: ready",
        );
        const replied = ready.status === "completed" && ready.reply !== "";
        if (login === "subscription") {
            const seen = ready.proxy.filter(({ host }) =>
                providers.includes(host),
            );
            record(
                "model traffic through the proxy",
                replied && seen.length > 0,
                `${seen.map(({ host, decision }) => `${host} ${decision}`).join(", ") || "no provider host at the proxy"}; ${turnText(ready)}`,
            );
        } else {
            const served = ready.gateway.filter(({ status }) => status < 400);
            record(
                "API key through the gateway",
                replied && served.length > 0,
                ready.gateway.length === 0
                    ? `no request reached the gateway: the agent ignores the base URL, so its key enters the box as admitted-key and the report says so; ${turnText(ready)}`
                    : `gateway answered ${ready.gateway.map(({ status }) => status).join(", ")}; ${turnText(ready)}`,
            );
        }

        const allowed = await prompt(
            rt,
            handle,
            run(
                `curl -sS --max-time 20 -o /dev/null https://${ALLOWED}/; touch "$HOME/.gate" && touch gate-allowed`,
            ),
        );
        const fetched = allowed.proxy.filter(({ host }) => host === ALLOWED);
        record(
            "subprocess traffic through the proxy",
            fetched.length > 0,
            fetched.length > 0
                ? `${ALLOWED} ${fetched[0]?.decision}`
                : `no request for ${ALLOWED} at the proxy; ${turnText(allowed)}`,
        );
        answered(
            "permission allowed once by exact option",
            allowed,
            "gate-allowed",
        );

        const written = join(root, "written");
        const probe = await prompt(
            rt,
            handle,
            run(
                `{ cat admitted.txt; cat ${join(root, "withheld.txt")}; echo x > ${written}; echo x > "$HOME/.gate-home" && echo home-written; } > gate-probe 2>&1`,
            ),
        );
        const out = await readFile(join(clone, "gate-probe"), "utf8").catch(
            () => null,
        );
        const inside = !existsSync(written) && !out?.includes(withheld);
        if (out === null) {
            record(
                "box admits and withholds",
                false,
                `the command did not run; ${turnText(probe)}`,
            );
            record("nested sandbox", null, "the probe did not run");
        } else {
            record(
                "box admits and withholds",
                out.includes(admitted) && inside,
                `the clone ${out.includes(admitted) ? "read" : "unread"}; a host file ${out.includes(withheld) ? "read" : "unread"}; a host write ${existsSync(written) ? "made" : "kept from the host"}`,
            );
            record(
                "nested sandbox",
                true,
                out.includes("home-written")
                    ? "inactive: the agent's commands wrote the box's home"
                    : "active: the agent's own sandbox kept its commands from the box's home",
            );
        }
        record(
            "escalation stays in the box",
            probe.asked.length > 0 && inside,
            probe.asked.length === 0
                ? "the agent asked nothing"
                : `${probe.asked.length} allowed; ${inside ? "nothing reached past the box" : "an effect reached past the box"}`,
        );

        const denied = await prompt(
            rt,
            handle,
            run(`touch "$HOME/.gate" && touch gate-denied`),
            "deny",
        );
        answered("permission denied by exact option", denied, "gate-denied");
        const cancelled = await prompt(
            rt,
            handle,
            run(`touch "$HOME/.gate" && touch gate-cancelled`),
            "cancel",
        );
        answered("permission cancelled", cancelled, "gate-cancelled");

        // Workers live as long as the server, so the box must outlive its
        // turns: one agent process, its home's count climbing, through
        // turns, a setMode and an idle pause.
        const boxes = pids.length;
        const count = `n=$(cat "$HOME/.gate-count" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$HOME/.gate-count"; echo $n >> gate-count`;
        await prompt(rt, handle, run(count));
        await rt.setMode({ handle, mode: MODES[agent] }).catch(() => {});
        await prompt(rt, handle, run(count));
        await Bun.sleep(options.pauseMs ?? 15_000);
        const last = await prompt(rt, handle, run(count));
        const counts = (
            await readFile(join(clone, "gate-count"), "utf8").catch(() => "")
        )
            .split("\n")
            .filter(Boolean);
        record(
            "box survives turns, a setMode and a pause",
            pids.length === boxes && counts.join(",") === "1,2,3",
            `${pids.length - boxes} boxes started since; the home counted ${counts.join(", ") || "nothing"}; ${turnText(last)}`,
        );
        const tree = await processTree(pids.at(-1) ?? 0);
        await rt.close({ handle, reason: "the gate stops" });
        await rt.shutdown();
        const left = await survivors(tree);
        record(
            "process tree gone after stop",
            tree.length > 0 && left.length === 0,
            left.length === 0
                ? `${tree.length} processes gone`
                : `left running: ${left.map(({ pid }) => pid).join(", ")}`,
        );

        if (login === "subscription") {
            const fresh = async (key: string, word: string) => {
                rt = runtime();
                const h = await session(rt, key);
                const t = await prompt(
                    rt,
                    h,
                    `Reply with the single word: ${word}`,
                );
                await rt.close({ handle: h, reason: "the gate stops" });
                await rt.shutdown();
                return t;
            };
            if (await expire(loginFile, agent)) {
                const file = await readFile(loginFile, "utf8");
                const refreshed = await fresh("refresh", "refreshed");
                const kept = (await readFile(loginFile, "utf8")) === file;
                record(
                    "login refresh under a read-only mount",
                    refreshed.status === "completed" &&
                        refreshed.reply !== "" &&
                        kept,
                    `expired, ${turnText(refreshed)}; the mounted login ${kept ? "unchanged" : "changed"}`,
                );
                const next = await fresh("persist", "persisted");
                record(
                    "login persists for the next box",
                    next.status === "completed" && next.reply !== "",
                    turnText(next),
                );
            } else {
                const why = `no expiry in ${CONFIG_HOMES[agent].login} to force a refresh`;
                record("login refresh under a read-only mount", null, why);
                record("login persists for the next box", null, why);
            }
        }

        const server = Bun.spawn(
            [process.execPath, "-e", HOLD, JSON.stringify(argv), clone],
            { stdout: "pipe", stderr: "ignore" },
        );
        const held = await processTree(
            Number(await firstLine(server.stdout, 60_000)),
        );
        server.kill("SIGKILL");
        const orphans = await survivors(held);
        record(
            "process tree gone after the server is killed",
            held.length > 0 && orphans.length === 0,
            orphans.length === 0
                ? `${held.length} processes gone`
                : `left running: ${orphans.map(({ pid }) => pid).join(", ")}`,
        );
    } finally {
        await rt.shutdown().catch(() => {});
        await proxy.close();
        await gateway?.close();
        await rm(loginDir, { recursive: true, force: true });
    }
    return checks;
}

if (import.meta.main) {
    const { values } = parseArgs({
        options: {
            agent: { type: "string" },
            login: { type: "string" },
            "login-source": { type: "string" },
            "key-env": { type: "string" },
            root: { type: "string" },
            pause: { type: "string" },
        },
    });
    const { agent, login } = values;
    if (
        (agent !== "claude" && agent !== "codex") ||
        (login !== "subscription" && login !== "api-key")
    ) {
        console.error(
            "usage: real-agent-gate.ts --agent claude|codex --login subscription|api-key [--login-source <dir>] [--key-env <NAME>] [--root <dir>] [--pause <seconds>]",
        );
        process.exit(2);
    }
    const name = values["key-env"];
    const key = name === undefined ? undefined : process.env[name];
    if (name !== undefined) {
        delete process.env[name];
    }
    const root =
        values.root ?? (await mkdtemp(join(tmpdir(), "real-agent-gate-")));
    await mkdir(root, { recursive: true });
    let code = 1;
    try {
        const checks = await runGate({
            agent,
            login,
            loginSource: values["login-source"],
            key,
            root: await realpath(root),
            pauseMs:
                values.pause === undefined
                    ? undefined
                    : Number(values.pause) * 1000,
            say: ({ status, name, detail }) =>
                console.log(`${status} ${name}: ${detail}`),
        });
        code = checks.some(({ status }) => status === "FAIL") ? 1 : 0;
    } catch (error) {
        console.log(`FAIL gate: ${errorText(error)}`);
    } finally {
        if (values.root === undefined) {
            await rm(root, { recursive: true, force: true });
        }
    }
    process.exit(code);
}
