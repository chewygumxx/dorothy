// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/secrets.ts
//
//

import { join, resolve } from "node:path";
import {
    CLAUDE_TOKEN_VAR,
    chooseClaudeToken,
    type SecretsCode,
} from "@dorothy/core";
import type { Io } from "./command.js";

// The package's checkout, independent of the work or shell directory.
const checkoutRoot = resolve(import.meta.dir, "..", "..", "..");

// False only when a token was named and secrets.json holds none by that
// name: spending the account's own token instead would bill another.
export async function loadModelSecrets(io: Io): Promise<boolean> {
    let failure: SecretsCode | null;
    try {
        failure = await io.loadSecrets(
            join(checkoutRoot, "secrets.json"),
            io.env,
        );
    } catch {
        failure = "SOPS_FAILED";
    }
    if (failure !== null) io.err(`eval: secrets not loaded (${failure})\n`);
    if (chooseClaudeToken(io.env) === null) return true;
    io.err(
        `eval: ${CLAUDE_TOKEN_VAR} names no token in secrets.json; no model was called\n`,
    );
    return false;
}
