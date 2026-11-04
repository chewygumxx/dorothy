// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/probe-pi-delivery.ts
//
//

// The bounded smoke test of `dorothy --pi` on its wire:
//
//   bun scripts/probe-pi-delivery.ts --offline --out <dir>
//   bun scripts/probe-pi-delivery.ts --live --out <dir> --max-usd <n>
//     [--max-turns 6] [--timeout-ms 120000]
//
// Pi's native interface runs in a pseudo-terminal on private roots, with
// her real `--pi-hook`, `--mcp` and memory service, two human turns (one
// calling a tool, thinking on; one with thinking off), then a sweep. Its
// model requests pass through a forwarding proxy on loopback
// (`pi-proxy.ts`, shared with the stewardship trial), which
// counts each one (compaction and retries alike), forwards only Chat
// Completions for the one model, holds the upstream key and gives Pi a
// synthetic one, and reserves a call's worst cost before forwarding it.
// Offline, the upstream is a scripted endpoint; live, Featherless, with
// the key from secrets.json through the checkout's loader, into an object
// of its own. `--live` never runs without `--max-usd`. The result goes
// to <dir>/result.json and <dir>/report.md, holding shapes, counts and
// costs, never a key or a prompt. This is a probe, not a gateway: it is
// never run by `bun run test`.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
    archive,
    deliveryEnv,
    KEYS,
    launchNative,
    SELF,
    startMemoryService,
    sweepOnce,
} from "../packages/cli/src/hosts/pi/delivery-testing.js";
import { readPiCatalog } from "../packages/cli/src/hosts/pi/models.js";
import { resolvePiRuntime } from "../packages/cli/src/hosts/pi/runtime.js";
import {
    type Captured,
    CLI_DIR,
    called,
    finish,
    MODEL,
    piRoots,
    reasoning,
    reply,
    SYNTHETIC_KEY,
    startFakeProvider,
    usage,
} from "../packages/cli/src/hosts/pi/testing.js";
import {
    type Call,
    FEATHERLESS,
    liveKey,
    type Message,
    type Metadata,
    refreshMetadata,
    startForwardingProxy,
} from "./pi-proxy.js";

// The proxy, shared with the stewardship trial, as this probe's tests
// import it.
export {
    CATALOGUE,
    type Call,
    costOf,
    FEATHERLESS,
    type ForwardingProxy,
    type Price,
    type ProxyOptions,
    startForwardingProxy,
    type Usage,
} from "./pi-proxy.js";

export type ProbeArgs = {
    mode: "offline" | "live";
    out: string;
    maxUsd: number;
    maxTurns: number;
    timeoutMs: number;
};

const USAGE =
    "usage: probe-pi-delivery.ts --offline --out <dir>\n" +
    "       probe-pi-delivery.ts --live --out <dir> --max-usd <n> " +
    "[--max-turns <n>] [--timeout-ms <ms>]";

// The probe's arguments, or what is wrong with them.
export function parseProbeArgs(argv: readonly string[]): ProbeArgs | string {
    let mode: ProbeArgs["mode"] | null = null;
    let out: string | null = null;
    let maxUsd: number | null = null;
    let maxTurns = 6;
    let timeoutMs = 120_000;
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
        if (word === "--offline" || word === "--live") {
            if (mode !== null) return `${USAGE}\none of --offline, --live`;
            mode = word === "--live" ? "live" : "offline";
        } else if (word === "--out" && value !== undefined) {
            out = resolve(value);
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
    if (mode === null || out === null) return USAGE;
    // Offline spends nothing; live spends only what is named.
    if (mode === "live" && maxUsd === null)
        return `${USAGE}\n--live needs --max-usd: no spending limit is assumed`;
    return { mode, out, maxUsd: maxUsd ?? 0, maxTurns, timeoutMs };
}

// The two human turns, as typed into Pi.
export const PROMPTS = [
    "This is an automated connectivity probe. Call the bash tool exactly " +
        "once, with the command: echo dorothy-probe. After it returns, " +
        "reply with the single word DONE.",
    "Reply with the single word OK.",
] as const;

// The scripted upstream for the offline run: the replies a model would
// give the probe, with usage, as Featherless streams them.
function offlineUpstream() {
    const textOf = (message: Message) =>
        typeof message.content === "string"
            ? message.content
            : ((message.content ?? []) as { text?: string }[])
                  .map((part) => part.text ?? "")
                  .join("");
    return startFakeProvider((request: Captured) => {
        const messages = (request.body.messages ?? []) as Message[];
        const last = messages.at(-1);
        const prompt = textOf(
            messages.findLast((message) => message.role === "user") ?? {},
        );
        if (prompt === PROMPTS[0] && last?.role === "user")
            return [
                reasoning("Synthetic probe thought."),
                called("call-probe", "bash", { command: "echo dorothy-probe" }),
                finish("tool_calls"),
                usage,
            ];
        if (prompt === PROMPTS[0]) return reply("DONE");
        return reply("OK");
    });
}

type Check = { id: string; ok: boolean | null; detail: string };

// Pi's saved assistant replies that end a turn, across the roots.
async function settledReplies(sessions: string): Promise<number> {
    let count = 0;
    for (const name of await readdir(sessions, { recursive: true }).catch(
        () => [] as string[],
    )) {
        if (!name.endsWith(".jsonl")) continue;
        const text = await readFile(join(sessions, name), "utf8");
        for (const line of text.split("\n")) {
            if (!line.includes('"assistant"')) continue;
            try {
                const entry = JSON.parse(line);
                if (
                    entry.type === "message" &&
                    entry.message?.role === "assistant" &&
                    entry.message.stopReason !== "toolUse"
                )
                    count++;
            } catch {}
        }
    }
    return count;
}

export type ProbeResult = {
    mode: ProbeArgs["mode"];
    outcome: "pass" | "fail" | "pending";
    startedAt: string;
    finishedAt: string;
    versions: { pi: string; node: string; bun: string };
    model: string;
    endpoint: string;
    limits: { maxUsd: number; maxTurns: number; timeoutMs: number };
    spentUsd: number;
    costSource: string;
    stopped: string | null;
    metadata: Metadata | null;
    calls: Call[];
    checks: Check[];
    pending: string[];
    screen: string;
};

export async function probe(args: ProbeArgs): Promise<ProbeResult> {
    const startedAt = new Date().toISOString();
    const [declared] = (await readPiCatalog()).filter((m) => m.id === MODEL);
    if (declared === undefined) throw new Error(`no manifest for ${MODEL}`);
    const price = {
        input: declared.price.input,
        output: declared.price.output,
        cacheRead: declared.price.cacheRead ?? declared.price.input,
    };
    const pending: string[] = [];
    let metadata: Metadata | null = null;
    let fake: ReturnType<typeof startFakeProvider> | null = null;
    let upstream: string;
    let key: string;
    // The catalogue and the key first: nothing is started that a failure
    // here would leave running.
    if (args.mode === "live") {
        metadata = await refreshMetadata(MODEL).catch((error: Error) => {
            pending.push(`catalogue unread: ${error.name}`);
            return null;
        });
        upstream = FEATHERLESS;
        key = await liveKey();
    } else {
        fake = offlineUpstream();
        upstream = fake.baseUrl;
        key = "offline-upstream-key";
    }
    const roots = await piRoots();
    const service = await startMemoryService(roots);
    const env = deliveryEnv(roots, service.url);
    // Offline, a nominal cap on the scripted endpoint's priced usage.
    const cap = args.mode === "live" ? args.maxUsd : 1;
    const proxy = startForwardingProxy({
        upstream,
        model: MODEL,
        key,
        maxUsd: cap,
        maxTurns: args.maxTurns,
        timeoutMs: args.timeoutMs,
        contextWindow: declared.contextWindow,
        maxTokens: declared.maxTokens,
        price,
    });
    const sessions = join(roots.root, "data", "dorothy", "pi", "sessions");
    let screen = "";
    let swept = { code: -1, out: "", err: "" };
    let conversations: Awaited<ReturnType<typeof archive>> = [];
    try {
        const pi = await launchNative(roots, {
            env,
            self: SELF,
            baseUrl: proxy.baseUrl,
            args: ["--thinking", "high"],
        });
        try {
            const settle = async (turns: number) => {
                const until = Date.now() + args.timeoutMs * 2;
                while ((await settledReplies(sessions)) < turns) {
                    if (Date.now() > until || proxy.stopped() !== null)
                        throw new Error(
                            `turn ${turns} unsettled (${proxy.stopped() ?? "time"})`,
                        );
                    await Bun.sleep(250);
                }
            };
            await pi.waitFor("v1.5.0");
            await pi.send(PROMPTS[0]);
            await settle(1);
            // The first Enter takes the completion Pi offers for the
            // argument; the second runs the command.
            await pi.send("/thinking off");
            await Bun.sleep(300);
            pi.type(KEYS.enter);
            await pi.waitFor("Thinking level: off");
            await pi.send(PROMPTS[1]);
            await settle(2);
            await pi.send("/quit");
            await pi.exited;
        } catch (error) {
            pending.push(`scenario: ${(error as Error).message}`);
            await pi.kill();
        } finally {
            screen = pi.screen();
        }
    } finally {
        await service.stop();
        await proxy.close();
        await fake?.close();
    }
    const runtime = await resolvePiRuntime(CLI_DIR, env);
    const node = Bun.spawnSync([runtime.command[0] ?? "node", "--version"]);
    swept = await sweepOnce(env);
    conversations = await archive(env);

    const calls = proxy.calls;
    const forwarded = calls.filter((call) => call.refused === null);
    const [first, second, third] = forwarded;
    const checks: Check[] = [];
    const check = (id: string, ok: boolean | null, detail: string) =>
        checks.push({ id, ok, detail });
    check(
        "system-role",
        forwarded.length > 0 &&
            forwarded.every(
                (call) =>
                    call.roles[0] === "system" &&
                    !call.roles.includes("developer"),
            ),
        "every request opens with a system message; no developer role",
    );
    check(
        "no-store",
        forwarded.every((call) => !call.store),
        "no request carries an OpenAI `store` field",
    );
    check(
        "max-completion-tokens",
        forwarded.every(
            (call) => call.maxCompletionTokens !== null && !call.maxTokens,
        ),
        `max_completion_tokens on every request (${[
            ...new Set(forwarded.map((call) => call.maxCompletionTokens)),
        ].join(", ")}), no max_tokens`,
    );
    check(
        "thinking",
        first?.thinking === true &&
            second?.thinking === true &&
            third?.thinking === false,
        "chat_template_kwargs.thinking true at high, false after " +
            "/thinking off",
    );
    const toolCalls = first?.reply.toolCalls ?? [];
    check(
        "tool-call",
        toolCalls.length === 1 &&
            JSON.stringify(second?.toolResults) === JSON.stringify(toolCalls),
        `the first reply called ${toolCalls.length} tool(s); the next ` +
            "request answered the same ids",
    );
    const thought = first?.reply.reasoning ?? null;
    check(
        "reasoning-replay",
        thought === null
            ? null
            : (second?.replayedReasoning.includes(thought) ?? false),
        thought === null
            ? "the first reply streamed no reasoning: not exercised"
            : `the tool-calling reply's reasoning, streamed as ` +
                  `${first?.reply.reasoningField}, came back on the next ` +
                  "request, unchanged (by digest)",
    );
    check(
        "synthetic-key",
        calls.length > 0 && calls.every((call) => call.syntheticKey),
        "Pi sent the synthetic key alone; the proxy held the upstream one",
    );
    check(
        "loadout",
        forwarded.every((call) =>
            [
                "bash",
                "mcp__dorothy_memory__search",
                "read",
                "write",
                "edit",
            ].every((name) => call.tools.includes(name)),
        ),
        `tools: ${first?.tools.join(", ") ?? "none"}`,
    );
    const said = conversations.flatMap((c) => c.events);
    check(
        "recorded",
        swept.code === 0 &&
            said.filter((event) => event.kind === "user").length === 2 &&
            said.filter((event) => event.kind === "tool").length === 1,
        `archive: ${conversations.length} conversation(s), ` +
            `${said.length} events; sweep: ${swept.out.trim()}`,
    );
    check(
        "within-limits",
        forwarded.length <= args.maxTurns && proxy.spentUsd() <= cap,
        `${calls.length} request(s), ${forwarded.length} forwarded, ` +
            `US$${proxy.spentUsd().toFixed(6)}`,
    );
    // No file the run left holds the upstream key or the synthetic one.
    let leaked = false;
    for (const name of await readdir(roots.root, { recursive: true })) {
        const text = await readFile(join(roots.root, name), "utf8").catch(
            () => "",
        );
        if (text.includes(key) || text.includes(SYNTHETIC_KEY)) leaked = true;
    }
    check("no-key-at-rest", !leaked, "no file under the roots holds a key");
    await roots.close();
    // Live, a fault of the endpoint's (a limit, an outage, the model
    // gone) leaves the gate pending, not failed.
    const external =
        args.mode === "live" &&
        (calls.some((call) => call.status === 429 || call.status >= 500) ||
            metadata?.found === false);
    if (external) pending.push("the endpoint refused or failed a call");
    const failed = checks.some((c) => c.ok === false) || pending.length > 0;
    const outcome = !failed ? "pass" : external ? "pending" : "fail";
    return {
        mode: args.mode,
        outcome,
        startedAt,
        finishedAt: new Date().toISOString(),
        versions: {
            pi: runtime.version,
            node: new TextDecoder().decode(node.stdout).trim(),
            bun: Bun.version,
        },
        model: MODEL,
        endpoint: args.mode === "live" ? FEATHERLESS : "scripted loopback",
        limits: {
            maxUsd: cap,
            maxTurns: args.maxTurns,
            timeoutMs: args.timeoutMs,
        },
        spentUsd: proxy.spentUsd(),
        costSource:
            "each reply's streamed usage x the manifest's prices " +
            "(packages/cli/assets/pi/models.json); a reply without usage " +
            "keeps its reservation",
        stopped: proxy.stopped(),
        metadata,
        calls,
        checks,
        pending,
        screen: sanitize(screen, roots.root, key),
    };
}

// The screen's last lines, the roots and any key replaced: a redrawn
// terminal as plain text, its rules and padding dropped and repeats
// folded.
function sanitize(screen: string, root: string, key: string): string {
    const lines = screen
        .replaceAll(key, "<key>")
        .replaceAll(SYNTHETIC_KEY, "<synthetic key>")
        .replaceAll(root, "<roots>")
        .replace(/[─━]{3,}/g, "\n")
        .replace(/ {3,}/g, "\n")
        .split("\n")
        .map((line) => line.trim())
        .filter((line, at, all) => line !== "" && line !== all[at - 1]);
    return lines.slice(-40).join("\n");
}

export function markdown(result: ProbeResult): string {
    const mark = (ok: boolean | null) =>
        ok === null ? "not exercised" : ok ? "pass" : "FAIL";
    const lines = [
        `# Pi delivery probe: ${result.mode}`,
        "",
        `Outcome: ${result.outcome}. Model ${result.model} at ` +
            `${result.endpoint}; Pi ${result.versions.pi}, Node ` +
            `${result.versions.node}, Bun ${result.versions.bun}.`,
        "",
        `Limits: US$${result.limits.maxUsd}, ${result.limits.maxTurns} ` +
            `requests, ${result.limits.timeoutMs} ms a request. Spent ` +
            `US$${result.spentUsd.toFixed(6)} (${result.costSource}).` +
            (result.stopped ? ` Stopped: ${result.stopped}.` : ""),
        "",
        "| Check | Result | Detail |",
        "| --- | --- | --- |",
        ...result.checks.map(
            (c) => `| ${c.id} | ${mark(c.ok)} | ${c.detail} |`,
        ),
        "",
        "| # | Status | Roles | Thinking | Reply | Usage | Cost |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...result.calls.map(
            (c) =>
                `| ${c.n} | ${c.refused ?? c.status} | ${c.roles.join(" ")} ` +
                `| ${String(c.thinking)} | ${c.reply.finish ?? "-"}` +
                `${c.reply.toolCalls.length ? ` (${c.reply.toolCalls.length} call)` : ""}` +
                `${c.reply.reasoning ? ", reasoning" : ""} | ` +
                `${c.reply.usage ? `${c.reply.usage.prompt}/${c.reply.usage.completion}` : "none"} ` +
                `| ${c.costUsd === null ? "-" : c.costUsd.toFixed(6)} |`,
        ),
        "",
    ];
    if (result.metadata) {
        const m = result.metadata;
        lines.push(
            `Catalogue (${m.source}, ${m.checkedAt}): listed ${m.found}, ` +
                `context ${m.contextWindow}, max output ${m.maxTokens}, ` +
                `price ${m.price.input}/${m.price.output}. Drift: ` +
                `${m.drift.length === 0 ? "none" : m.drift.join("; ")}.`,
            "",
        );
    }
    if (result.pending.length > 0)
        lines.push("Pending:", "", ...result.pending.map((p) => `- ${p}`), "");
    lines.push("Screen at the end:", "", "```text", result.screen, "```", "");
    return lines.join("\n");
}

if (import.meta.main) {
    const args = parseProbeArgs(process.argv.slice(2));
    if (typeof args === "string") {
        process.stderr.write(`${args}\n`);
        process.exit(2);
    }
    await mkdir(args.out, { recursive: true, mode: 0o700 });
    const result = await probe(args);
    await writeFile(
        join(args.out, "result.json"),
        `${JSON.stringify(result, null, 2)}\n`,
    );
    await writeFile(join(args.out, "report.md"), markdown(result));
    process.stdout.write(
        `probe ${result.mode}: ${result.outcome}, ${result.calls.length} ` +
            `request(s), US$${result.spentUsd.toFixed(6)}; ${args.out}\n`,
    );
    process.exit(result.outcome === "pass" ? 0 : 1);
}
