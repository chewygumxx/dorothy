// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/http.ts
//
//

// What the service's routes and guards share: the body's cap, JSON
// answers and a body read within the cap.

import { ContractError } from "../contract/errors.js";

export const MAX_BODY = 8 * 1024 * 1024;

export const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });

export async function bodyOf(request: Request): Promise<unknown> {
    const text = await request.text();
    // A chunked body declares no length; Bun's own cap is twice ours.
    if (Buffer.byteLength(text) > MAX_BODY) {
        throw new ContractError(413, "the body is over 8 MiB");
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new ContractError(400, "the body is not JSON");
    }
}
