// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/client.ts
//
//

// The memory service's client, for adapters: it never throws and never
// waits past its timeout. A block that cannot be fetched comes from the
// last kept for its host and project; a record that cannot be sent waits
// in the state directory, mode 0600, and goes oldest first with the next;
// one the service refuses is dropped.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
    type BlockRequest,
    type BlockResponse,
    type Env,
    type RecallRequest,
    type RecallResponse,
    type RecordRequest,
    type RecordResponse,
    readConfig,
    SERVICE_PATHS,
    SERVICE_PORT,
    xdgDir,
} from "@dorothy/core";
import type { z } from "zod";
import { digestOf, size } from "../contract/block.js";
import {
    blockResponseSchema,
    recallResponseSchema,
    recordResponseSchema,
} from "../contract/schemas.js";
import { isLoopback } from "./loopback.js";

export const DEFAULT_URL = `http://127.0.0.1:${SERVICE_PORT}`;
export const TIMEOUTS = {
    block: 1000,
    recall: 500,
    record: 2000,
    health: 300,
} as const;

export type ClientOptions = {
    env?: Env;
    // DOROTHY_MEMORY_URL, else loopback at [service] port.
    url?: string;
    // The device's token file by default; null sends none.
    token?: string | null;
    fetch?: typeof fetch;
};

type Client = {
    env: Env;
    url: string;
    token: string | null;
    fetch: typeof fetch;
};

const stateDir = (env: Env) =>
    join(xdgDir(env, "XDG_STATE_HOME", ".local/state"), "dorothy");
export const deviceTokenPath = (env: Env) =>
    join(stateDir(env), "device-token");
const pendingDir = (env: Env) => join(stateDir(env), "pending");
const blockPath = (env: Env, host: string, project: string | undefined) =>
    join(
        stateDir(env),
        "blocks",
        host,
        `${encodeURIComponent(project ?? "personal")}.md`,
    );

async function readToken(env: Env): Promise<string | null> {
    try {
        const token = (await readFile(deviceTokenPath(env), "utf8")).trim();
        return token === "" ? null : token;
    } catch {
        return null;
    }
}

export async function clientOf(options: ClientOptions = {}): Promise<Client> {
    const env = options.env ?? process.env;
    const url =
        options.url ??
        env.DOROTHY_MEMORY_URL ??
        `http://127.0.0.1:${(await readConfig(env)).config.service.port}`;
    return {
        env,
        url,
        token:
            options.token === undefined ? await readToken(env) : options.token,
        fetch: options.fetch ?? fetch,
    };
}

async function writePrivate(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, text, { mode: 0o600 });
    await rename(temp, path);
}

type Posted<T> =
    | { kind: "ok"; data: T }
    | { kind: "refused" }
    | { kind: "unreachable" };

async function post<T>(
    client: Client,
    path: string,
    body: unknown,
    timeout: number,
    schema: z.ZodType<T>,
): Promise<Posted<T>> {
    try {
        const response = await client.fetch(new URL(path, client.url), {
            method: "POST",
            headers: {
                "content-type": "application/json",
                ...(client.token === null
                    ? {}
                    : { authorization: `Bearer ${client.token}` }),
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeout),
        });
        // Refused for good: what the service cannot take. A token it
        // does not know, or a rate, may come right, so those wait.
        if ([400, 404, 413, 415, 422].includes(response.status)) {
            return { kind: "refused" };
        }
        if (!response.ok) {
            return { kind: "unreachable" };
        }
        const parsed = schema.safeParse(await response.json());
        return parsed.success
            ? { kind: "ok", data: parsed.data }
            : { kind: "unreachable" };
    } catch {
        return { kind: "unreachable" };
    }
}

export async function requestBlock(
    request: BlockRequest,
    options: ClientOptions = {},
): Promise<BlockResponse | null> {
    const client = await clientOf(options);
    const path = blockPath(client.env, request.host, request.project);
    const posted = await post(
        client,
        SERVICE_PATHS.block,
        request,
        TIMEOUTS.block,
        blockResponseSchema,
    );
    if (posted.kind === "ok") {
        await writePrivate(path, posted.data.text).catch(() => {});
        return posted.data;
    }
    try {
        const text = await readFile(path, "utf8");
        return { text, digest: digestOf(text), items: [], used: size(text) };
    } catch {
        return null;
    }
}

export async function requestRecall(
    request: RecallRequest,
    options: ClientOptions = {},
): Promise<RecallResponse | null> {
    const posted = await post(
        await clientOf(options),
        SERVICE_PATHS.recall,
        request,
        TIMEOUTS.recall,
        recallResponseSchema,
    );
    return posted.kind === "ok" ? posted.data : null;
}

// Sends what waits, oldest first, until one cannot go; how many still
// wait.
export async function flushPending(
    options: ClientOptions = {},
): Promise<number> {
    const client = await clientOf(options);
    let names: string[];
    try {
        names = (await readdir(pendingDir(client.env)))
            .filter((name) => name.endsWith(".json"))
            .sort();
    } catch {
        return 0;
    }
    for (const [at, name] of names.entries()) {
        const path = join(pendingDir(client.env), name);
        let request: unknown;
        try {
            request = JSON.parse(await readFile(path, "utf8"));
        } catch {
            await rm(path, { force: true });
            continue;
        }
        const posted = await post(
            client,
            SERVICE_PATHS.record,
            request,
            TIMEOUTS.record,
            recordResponseSchema,
        );
        if (posted.kind === "unreachable") {
            return names.length - at;
        }
        await rm(path, { force: true });
    }
    return 0;
}

export async function sendRecord(
    request: RecordRequest,
    options: ClientOptions = {},
): Promise<RecordResponse | null> {
    const client = await clientOf(options);
    const waiting = await flushPending({ ...options, ...client });
    const posted =
        waiting === 0
            ? await post(
                  client,
                  SERVICE_PATHS.record,
                  request,
                  TIMEOUTS.record,
                  recordResponseSchema,
              )
            : ({ kind: "unreachable" } as const);
    if (posted.kind === "ok") {
        return posted.data;
    }
    if (posted.kind === "unreachable") {
        await writePrivate(
            join(pendingDir(client.env), `${Date.now()}-${randomUUID()}.json`),
            JSON.stringify(request),
        ).catch(() => {});
    }
    return null;
}

async function healthy(client: Client): Promise<boolean> {
    try {
        const response = await client.fetch(
            new URL(SERVICE_PATHS.health, client.url),
            {
                headers:
                    client.token === null
                        ? {}
                        : { authorization: `Bearer ${client.token}` },
                signal: AbortSignal.timeout(TIMEOUTS.health),
            },
        );
        return response.ok;
    } catch {
        return false;
    }
}

// Starts the service on this machine when it does not answer, detached,
// and waits a second at most for it; false when it is still not there or
// lives on another machine.
export async function ensureService(
    command: readonly string[],
    options: ClientOptions = {},
): Promise<boolean> {
    const client = await clientOf(options);
    if (await healthy(client)) {
        return true;
    }
    if (!isLoopback(new URL(client.url).hostname) || command.length === 0) {
        return false;
    }
    const [program, ...args] = command;
    spawn(program as string, args, { detached: true, stdio: "ignore" }).unref();
    for (let tries = 0; tries < 10; tries++) {
        await Bun.sleep(100);
        if (await healthy(client)) {
            return true;
        }
    }
    return false;
}
