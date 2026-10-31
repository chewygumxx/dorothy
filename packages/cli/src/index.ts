// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/index.ts
//
//

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Env, SecretsCode, StructuredCall } from "@dorothy/core";
import { ambient } from "./ambient.js";
import { type Mode, parseArgs, USAGE } from "./args.js";
import {
    type CheckoutSecretsDeps,
    checkoutRoot,
    loadCheckoutSecrets,
    stripClaude,
} from "./claude-hook.js";
import { selfServe } from "./self.js";

// What runs each mode, and the code it exits with; nothing where it set
// its own. Each loads its packages as it runs, so a mode pays only for
// what it uses: --help, --list and --recall-server never load the SDK.
type Runners = {
    [K in Mode["kind"]]: (
        mode: Extract<Mode, { kind: K }>,
    ) => Promise<number | undefined>;
};

// What a command opens the data directory's history on.
const history = () => {
    const { env, err, hook } = ambient();
    return { env, err, hook };
};

const commands = () => import("@dorothy/memory/commands");
const service = () => import("@dorothy/memory/service");

const writeError = (text: string): void => {
    process.stderr.write(text);
};

// Reviews for the service: Claude Code's variables dropped first, as a
// service --mcp starts inside her Claude Code would inherit its gateway,
// which dies with the session; then Dorothy's secrets by path from this
// checkout, then the agent. Off, and said, when either fails; the
// service keeps the reason in its log, as its stderr may be ignored.
export async function reviewAgent(
    deps: CredentialDeps = {},
): Promise<
    | { review: { call: StructuredCall; persona: string } }
    | { review: null; noReviews: string }
> {
    const write = deps.write ?? writeError;
    try {
        const env = deps.env ?? process.env;
        stripClaude(env);
        const failure = await loadCheckoutSecrets(env, deps);
        if (failure !== null) {
            throw new Error(`secrets.json did not load (${failure})`);
        }
        const { prepareCliHome, structuredCall, systemPrompt } = await import(
            "@dorothy/agent"
        );
        prepareCliHome();
        return { review: { call: structuredCall(), persona: systemPrompt } };
    } catch (error) {
        const noReviews =
            error instanceof Error ? error.message : String(error);
        write(`dorothy: reviews are off: ${noReviews}\n`);
        return { review: null, noReviews };
    }
}

export type CredentialDeps = CheckoutSecretsDeps & {
    env?: Env;
    write?: (text: string) => void;
};

// Decrypt only for modes that need credentials. A failed load warns by
// code and leaves the mode to report its missing credential as before.
export async function loadCredentials(
    deps: CredentialDeps = {},
): Promise<SecretsCode | null> {
    const failure = await loadCheckoutSecrets(deps.env ?? process.env, deps);
    if (failure !== null) {
        (deps.write ?? writeError)(
            `dorothy: secrets not loaded (${failure})\n`,
        );
    }
    return failure;
}

// The modes that talk to the model, which alone pay for the Agent SDK.
export async function forTheModel(
    deps: CredentialDeps & { prepare?: () => Promise<void> } = {},
): Promise<void> {
    await loadCredentials(deps);
    if (deps.prepare !== undefined) {
        await deps.prepare();
    } else {
        const { prepareCliHome } = await import("@dorothy/agent");
        prepareCliHome();
    }
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
        return runList({ openHistory: commandHistory(history()) });
    },
    memory: async (mode) => {
        const { commandHistory, runMemoryEdit } = await commands();
        const { editInEditor } = await import("@dorothy/tui/editor");
        return runMemoryEdit(mode.phrase, {
            edit: (text) => editInEditor(text),
            openHistory: commandHistory(history()),
        });
    },
    tags: async () => {
        const { commandHistory, runTags } = await commands();
        return runTags({ openHistory: commandHistory(history()) });
    },
    "tags-edit": async () => {
        const { commandHistory, runTagsEdit } = await commands();
        const { editInEditor } = await import("@dorothy/tui/editor");
        return runTagsEdit({
            edit: (text) => editInEditor(text),
            openHistory: commandHistory(history()),
        });
    },
    history: async (mode) => {
        const { runHistory } = await commands();
        return runHistory({
            ...ambient(),
            path: mode.path,
            count: mode.count,
        });
    },
    restore: async (mode) => {
        const { runRestore } = await commands();
        return runRestore(mode.path, mode.rev, ambient());
    },
    rollback: async (mode) => {
        const { runRollback } = await commands();
        return runRollback(mode.rev, ambient());
    },
    check: async (mode) => {
        const { runCheck } = await commands();
        return runCheck({ ...ambient(), staged: mode.staged });
    },
    mirror: async (mode) => {
        const secretsFailure = await loadCredentials();
        const { runMirror } = await commands();
        return runMirror(mode.url, {
            ...ambient(),
            checkoutRoot,
            secretsFailure,
        });
    },
    recover: async (mode) => {
        await loadCredentials();
        const { runRecover } = await commands();
        return runRecover(mode.url, ambient());
    },
    facts: async () => {
        const { commandHistory, runFacts } = await commands();
        return runFacts({ openHistory: commandHistory(history()) });
    },
    retire: async (mode) => {
        const { commandHistory, runRetire } = await commands();
        return runRetire(mode.target, {
            openHistory: commandHistory(history()),
        });
    },
    "retire-from": async (mode) => {
        const { commandHistory, runRetireFrom } = await commands();
        return runRetireFrom(mode.phrase, {
            openHistory: commandHistory(history()),
        });
    },
    revive: async (mode) => {
        const { commandHistory, runRevive } = await commands();
        return runRevive(mode.target, {
            openHistory: commandHistory(history()),
        });
    },
    verify: async (mode) => {
        const { commandHistory, runVerify } = await commands();
        return runVerify(mode.id, { openHistory: commandHistory(history()) });
    },
    sync: async (mode) => {
        const { commandHistory, runSync } = await commands();
        return runSync(mode.path, { openHistory: commandHistory(history()) });
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
        return runService(await reviewAgent());
    },
    "token-add": async (mode) => {
        const { runTokenAdd } = await service();
        return runTokenAdd(mode.device);
    },
    "token-revoke": async (mode) => {
        const { runTokenRevoke } = await service();
        return runTokenRevoke(mode.device);
    },
    sweep: async (mode) => {
        const { runSweep } = await service();
        return runSweep({ backfill: mode.backfill, reread: mode.reread });
    },
    "sweep-dismiss": async (mode) => {
        const { runSweepDismiss } = await service();
        return runSweepDismiss(mode.host, mode.session);
    },
    "review-backfill": async (mode) => {
        // Reviews as the hooks and the service get them, on the plan's token.
        const { runBackfillReview } = await import("./review-backfill.js");
        return runBackfillReview(mode.count, { agent: reviewAgent });
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
        // No credentials: the hook loads Dorothy's secrets by path, once
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
    hook: async (mode) => {
        const { runHostHook } = await import("@dorothy/memory/host-hook");
        const out = await runHostHook(
            mode.host,
            mode.event,
            await Bun.stdin.text(),
            { serve: selfServe() },
        );
        process.stdout.write(out);
        // Like her Claude Code hooks, nothing started may hold the host.
        process.exit(0);
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
    codex: async (mode) => {
        // No credentials: codex signs in as the user's own Codex does.
        const { runCodex } = await import("./hosts/codex.js");
        return runCodex(mode.args);
    },
    "codex-dump": async (mode) => {
        const { codexCommand } = await import("./hosts/codex.js");
        const command = await codexCommand(mode.args);
        if (command === null) {
            return 1;
        }
        process.stdout.write(`${JSON.stringify(command, null, 2)}\n`);
        return 0;
    },
    install: async (mode) => {
        const { installHermes, uninstallHermes } = await import(
            "./hosts/hermes.js"
        );
        const { identityPrompt } = await import("@dorothy/identity");
        const { mainEntry, selfCommand } = await import("./self.js");
        const self = selfCommand();
        const entry =
            mode.entry === null
                ? mainEntry(self[2] ?? "")
                : resolve(mode.entry);
        if (entry === null) {
            writeError("dorothy: no main checkout found for her command\n");
            return 1;
        }
        if (entry !== self[2]) {
            writeError(`dorothy: using the main checkout's ${entry}\n`);
        }
        const deps = {
            home: process.env.HERMES_HOME || join(homedir(), ".hermes"),
            run: async (cmd: string[]) =>
                Bun.spawn(cmd, { stdio: ["inherit", "inherit", "inherit"] })
                    .exited,
            self: [self[0] ?? "", self[1] ?? "", entry],
            persona: identityPrompt(),
            force: mode.force,
            write: writeError,
        };
        return mode.uninstall ? uninstallHermes(deps) : installHermes(deps);
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
