// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/assets/pi/helper.ts
//
//

// One call of `dorothy --pi-hook`: the launch's own command, run with the
// manifest's helper environment and nothing of Pi's, a JSON request on
// stdin and a JSON reply on stdout. Memory's contract is re-declared here,
// as Pi runs this under Node and never loads Dorothy's Bun packages
// (@dorothy/memory/host-hook; extension.test.ts checks the two agree).
// It never throws: a fault is a reply with no context and a stable code.

import { spawn } from "node:child_process";

export type PiHookRequest = {
    event: "start" | "prompt" | "settled" | "end";
    sessionId: string;
    sessionFile: string | null;
    leafId: string | null;
    cwd: string;
    private: boolean;
    reason?: "startup" | "resume" | "compact" | "clear";
    prompt?: string;
};
export type PiHookReply = {
    session: string | null;
    context: string;
    recording: "off" | "pending" | "delivered";
    // Stable code, never raw content.
    warning: string | null;
};
export type InvokeHook = (
    request: PiHookRequest,
    signal: AbortSignal,
) => Promise<PiHookReply>;
export type HelperCommand = {
    self: string[];
    helperEnv: Record<string, string | undefined>;
};

// The contract's limits on what goes each way.
export const REQUEST_BYTES = 128 * 1024;
export const REPLY_BYTES = 64 * 1024;

const RECORDINGS = new Set(["off", "pending", "delivered"]);
const CODE = /^[a-z][a-z0-9_]{0,63}$/;

// A reply carrying a code alone; the work stays in Pi's file for later.
export const failed = (warning: string): PiHookReply => ({
    session: null,
    context: "",
    recording: "pending",
    warning,
});

// The helper's reply, or null for anything not exactly its shape.
function replyOf(text: string): PiHookReply | null {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof value !== "object" || value === null) return null;
    const reply = value as Record<string, unknown>;
    const session = reply.session;
    const warning = reply.warning;
    if (
        (session !== null && typeof session !== "string") ||
        typeof reply.context !== "string" ||
        !RECORDINGS.has(reply.recording as string) ||
        (warning !== null &&
            (typeof warning !== "string" || !CODE.test(warning)))
    )
        return null;
    return {
        session,
        context: reply.context,
        recording: reply.recording as PiHookReply["recording"],
        warning,
    };
}

// Requests run in `cwd`, never the user's project, so nothing there (a
// bunfig.toml, a .env) reaches the helper. The signal is its deadline:
// once it fires, the helper is killed and the reply is a timeout.
export function hookInvoker(helper: HelperCommand, cwd: string): InvokeHook {
    const [command, ...args] = helper.self;
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(helper.helperEnv))
        if (value !== undefined) env[name] = value;
    return (request, signal) =>
        new Promise((resolve) => {
            const body = JSON.stringify(request);
            if (Buffer.byteLength(body) > REQUEST_BYTES)
                return resolve(failed("pi_request_too_large"));
            if (command === undefined) return resolve(failed("pi_hook_failed"));
            if (signal.aborted) return resolve(failed("pi_hook_timeout"));
            let settled = false;
            const finish = (reply: PiHookReply) => {
                if (settled) return;
                settled = true;
                signal.removeEventListener("abort", abort);
                resolve(reply);
            };
            const child = spawn(command, [...args, "--pi-hook"], {
                cwd,
                env,
                stdio: ["pipe", "pipe", "ignore"],
            });
            const abort = () => {
                child.kill("SIGKILL");
                finish(failed("pi_hook_timeout"));
            };
            signal.addEventListener("abort", abort, { once: true });
            const parts: Buffer[] = [];
            let size = 0;
            child.stdout.on("data", (part: Buffer) => {
                size += part.length;
                if (size > REPLY_BYTES) {
                    child.kill("SIGKILL");
                    finish(failed("pi_reply_too_large"));
                    return;
                }
                parts.push(part);
            });
            child.on("error", () => finish(failed("pi_hook_failed")));
            child.on("close", (code) => {
                if (code !== 0) return finish(failed("pi_hook_failed"));
                const reply = replyOf(Buffer.concat(parts).toString("utf8"));
                finish(reply ?? failed("pi_reply_invalid"));
            });
            // A helper gone before reading its request is a failure above.
            child.stdin.on("error", () => {});
            child.stdin.end(body);
        });
}
