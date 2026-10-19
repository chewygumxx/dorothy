// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/guard.ts
//
//

// What the service refuses before any route is read: a web page's
// request, a name it does not answer to, a body that is not JSON, and,
// from beyond loopback, a request with no device's token.

import { ContractError } from "../contract/errors.js";
import { describeError, json, MAX_BODY } from "./http.js";
import type { TokenStore } from "./tokens.js";

export type Handler = (request: Request, address: string) => Promise<Response>;

export function guarded({
    route,
    tokens,
    loopback,
    warn,
}: {
    route: (request: Request, url: URL, local: boolean) => Promise<Response>;
    tokens: TokenStore;
    loopback: (address: string) => boolean;
    warn: (message: string) => void;
}): { handle: Handler; allowedHosts: Set<string> } {
    // The names the service answers to, filled once it is listening: a
    // request to any other, as DNS rebinding sends, is refused.
    const allowedHosts = new Set<string>();
    // The names refused, each warned of once, up to a few: the header is
    // the sender's to fill.
    const misdirected = new Set<string>();
    const handle: Handler = async (request, address) => {
        const declared = Number(request.headers.get("content-length") ?? 0);
        if (declared > MAX_BODY) {
            return json(413, { error: "the body is over 8 MiB" });
        }
        // What a web page could send: no harness names an Origin, and a
        // page cannot send JSON without one's leave.
        if (request.headers.has("origin")) {
            return json(403, { error: "a request from a web page is refused" });
        }
        const named = request.headers.get("host") ?? "";
        if (!allowedHosts.has(named)) {
            // Not the client's fault for good: it may be reaching the
            // service by a name the listen list lacks, so its records wait.
            if (misdirected.size < 16 && !misdirected.has(named)) {
                misdirected.add(named);
                warn(
                    `refused a request to ${JSON.stringify(named.slice(0, 80))}: add its address to [service] listen`,
                );
            }
            return json(421, {
                error: "this service does not answer to that name",
            });
        }
        if (
            request.method === "POST" &&
            !(request.headers.get("content-type") ?? "").startsWith(
                "application/json",
            )
        ) {
            return json(415, { error: "the body must be JSON" });
        }
        const local = loopback(address);
        if (!local) {
            const header = request.headers.get("authorization") ?? "";
            const token = header.startsWith("Bearer ") ? header.slice(7) : "";
            if (token === "" || (await tokens.verify(token)) === null) {
                return json(401, {
                    error: "a device token is needed from beyond this machine",
                });
            }
        }
        try {
            return await route(request, new URL(request.url), local);
        } catch (error) {
            if (error instanceof ContractError) {
                return json(error.status, { error: error.message });
            }
            warn(`the memory service failed: ${describeError(error)}`);
            return json(500, { error: "the memory service failed" });
        }
    };
    return { handle, allowedHosts };
}
