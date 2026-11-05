// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/helper.ts
//
//

// `dorothy --pi-steward`: what her Pi extension runs for each worker tool
// call. One JSON request of at most 128 KiB on stdin, one JSON reply of at
// most 64 KiB on stdout. A request too large or not JSON gets a refusal,
// never a run; the engine answers everything else, and never throws.

import { readBounded } from "../../../bounded.js";
import type { StewardReply, StewardRequest } from "./types.js";

export const STEWARD_REQUEST_BYTES = 128 * 1024;
export const STEWARD_REPLY_BYTES = 64 * 1024;

// The reply's text. `run` is given whatever JSON came, as the engine checks
// a request's shape itself.
export async function stewardHelper(
    input: ReadableStream<Uint8Array>,
    run: (request: StewardRequest) => Promise<StewardReply>,
): Promise<string> {
    const text = await readBounded(input, STEWARD_REQUEST_BYTES);
    if (text === null) {
        return JSON.stringify({ ok: false, code: "REQUEST_TOO_LARGE" });
    }
    let request: unknown = null;
    try {
        request = JSON.parse(text);
    } catch {}
    let reply: StewardReply;
    const deadlineAt = (request as StewardRequest | null)?.deadlineAt;
    const deadline =
        typeof deadlineAt === "string" &&
        Number.isFinite(Date.parse(deadlineAt))
            ? Date.parse(deadlineAt)
            : null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired =
        deadline === null
            ? null
            : new Promise<StewardReply>((resolve) => {
                  timer = setTimeout(
                      () => resolve({ ok: false, code: "STEWARD_DEADLINE" }),
                      Math.max(0, deadline - Date.now()),
                  );
              });
    try {
        const running = run(request as StewardRequest);
        reply =
            expired === null
                ? await running
                : await Promise.race([running, expired]);
    } catch {
        reply = { ok: false, code: "STEWARD_FAILED" };
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
    const out = JSON.stringify(reply);
    // Too large, the reply keeps its code alone: a mutation may have
    // happened, which the extension reconciles to see.
    return Buffer.byteLength(out) <= STEWARD_REPLY_BYTES
        ? out
        : JSON.stringify({
              ok: false,
              code: "REPLY_TOO_LARGE",
              text: reply.code,
          });
}
