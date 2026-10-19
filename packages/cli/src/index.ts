// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/index.ts
//
//

import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { StructuredCall } from "@dorothy/core";
import { config } from "@dotenvx/dotenvx";
import { type Mode, parseArgs, USAGE } from "./args.js";

// What runs each mode, and the code it exits with; nothing where it set
// its own. Each loads its packages as it runs, so a mode pays only for
// what it uses: --help, --list and --recall-server never load the SDK.
type Runners = {
    [K in Mode["kind"]]: (
        mode: Extract<Mode, { kind: K }>,
    ) => Promise<number | undefined>;
};

const commands = () => import("@dorothy/memory/commands");
const service = () => import("@dorothy/memory/service");

// This program as a command, as --claude's hooks run it: --no-env-file,
// so a project's .env never reaches the service.
const selfServe = () => [
    process.execPath,
    "--no-env-file",
    resolve(process.argv[1] ?? ""),
    "--serve",
];

// Reviews for the service: Claude Code's variables dropped first, as a
// service --mcp starts inside her Claude Code would inherit its gateway,
// which dies with the session; then Dorothy's .env by path from this
// checkout, then the agent. Off, and said, when either fails.
async function reviewAgent(): Promise<{
    call: StructuredCall;
    persona: string;
} | null> {
    try {
        const { checkoutRoot, loadDotenv, stripClaude } = await import(
            "./claude-hook.js"
        );
        stripClaude(process.env);
        const failure = loadDotenv(
            join(checkoutRoot, ".env"),
            join(checkoutRoot, ".env.keys"),
            process.env,
        );
        if (failure !== null) {
            throw new Error(`.env did not load (${failure})`);
        }
        const { prepareCliHome, structuredCall, systemPrompt } = await import(
            "@dorothy/agent"
        );
        prepareCliHome();
        return { call: structuredCall(), persona: systemPrompt };
    } catch (error) {
        process.stderr.write(
            `dorothy: reviews are off: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        return null;
    }
}

// Credentials are decrypted only for the modes that need them.
// quiet: dotenvx would otherwise log to stdout, over the TUI.
const loadCredentials = () => config({ quiet: true });

// The modes that talk to the model, which alone pay for the Agent SDK.
async function forTheModel(): Promise<void> {
    loadCredentials();
    const { prepareCliHome } = await import("@dorothy/agent");
    prepareCliHome();
}

const RUNNERS: Runners = {
    help: async () => {
        process.stdout.write(`${USAGE}\n`);
        return 0;
    },
    usage: async (mode) => {
        process.stderr.write(`dorothy: ${mode.message}\n${USAGE}\n`);
        return 2;
    },
    oneshot: async (mode) => {
        await forTheModel();
        const { runOneShot } = await import("@dorothy/agent");
        // It sets the exit code itself, should the reply fail.
        await runOneShot(mode.prompt, mode.persona);
        return undefined;
    },
    tui: async (mode) => {
        await forTheModel();
        // Loaded only for chat, so one-shot replies never pay for React.
        const { runTui } = await import("./run-tui.js");
        // runTui has closed everything by now. A push or a repack still
        // running must not hold the terminal after the chat is gone.
        process.exit(await runTui(mode.resume, mode.persona));
    },
    dump: async (mode) => {
        await forTheModel();
        const { runDump } = await import("./dump.js");
        return runDump(mode);
    },
    list: async () => {
        const { commandHistory, runList } = await commands();
        return runList({ openHistory: commandHistory() });
    },
    memory: async (mode) => {
        const { commandHistory, runMemoryEdit } = await commands();
        const { editInEditor } = await import("@dorothy/tui");
        return runMemoryEdit(mode.phrase, {
            edit: (text) => editInEditor(text),
            openHistory: commandHistory(),
        });
    },
    tags: async () => {
        const { commandHistory, runTags } = await commands();
        return runTags({ openHistory: commandHistory() });
    },
    "tags-edit": async () => {
        const { commandHistory, runTagsEdit } = await commands();
        const { editInEditor } = await import("@dorothy/tui");
        return runTagsEdit({
            edit: (text) => editInEditor(text),
            openHistory: commandHistory(),
        });
    },
    history: async (mode) => {
        const { runHistory } = await commands();
        return runHistory({ path: mode.path, count: mode.count });
    },
    restore: async (mode) => {
        const { runRestore } = await commands();
        return runRestore(mode.path, mode.rev);
    },
    rollback: async (mode) => {
        const { runRollback } = await commands();
        return runRollback(mode.rev);
    },
    check: async (mode) => {
        const { runCheck } = await commands();
        return runCheck({ staged: mode.staged });
    },
    mirror: async (mode) => {
        loadCredentials();
        const { runMirror } = await commands();
        return runMirror(mode.url);
    },
    recover: async (mode) => {
        loadCredentials();
        const { runRecover } = await commands();
        return runRecover(mode.url);
    },
    facts: async () => {
        const { commandHistory, runFacts } = await commands();
        return runFacts({ openHistory: commandHistory() });
    },
    retire: async (mode) => {
        const { commandHistory, runRetire } = await commands();
        return runRetire(mode.target, { openHistory: commandHistory() });
    },
    "retire-from": async (mode) => {
        const { commandHistory, runRetireFrom } = await commands();
        return runRetireFrom(mode.phrase, { openHistory: commandHistory() });
    },
    revive: async (mode) => {
        const { commandHistory, runRevive } = await commands();
        return runRevive(mode.target, { openHistory: commandHistory() });
    },
    verify: async (mode) => {
        const { commandHistory, runVerify } = await commands();
        return runVerify(mode.id, { openHistory: commandHistory() });
    },
    sync: async (mode) => {
        const { commandHistory, runSync } = await commands();
        return runSync(mode.path, { openHistory: commandHistory() });
    },
    projects: async () => {
        const { runProjects } = await commands();
        return runProjects();
    },
    "recall-server": async (mode) => {
        const { runRecallServer } = await import(
            "@dorothy/memory/recall-server"
        );
        return runRecallServer({
            exclude: mode.exclude,
            recollect: mode.recollect,
            project: mode.project,
        });
    },
    serve: async () => {
        const { runService } = await service();
        return runService({ review: await reviewAgent() });
    },
    "token-add": async (mode) => {
        const { runTokenAdd } = await service();
        return runTokenAdd(mode.device);
    },
    "token-revoke": async (mode) => {
        const { runTokenRevoke } = await service();
        return runTokenRevoke(mode.device);
    },
    mcp: async (mode) => {
        const { runBridge } = await import("@dorothy/memory/bridge");
        return runBridge({
            cwd: process.cwd(),
            serve: selfServe(),
            host: mode.host,
        });
    },
    "claude-hook": async (mode) => {
        // No credentials: the hook loads Dorothy's .env by path, once
        // claude's variables are gone (claude-hook.ts).
        const { runHook } = await import("./claude-hook.js");
        const code = await runHook(mode.hook);
        // A hook and a catch-up end here, as chat does: nothing they
        // started may keep a process of Claude Code's hooks alive.
        if (mode.hook.kind === "hook" || mode.hook.kind === "catch-up") {
            process.exit(code);
        }
        return code;
    },
    claude: async (mode) => {
        // No credentials: claude signs in as the user's own Claude Code does.
        const { runClaude } = await import("./claude.js");
        return runClaude(mode.args);
    },
    "claude-dump": async (mode) => {
        // No credentials, as for --claude.
        const { runClaudeDump } = await import("./claude-dump.js");
        return runClaudeDump(mode.args, mode.message);
    },
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    const mode = parseArgs(
        process.argv.slice(2),
        process.stdin.isTTY === true && process.stdout.isTTY === true,
    );
    // TypeScript cannot tie a mode to its own runner without the cast.
    const run = RUNNERS[mode.kind] as (
        mode: Mode,
    ) => Promise<number | undefined>;
    const code = await run(mode);
    if (code !== undefined) {
        process.exitCode = code;
    }
}
