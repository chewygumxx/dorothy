// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/run.ts
//
//

// What the CLI runs: the service until a signal stops it, and the device
// tokens' commands. The service writes its address and warnings to
// stderr; a token goes to stdout, once.

import { type Env, readConfig, type StructuredCall } from "@dorothy/core";
import { loadProfiles } from "../hosts/profiles.js";
import { deviceTokenPath } from "./client.js";
import { startService } from "./service.js";
import { tokenStore, tokensPath } from "./tokens.js";

type Output = { write(text: string): unknown };
type Streams = { env?: Env; out?: Output; err?: Output };

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export async function runService({
    env = process.env,
    err = process.stderr,
    review,
    noReviews,
}: {
    env?: Env;
    err?: Output;
    review: { call: StructuredCall; persona: string } | null;
    // Why review is null, which the service's log keeps.
    noReviews?: string;
}): Promise<number> {
    const { config, warnings } = await readConfig(env);
    for (const warning of warnings) {
        err.write(`dorothy: ${warning}\n`);
    }
    let running: Awaited<ReturnType<typeof startService>>;
    try {
        running = await startService({
            env,
            config,
            profiles: await loadProfiles(),
            tokens: tokenStore(tokensPath(env)),
            review,
            ...(noReviews === undefined ? {} : { noReviews }),
            warn: (message) => err.write(`dorothy: ${message}\n`),
        });
    } catch (error) {
        err.write(
            `dorothy: the memory service did not start: ${describeError(error)}\n`,
        );
        return 1;
    }
    const also = config.service.listen;
    err.write(
        `dorothy: memory service at ${running.url}${also.length === 0 ? "" : `, and on ${also.join(", ")}`}\n`,
    );
    await new Promise<void>((resolve) => {
        process.once("SIGINT", () => resolve());
        process.once("SIGTERM", () => resolve());
    });
    await running.stop();
    return 0;
}

export async function runTokenAdd(
    device: string,
    {
        env = process.env,
        out = process.stdout,
        err = process.stderr,
    }: Streams = {},
): Promise<number> {
    try {
        const token = await tokenStore(tokensPath(env)).add(device);
        out.write(`${token}\n`);
        err.write(
            `dorothy: ${device}'s token, shown once: keep it on that device in ${deviceTokenPath(env)}, mode 0600\n`,
        );
        return 0;
    } catch (error) {
        err.write(`dorothy: ${describeError(error)}\n`);
        return 1;
    }
}

export async function runTokenRevoke(
    device: string,
    { env = process.env, err = process.stderr }: Streams = {},
): Promise<number> {
    let gone: boolean;
    try {
        gone = await tokenStore(tokensPath(env)).revoke(device);
    } catch (error) {
        err.write(`dorothy: ${describeError(error)}\n`);
        return 1;
    }
    err.write(
        gone
            ? `dorothy: ${device}'s token is withdrawn\n`
            : `dorothy: ${device} has no token\n`,
    );
    return gone ? 0 : 1;
}
