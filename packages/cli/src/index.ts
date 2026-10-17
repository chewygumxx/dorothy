// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/index.ts
//
//

import { pathToFileURL } from "node:url";
import { config } from "@dotenvx/dotenvx";
import { parseArgs, USAGE } from "./args.js";

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
    const mode = parseArgs(
        process.argv.slice(2),
        process.stdin.isTTY === true && process.stdout.isTTY === true,
    );
    // Credentials are decrypted only for the modes that talk to the model.
    // quiet: dotenvx would otherwise log to stdout, over the TUI.
    if (
        mode.kind === "oneshot" ||
        mode.kind === "tui" ||
        mode.kind === "dump"
    ) {
        config({ quiet: true });
        // Loaded here rather than at the top, so the modes that never talk
        // to the model do not pay for the Agent SDK.
        const { prepareCliHome } = await import("@dorothy/agent");
        prepareCliHome();
    }
    if (mode.kind === "mirror" || mode.kind === "recover") {
        config({ quiet: true });
    }
    if (mode.kind === "help") {
        process.stdout.write(`${USAGE}\n`);
    } else if (mode.kind === "usage") {
        process.stderr.write(`dorothy: ${mode.message}\n${USAGE}\n`);
        process.exitCode = 2;
    } else if (mode.kind === "dump") {
        const { runDump } = await import("./dump.js");
        process.exitCode = await runDump(mode);
    } else if (mode.kind === "oneshot") {
        const { runOneShot } = await import("@dorothy/agent");
        await runOneShot(mode.prompt, mode.persona);
    } else if (mode.kind === "list") {
        const { commandHistory, runList } = await import(
            "@dorothy/memory/commands"
        );
        process.exitCode = await runList({ openHistory: commandHistory() });
    } else if (mode.kind === "memory") {
        const { commandHistory, runMemoryEdit } = await import(
            "@dorothy/memory/commands"
        );
        const { editInEditor } = await import("@dorothy/tui");
        process.exitCode = await runMemoryEdit(mode.phrase, {
            edit: (text) => editInEditor(text),
            openHistory: commandHistory(),
        });
    } else if (mode.kind === "tags") {
        const { commandHistory, runTags } = await import(
            "@dorothy/memory/commands"
        );
        process.exitCode = await runTags({ openHistory: commandHistory() });
    } else if (mode.kind === "tags-edit") {
        const { commandHistory, runTagsEdit } = await import(
            "@dorothy/memory/commands"
        );
        const { editInEditor } = await import("@dorothy/tui");
        process.exitCode = await runTagsEdit({
            edit: (text) => editInEditor(text),
            openHistory: commandHistory(),
        });
    } else if (mode.kind === "history") {
        const { runHistory } = await import("@dorothy/memory/commands");
        process.exitCode = await runHistory({
            path: mode.path,
            count: mode.count,
        });
    } else if (mode.kind === "restore") {
        const { runRestore } = await import("@dorothy/memory/commands");
        process.exitCode = await runRestore(mode.path, mode.rev);
    } else if (mode.kind === "rollback") {
        const { runRollback } = await import("@dorothy/memory/commands");
        process.exitCode = await runRollback(mode.rev);
    } else if (mode.kind === "check") {
        const { runCheck } = await import("@dorothy/memory/commands");
        process.exitCode = await runCheck({ staged: mode.staged });
    } else if (mode.kind === "mirror") {
        const { runMirror } = await import("@dorothy/memory/commands");
        process.exitCode = await runMirror(mode.url);
    } else if (mode.kind === "recover") {
        const { runRecover } = await import("@dorothy/memory/commands");
        process.exitCode = await runRecover(mode.url);
    } else if (mode.kind === "facts") {
        const { commandHistory, runFacts } = await import(
            "@dorothy/memory/commands"
        );
        process.exitCode = await runFacts({ openHistory: commandHistory() });
    } else if (mode.kind === "retire" || mode.kind === "revive") {
        const { commandHistory, runRetire, runRevive } = await import(
            "@dorothy/memory/commands"
        );
        const run = mode.kind === "retire" ? runRetire : runRevive;
        process.exitCode = await run(mode.target, {
            openHistory: commandHistory(),
        });
    } else if (mode.kind === "retire-from") {
        const { commandHistory, runRetireFrom } = await import(
            "@dorothy/memory/commands"
        );
        process.exitCode = await runRetireFrom(mode.phrase, {
            openHistory: commandHistory(),
        });
    } else if (mode.kind === "sync") {
        const { commandHistory, runSync } = await import(
            "@dorothy/memory/commands"
        );
        process.exitCode = await runSync(mode.path, {
            openHistory: commandHistory(),
        });
    } else if (mode.kind === "projects") {
        const { runProjects } = await import("@dorothy/memory/commands");
        process.exitCode = await runProjects();
    } else if (mode.kind === "claude-hook") {
        // No config(): the hook loads Dorothy's .env by path, once
        // claude's variables are gone (claude-hook.ts).
        const { runHook } = await import("./claude-hook.js");
        const code = await runHook(mode.hook);
        // A hook and a catch-up end here, as chat does: nothing they
        // started may keep a process of Claude Code's hooks alive.
        if (mode.hook.kind === "hook" || mode.hook.kind === "catch-up") {
            process.exit(code);
        }
        process.exitCode = code;
    } else if (mode.kind === "claude") {
        // No config(): claude signs in as the user's own Claude Code does.
        const { runClaude } = await import("./claude.js");
        process.exitCode = await runClaude(mode.args);
    } else if (mode.kind === "claude-dump") {
        // No config(), as for --claude.
        const { runClaudeDump } = await import("./claude-dump.js");
        process.exitCode = await runClaudeDump(mode.args, mode.message);
    } else if (mode.kind === "recall-server") {
        const { runRecallServer } = await import(
            "@dorothy/memory/recall-server"
        );
        process.exitCode = await runRecallServer({
            exclude: mode.exclude,
            recollect: mode.recollect,
            project: mode.project,
        });
    } else {
        // Loaded only for chat, so one-shot replies never pay for React.
        const { runTui } = await import("./run-tui.js");
        // runTui has closed everything by now. A push or a repack still
        // running must not hold the terminal after the chat is gone.
        process.exit(await runTui(mode.resume, mode.persona));
    }
}
