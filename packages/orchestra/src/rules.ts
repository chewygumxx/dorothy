// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/rules.ts
//
//

import { basename, isAbsolute, relative, resolve } from "node:path";
import type { AcpPermissionRequest } from "acpx/runtime";
import { isPlainWords, type OrchestraConfig } from "./config.js";
import { parseShell, type SimpleCommand } from "./shell.js";

export type PermissionRequest = AcpPermissionRequest["raw"];
export type Decision = "allow" | "ask" | "deny";
export type Ruling = { decision: Decision | "judge"; reason: string };
export type RuleContext = { clone: string; cwd: string };
type Patterns = Pick<OrchestraConfig, "allow" | "ask" | "deny">;
const rule = (decision: Ruling["decision"], reason: string): Ruling => ({
    decision,
    reason,
});
const RANK = { allow: 0, judge: 1, ask: 2, deny: 3 };
const strictest = (a: Ruling, b: Ruling): Ruling =>
    RANK[a.decision] >= RANK[b.decision] ? a : b;
const ASK = rule("ask", "The command cannot be reduced to plain words");
const UNMATCHED = rule("judge", "No rule settles this request");
const ALLOW = rule("allow", "Routine work in the worker's clone");

function inside(path: string, context: RuleContext): boolean {
    const rel = relative(resolve(context.clone), resolve(context.cwd, path));
    return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
}
function pathRule(path: string, context: RuleContext): Ruling {
    if (!inside(path, context))
        return rule("deny", "A path is outside the worker's clone");
    if (
        /^(?:\.env(?:\..*)?|secrets\.json|id_rsa|id_ed25519)$/.test(
            basename(path),
        )
    ) {
        return rule("deny", "The request names a credential file");
    }
    return ALLOW;
}
const DYNAMIC = new Set([
    "eval",
    "alias",
    "unalias",
    "source",
    ".",
    "env",
    "command",
    "builtin",
    "exec",
    "sudo",
    "sh",
    "bash",
    "zsh",
    "fish",
    "dash",
    "function",
    "if",
    "then",
    "else",
    "fi",
    "for",
    "while",
    "until",
    "do",
    "done",
    "case",
    "esac",
    "select",
    "coproc",
    "time",
    "export",
    "set",
    "unset",
    "cd",
    "pushd",
    "popd",
]);
const GIT_ROUTINE = new Set([
    "add",
    "commit",
    "switch",
    "branch",
    "status",
    "diff",
    "log",
    "show",
    "ls-files",
]);
const READS = new Set(["cat", "head", "tail", "ls", "rg", "grep", "pwd", "wc"]);
const TASK = /^(?:test|lint|format|build|check)(?::[a-zA-Z0-9_-]+)*$/;

function commandRule(
    command: SimpleCommand,
    context: RuleContext,
    patterns: Patterns,
): Ruling {
    const words = command.words.map((w) => w.text);
    const name = basename(words[0] ?? "");
    const args = words.slice(1);
    let result = UNMATCHED;
    let uncertain = command.words.some((w) => !w.literal) || !name;
    if (DYNAMIC.has(name) || /^[a-zA-Z_][a-zA-Z0-9_]*=/.test(name))
        uncertain = true;
    if (["gh", "sops"].includes(name))
        result = rule("deny", `${name} is forbidden for workers`);
    if (name === "git") {
        let index = 0;
        while (args[index]?.startsWith("-")) {
            const arg = args[index++] as string;
            if (arg === "-C") {
                uncertain = true;
                const dir = args[index++];
                if (dir === undefined) uncertain = true;
                else result = strictest(result, pathRule(dir, context));
            } else {
                uncertain = true;
                if (
                    [
                        "-c",
                        "--git-dir",
                        "--work-tree",
                        "--namespace",
                        "--config-env",
                    ].includes(arg)
                )
                    index++;
            }
        }
        const sub = args[index];
        if (sub === "push" || (sub === "remote" && args[index + 1] === "add")) {
            result = rule("deny", "Workers may not push or add remotes");
        } else if (GIT_ROUTINE.has(sub ?? "")) {
            result = result.decision === "deny" ? result : ALLOW;
        } else uncertain = true; // Unknown git subcommands can be aliases.
        if (args.some((a) => a.startsWith("--force") || /^-[^-]*f/.test(a))) {
            result = rule("deny", "Git force flags are forbidden");
        }
    } else if (
        ["bun", "npm", "pnpm", "yarn", "pip", "pip3", "cargo", "uv"].includes(
            name,
        )
    ) {
        if (
            args.some((a) =>
                [
                    "add",
                    "install",
                    "i",
                    "update",
                    "upgrade",
                    "up",
                    "remove",
                    "uninstall",
                ].includes(a),
            )
        ) {
            result =
                name === "bun" &&
                args.length === 2 &&
                args[0] === "install" &&
                args[1] === "--frozen-lockfile"
                    ? ALLOW
                    : rule("ask", "Dependency changes need the user");
        } else if (
            TASK.test(args[0] === "run" ? (args[1] ?? "") : (args[0] ?? ""))
        )
            result = ALLOW;
    } else if (READS.has(name)) result = ALLOW;

    // Quoted arguments stay literal; the patterns match full leading words.
    for (const decision of ["allow", "ask", "deny"] as const) {
        for (const pattern of patterns[decision]) {
            if (
                isPlainWords(pattern) &&
                pattern
                    .split(" ")
                    .every(
                        (word, i) =>
                            command.words[i]?.literal && word === words[i],
                    )
            ) {
                result = strictest(
                    result.decision === "judge" ? ALLOW : result,
                    rule(decision, `Configured ${decision}: ${pattern}`),
                );
            }
        }
    }
    if (uncertain) result = strictest(result, ASK);
    for (const word of [...command.words.slice(1), ...command.redirects]) {
        if (!word.literal) continue;
        // All explicit paths are checked, even when an option consumes them.
        const path =
            word.text.startsWith("-") && word.text.includes("=")
                ? word.text.slice(word.text.indexOf("=") + 1)
                : word.text;
        if (
            isAbsolute(path) ||
            path.startsWith("..") ||
            command.redirects.includes(word) ||
            READS.has(name)
        )
            result = strictest(result, pathRule(path, context));
    }
    return result;
}

export function ruleRequest(
    request: PermissionRequest,
    context: RuleContext,
    config: Patterns,
): Ruling {
    const tool = request.toolCall;
    const input =
        tool.rawInput !== null &&
        typeof tool.rawInput === "object" &&
        !Array.isArray(tool.rawInput)
            ? (tool.rawInput as Record<string, unknown>)
            : {};
    const cwd =
        typeof input.cwd === "string"
            ? resolve(context.cwd, input.cwd)
            : context.cwd;
    const scoped = { ...context, cwd };
    if (!inside(cwd, context))
        return rule(
            "deny",
            "The working directory is outside the worker's clone",
        );
    if (tool.kind === "execute" || typeof input.command === "string") {
        if (typeof input.command !== "string") return ASK;
        const parsed = parseShell(input.command);
        let result = parsed.plain ? ALLOW : ASK;
        for (const command of parsed.commands)
            result = strictest(result, commandRule(command, scoped, config));
        for (const command of parsed.commands) {
            if (
                !["curl", "wget"].includes(
                    basename(command.words[0]?.text ?? ""),
                )
            )
                continue;
            if (
                parsed.commands.some(
                    (other) =>
                        other.pipeline === command.pipeline &&
                        other !== command &&
                        ["sh", "bash", "zsh", "dash", "fish"].includes(
                            basename(other.words[0]?.text ?? ""),
                        ),
                )
            ) {
                result = rule(
                    "deny",
                    "A download piped into a shell is forbidden",
                );
            }
        }
        return result;
    }
    if (
        ["read", "search", "edit", "delete", "move"].includes(tool.kind ?? "")
    ) {
        const paths = (tool.locations ?? []).map((location) => location.path);
        for (const key of ["file_path", "path", "notebook_path"]) {
            if (typeof input[key] === "string") paths.push(input[key]);
        }
        if (!paths.length)
            return tool.kind === "search"
                ? ALLOW
                : rule("ask", "No file paths supplied");
        return paths.reduce(
            (result, path) => strictest(result, pathRule(path, scoped)),
            ["delete", "move"].includes(tool.kind ?? "") ? UNMATCHED : ALLOW,
        );
    }
    return UNMATCHED;
}
