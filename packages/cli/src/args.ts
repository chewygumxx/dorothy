// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/args.ts
//
//

import {
    type ParseArgsOptionsConfig,
    parseArgs as parseOptions,
} from "node:util";
import type { PersonaMode } from "@dorothy/agent";
import { HOST_ID, isPhrase, isUuid, RECORDING_HOSTS } from "@dorothy/core";
import type { HookMode } from "@dorothy/memory/claude-hook";

export type Mode =
    | { kind: "oneshot"; prompt: string; persona: PersonaMode }
    | { kind: "tui"; resume: string | null; persona: PersonaMode }
    | {
          kind: "dump";
          resume: string | null;
          message: string;
          persona: PersonaMode;
      }
    | { kind: "list" }
    | { kind: "memory"; phrase: string }
    | { kind: "tags" }
    | { kind: "tags-edit" }
    | { kind: "history"; path: string | null; count: number }
    | { kind: "restore"; path: string; rev: string | null }
    | { kind: "rollback"; rev: string }
    | { kind: "check"; staged: boolean }
    | { kind: "mirror"; url: string | null }
    | { kind: "recover"; url: string }
    | { kind: "facts" }
    | { kind: "retire"; target: string }
    | { kind: "retire-from"; phrase: string }
    | { kind: "revive"; target: string }
    | { kind: "verify"; id: string }
    | { kind: "sync"; path: string | null }
    | { kind: "projects" }
    | {
          kind: "recall-server";
          exclude: string | null;
          recollect: boolean;
          project: string | null;
      }
    | { kind: "serve" }
    | { kind: "token-add"; device: string }
    | { kind: "token-revoke"; device: string }
    | { kind: "sweep"; backfill: boolean; reread: boolean }
    | { kind: "sweep-dismiss"; host: string; session: string }
    | { kind: "review-backfill"; count: number }
    | { kind: "mcp"; host: string | null }
    | { kind: "claude-hook"; hook: HookMode }
    | { kind: "claude"; args: string[] }
    | { kind: "claude-dump"; args: string[]; message: string }
    | { kind: "help" }
    | { kind: "usage"; message: string };

export const USAGE = [
    "usage: dorothy <prompt...>        one reply, then exit",
    "       dorothy                    chat (needs a terminal)",
    "       dorothy --resume <phrase>  continue a saved chat",
    "       dorothy --list             what Dorothy remembers",
    "       dorothy --memory <phrase>  correct, pin or hide a chat's notes",
    "       dorothy --tags             Dorothy's tags, as a tree",
    "       dorothy --edit-tags        correct, merge or delete her tags",
    "       dorothy --history [<path>] [-n <count>]",
    "                                  what changed in her memory, newest first",
    "       dorothy --restore <path> [<rev>]",
    "                                  put a file back as it was",
    "       dorothy --rollback <rev>   put notes and tags back as they were",
    "       dorothy --check [--staged] lint memory's files",
    "       dorothy --mirror [<url>]   set or show the sealed mirror",
    "       dorothy --recover <url>    rebuild memory from the mirror",
    "       dorothy --facts            what Dorothy knows, by scope",
    "       dorothy --retire <scope>/<name> | --from <phrase>",
    "                                  retire a fact, or what a chat gave",
    "       dorothy --revive <scope>/<name>",
    "                                  bring a retired fact back",
    "       dorothy --verify <id>      confirm knowledge a model gave",
    "       dorothy --sync [<path>]    sync a project's facts with its repo",
    "       dorothy --projects         the projects Dorothy knows",
    "       dorothy --recall-server    memory tools for MCP clients (stdio)",
    "       dorothy --serve            her memory service, until stopped",
    "       dorothy --serve --token-add | --token-revoke <device>",
    "                                  give or withdraw a device's token",
    "       dorothy --sweep [--backfill]",
    "                                  record the sessions of [recording]",
    "                                  hosts once; --backfill, the backlog",
    "                                  from before, for no extraction",
    "       dorothy --sweep --reread   read again what a sweep could not",
    "       dorothy --sweep --dismiss <host> <session>",
    "                                  stop telling of what it could not",
    "       dorothy --review-backfill [-n | --count <count>]",
    "                                  review the newest backfilled chats on",
    "                                  the reviewer's model (the Claude plan,",
    "                                  if secrets.json holds its token); each",
    "                                  batch spends that usage",
    "       dorothy --mcp [--host <host>]",
    "                                  her memory over MCP (stdio), through",
    "                                  the service, for the host named",
    "       dorothy --claude-hook      internal: what --claude's hooks run",
    "       dorothy --claude-hook --reread | --dismiss <session>",
    "                                  read again the Claude Code lines she",
    "                                  could not, or stop telling of them",
    "       dorothy -- <prompt...>     a prompt that starts with -",
    "       dorothy --dump-context [--resume <phrase>] [message...]",
    "                                  print the request a chat would send",
    "       dorothy --claude [args...] Claude Code, with Dorothy as its",
    "                                  agent; args go to claude",
    "       dorothy --claude --dump-context [args...] [-- message...]",
    "                                  print the request claude would send",
    "                                  in print mode, through the gateway",
    "       dorothy --dev ...          development mode, before a chat, a",
    "                                  prompt or --dump-context",
].join("\n");

type Command = (rest: readonly string[], isTTY: boolean) => Mode;

const usage = (message: string): Mode => ({ kind: "usage", message });

// Each flag that starts a mode, and how it reads the words after it.
const COMMANDS: Record<string, Command> = {
    "--help": () => ({ kind: "help" }),
    "-h": () => ({ kind: "help" }),
    "--dev": parseDev,
    "--resume": parseResume,
    "--list": noArguments("--list", { kind: "list" }),
    "--memory": parseMemory,
    "--tags": noArguments("--tags", { kind: "tags" }),
    "--edit-tags": (rest, isTTY) =>
        rest.length > 0
            ? usage("--edit-tags takes no arguments")
            : inTerminal(isTTY, "--edit-tags", { kind: "tags-edit" }),
    "--history": parseHistory,
    "--restore": ([path, rev, ...extra]) =>
        path !== undefined && extra.length === 0
            ? { kind: "restore", path, rev: rev ?? null }
            : usage("--restore takes <path> [<rev>]"),
    "--rollback": ([rev, ...extra]) =>
        rev !== undefined && extra.length === 0
            ? { kind: "rollback", rev }
            : usage("--rollback takes one revision"),
    "--check": parseCheck,
    "--mirror": ([url, ...extra]) =>
        extra.length === 0
            ? { kind: "mirror", url: url ?? null }
            : usage("--mirror takes one url or path"),
    "--recover": ([url, ...extra]) =>
        url !== undefined && extra.length === 0
            ? { kind: "recover", url }
            : usage("--recover takes one url or path"),
    "--facts": noArguments("--facts", { kind: "facts" }),
    "--retire": parseRetire,
    "--revive": parseRevive,
    "--verify": parseVerify,
    "--sync": parseSync,
    "--projects": noArguments("--projects", { kind: "projects" }),
    "--recall-server": parseRecallServer,
    "--serve": parseServe,
    "--sweep": parseSweep,
    "--review-backfill": parseReviewBackfill,
    "--mcp": parseMcp,
    "--claude-hook": parseHook,
    "--dump-context": parseDump,
    "--claude": parseClaude,
};

export function parseArgs(argv: readonly string[], isTTY: boolean): Mode {
    const [first, ...rest] = argv;
    if (first !== undefined && Object.hasOwn(COMMANDS, first)) {
        return (COMMANDS[first] as Command)(rest, isTTY);
    }
    // A mistyped option would otherwise be sent, and paid for, as a prompt.
    if (first !== undefined && first !== "--" && /^-./.test(first)) {
        return usage(`unknown option ${first}`);
    }
    const words = first === "--" ? rest : argv;
    if (words.length > 0) {
        return { kind: "oneshot", prompt: words.join(" "), persona: "chat" };
    }
    return inTerminal(isTTY, "chat", {
        kind: "tui",
        resume: null,
        persona: "chat",
    });
}

function noArguments(flag: string, mode: Mode): Command {
    return (rest) =>
        rest.length === 0 ? mode : usage(`${flag} takes no arguments`);
}

// The modes that open the screen or an editor.
function inTerminal(isTTY: boolean, what: string, mode: Mode): Mode {
    return isTTY ? mode : usage(`${what} needs a terminal`);
}

function onePhrase(rest: readonly string[]): string | null {
    const [phrase, ...extra] = rest;
    return phrase !== undefined && extra.length === 0 && isPhrase(phrase)
        ? phrase
        : null;
}

// A command's options and words, read as POSIX and GNU do, or null where
// node:util refuses them: an unknown option, or one missing its value.
function options<const T extends ParseArgsOptionsConfig>(
    rest: readonly string[],
    spec: T,
) {
    try {
        return parseOptions({
            args: [...rest],
            options: spec,
            allowPositionals: true,
            strict: true,
        });
    } catch (error) {
        if (error instanceof TypeError) {
            return null;
        }
        throw error;
    }
}

const DEV_USAGE = "--dev applies only to chat, a prompt or --dump-context";

function parseDev(rest: readonly string[], isTTY: boolean): Mode {
    if (rest[0] === "--dev") {
        return usage(DEV_USAGE);
    }
    const mode = parseArgs(rest, isTTY);
    switch (mode.kind) {
        case "oneshot":
        case "tui":
        case "dump":
            return { ...mode, persona: "development" };
        case "usage":
            return mode;
        default:
            return usage(DEV_USAGE);
    }
}

function parseResume(rest: readonly string[], isTTY: boolean): Mode {
    const phrase = onePhrase(rest);
    if (phrase === null) {
        return usage("--resume takes one four-word phrase");
    }
    return inTerminal(isTTY, "--resume", {
        kind: "tui",
        resume: phrase,
        persona: "chat",
    });
}

function parseMemory(rest: readonly string[], isTTY: boolean): Mode {
    const phrase = onePhrase(rest);
    if (phrase === null) {
        return usage("--memory takes one four-word phrase");
    }
    return inTerminal(isTTY, "--memory", { kind: "memory", phrase });
}

function parseHistory(rest: readonly string[]): Mode {
    const HISTORY_USAGE = "--history takes [<path>] [-n <count>]";
    const parsed = options(rest, { count: { type: "string", short: "n" } });
    const count = Number(parsed?.values.count ?? 20);
    if (
        parsed === null ||
        parsed.positionals.length > 1 ||
        !Number.isInteger(count) ||
        count < 1
    ) {
        return usage(HISTORY_USAGE);
    }
    return { kind: "history", path: parsed.positionals[0] ?? null, count };
}

function parseCheck(rest: readonly string[]): Mode {
    const parsed = options(rest, { staged: { type: "boolean" } });
    return parsed === null || parsed.positionals.length > 0
        ? usage("--check takes only --staged")
        : { kind: "check", staged: parsed.values.staged === true };
}

// A fact is named <scope>/<name>; its name is checked where it is looked up.
function parseRetire(rest: readonly string[]): Mode {
    const RETIRE_USAGE = "--retire takes <scope>/<name> or --from <phrase>";
    const parsed = options(rest, { from: { type: "string" } });
    if (parsed === null) {
        return usage(RETIRE_USAGE);
    }
    const { from } = parsed.values;
    const [target, ...extra] = parsed.positionals;
    if (from !== undefined) {
        return target === undefined && isPhrase(from)
            ? { kind: "retire-from", phrase: from }
            : usage(RETIRE_USAGE);
    }
    return target !== undefined && extra.length === 0
        ? { kind: "retire", target }
        : usage(RETIRE_USAGE);
}

// A path that starts with - follows --, as for any command.
function parseSync(rest: readonly string[]): Mode {
    const parsed = options(rest, {});
    return parsed === null || parsed.positionals.length > 1
        ? usage("--sync takes [<path>]")
        : { kind: "sync", path: parsed.positionals[0] ?? null };
}

function parseRevive(rest: readonly string[]): Mode {
    const [target, ...extra] = options(rest, {})?.positionals ?? [];
    return target !== undefined && extra.length === 0
        ? { kind: "revive", target }
        : usage("--revive takes <scope>/<name>");
}

// A knowledge id, k:..., as open and the block show it; checked where
// it is looked up.
function parseVerify(rest: readonly string[]): Mode {
    const [id, ...extra] = options(rest, {})?.positionals ?? [];
    return id !== undefined && extra.length === 0
        ? { kind: "verify", id }
        : usage("--verify takes one knowledge id, k:...");
}

const RECALL_USAGE =
    "--recall-server takes [--exclude <phrase> [--recollect]] [--project <root>]";

function parseRecallServer(rest: readonly string[]): Mode {
    const parsed = options(rest, {
        exclude: { type: "string", multiple: true },
        project: { type: "string", multiple: true },
        recollect: { type: "boolean" },
    });
    if (parsed === null || parsed.positionals.length > 0) {
        return usage(RECALL_USAGE);
    }
    const { exclude = [], project = [], recollect = false } = parsed.values;
    const [phrase] = exclude;
    const [root] = project;
    const valid =
        exclude.length <= 1 &&
        project.length <= 1 &&
        (phrase === undefined ? !recollect : isPhrase(phrase)) &&
        root !== "";
    return valid
        ? {
              kind: "recall-server",
              exclude: phrase ?? null,
              recollect,
              project: root ?? null,
          }
        : usage(RECALL_USAGE);
}

const SERVE_USAGE =
    "--serve takes nothing, --token-add <device> or --token-revoke <device>";

function parseServe(rest: readonly string[]): Mode {
    const parsed = options(rest, {
        "token-add": { type: "string", multiple: true },
        "token-revoke": { type: "string", multiple: true },
    });
    // An option given twice would keep its last value: refused instead.
    if (parsed === null || parsed.positionals.length > 0) {
        return usage(SERVE_USAGE);
    }
    const once = (values: string[] | undefined) =>
        values === undefined || values.length === 1 ? values?.[0] : null;
    const add = once(parsed.values["token-add"]);
    const revoke = once(parsed.values["token-revoke"]);
    if (add === null || revoke === null) {
        return usage(SERVE_USAGE);
    }
    if (add !== undefined && revoke !== undefined) {
        return usage(SERVE_USAGE);
    }
    if (add !== undefined) {
        return add === ""
            ? usage(SERVE_USAGE)
            : { kind: "token-add", device: add };
    }
    if (revoke !== undefined) {
        return revoke === ""
            ? usage(SERVE_USAGE)
            : { kind: "token-revoke", device: revoke };
    }
    return { kind: "serve" };
}

const SWEEP_USAGE =
    "--sweep takes [--backfill], --reread or --dismiss <host> <session>";

function parseSweep(rest: readonly string[]): Mode {
    const parsed = options(rest, {
        backfill: { type: "boolean", multiple: true },
        reread: { type: "boolean", multiple: true },
        dismiss: { type: "string", multiple: true },
    });
    if (parsed === null) {
        return usage(SWEEP_USAGE);
    }
    const { backfill = [], reread = [], dismiss = [] } = parsed.values;
    const [host, ...extra] = dismiss;
    const [session, ...more] = parsed.positionals;
    if (backfill.length > 1 || reread.length > 1 || extra.length > 0) {
        return usage(SWEEP_USAGE);
    }
    if (host !== undefined) {
        return backfill.length === 0 &&
            reread.length === 0 &&
            host !== "claude-code" &&
            (RECORDING_HOSTS as readonly string[]).includes(host) &&
            session !== undefined &&
            session !== "" &&
            more.length === 0
            ? { kind: "sweep-dismiss", host, session }
            : usage(SWEEP_USAGE);
    }
    return parsed.positionals.length === 0 &&
        (backfill.length === 0 || reread.length === 0)
        ? {
              kind: "sweep",
              backfill: backfill.length > 0,
              reread: reread.length > 0,
          }
        : usage(SWEEP_USAGE);
}

const REVIEW_BACKFILL_USAGE = "--review-backfill takes [-n | --count <count>]";

// A batch's size: a positive integer, 25 where none is given.
function parseReviewBackfill(rest: readonly string[]): Mode {
    const parsed = options(rest, {
        count: { type: "string", short: "n", multiple: true },
    });
    const given = parsed?.values.count?.[0];
    if (
        parsed === null ||
        parsed.positionals.length > 0 ||
        (parsed.values.count?.length ?? 0) > 1 ||
        (given !== undefined && !/^[1-9]\d*$/.test(given))
    ) {
        return usage(REVIEW_BACKFILL_USAGE);
    }
    const count = given === undefined ? 25 : Number(given);
    return Number.isSafeInteger(count)
        ? { kind: "review-backfill", count }
        : usage(REVIEW_BACKFILL_USAGE);
}

const MCP_USAGE = "--mcp takes [--host <host>], a host as its profile names it";

function parseMcp(rest: readonly string[]): Mode {
    const parsed = options(rest, { host: { type: "string", multiple: true } });
    if (
        parsed === null ||
        parsed.positionals.length > 0 ||
        (parsed.values.host?.length ?? 0) > 1
    ) {
        return usage(MCP_USAGE);
    }
    const host = parsed.values.host?.[0];
    if (host !== undefined && !HOST_ID.test(host)) {
        return usage(MCP_USAGE);
    }
    return { kind: "mcp", host: host ?? null };
}

const HOOK_USAGE =
    "--claude-hook takes [--catch-up <launch> [--session <id>]], --reread or --dismiss <session>";

// What --claude's hooks run, and the two commands its notice offers.
function parseHook(rest: readonly string[]): Mode {
    const parsed = options(rest, {
        "catch-up": { type: "string" },
        session: { type: "string" },
        reread: { type: "boolean" },
        dismiss: { type: "string" },
    });
    if (parsed === null || parsed.positionals.length > 0) {
        return usage(HOOK_USAGE);
    }
    const { "catch-up": launch, session, reread, dismiss } = parsed.values;
    const chosen = [launch, reread, dismiss].filter((v) => v !== undefined);
    if (chosen.length > 1 || (session !== undefined && launch === undefined)) {
        return usage(HOOK_USAGE);
    }
    const hook = (mode: HookMode): Mode => ({
        kind: "claude-hook",
        hook: mode,
    });
    if (launch !== undefined) {
        return isUuid(launch) && (session === undefined || isUuid(session))
            ? hook({ kind: "catch-up", launch, session: session ?? null })
            : usage(HOOK_USAGE);
    }
    if (dismiss !== undefined) {
        return isUuid(dismiss)
            ? hook({ kind: "dismiss", session: dismiss })
            : usage(HOOK_USAGE);
    }
    return hook(reread === true ? { kind: "reread" } : { kind: "hook" });
}

const DUMP_USAGE = "--dump-context takes [--resume <phrase>] [message...]";

// Hand-read, as the message is free text: an option-like word after its
// first is part of it.
function parseDump(argv: readonly string[]): Mode {
    let words = argv;
    let resume: string | null = null;
    if (words[0] === "--resume") {
        const phrase = words[1];
        if (phrase === undefined || !isPhrase(phrase)) {
            return usage(DUMP_USAGE);
        }
        resume = phrase;
        words = words.slice(2);
    }
    if (words[0] === "--") {
        words = words.slice(1);
    } else if (words[0] !== undefined && /^-./.test(words[0])) {
        return usage(DUMP_USAGE);
    }
    return {
        kind: "dump",
        resume,
        message: words.length > 0 ? words.join(" ") : "hi",
        persona: "chat",
    };
}

// Everything after --claude is claude's, but for --dump-context, whose
// message follows a --.
function parseClaude(rest: readonly string[]): Mode {
    if (rest[0] !== "--dump-context") {
        return { kind: "claude", args: [...rest] };
    }
    const words = rest.slice(1);
    const end = words.indexOf("--");
    const message = end === -1 ? [] : words.slice(end + 1);
    return {
        kind: "claude-dump",
        args: end === -1 ? words : words.slice(0, end),
        message: message.length > 0 ? message.join(" ") : "hi",
    };
}
