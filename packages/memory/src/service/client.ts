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
import { isLoopbackUrl } from "./loopback.js";

export const DEFAULT_URL = `http://127.0.0.1:${SERVICE_PORT}`;
// What ensureService waits for a service it started, in all.
const START_WAIT = 1000;
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
    // Shorter timeouts than TIMEOUTS, for tests.
    timeouts?: Partial<Record<keyof typeof TIMEOUTS, number>>;
};

type Client = {
    env: Env;
    url: string;
    token: string | null;
    fetch: typeof fetch;
    timeouts: Record<keyof typeof TIMEOUTS, number>;
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
        encodeURIComponent(host),
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
        timeouts: { ...TIMEOUTS, ...options.timeouts },
    };
}

async function writePrivate(path: string, text: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    await writeFile(temp, text, { mode: 0o600 });
    await rename(temp, path);
}

const REFUSED = [400, 403, 404, 413, 415, 422];

type Posted<T> =
    | { kind: "ok"; data: T }
    // Taken (a 2xx), though its reply is not the contract's.
    | { kind: "delivered" }
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
        // Refused for good: what the service cannot take, or will not
        // from this client. A token it does not know, a timeout, a rate
        // or a fault of its own may come right, so those wait.
        if (REFUSED.includes(response.status)) {
            return { kind: "refused" };
        }
        if (!response.ok) {
            return { kind: "unreachable" };
        }
        // The service took it: a reply that does not parse is no reason
        // to send it twice.
        const parsed = await response
            .json()
            .then((reply) => schema.safeParse(reply))
            .catch(() => null);
        return parsed?.success
            ? { kind: "ok", data: parsed.data }
            : { kind: "delivered" };
    } catch {
        return { kind: "unreachable" };
    }
}

// The client of these options, or null where they cannot be read: the
// calls below promise never to throw.
const clientOrNull = (options: ClientOptions) =>
    clientOf(options).catch(() => null);

export async function requestBlock(
    request: BlockRequest,
    options: ClientOptions = {},
): Promise<BlockResponse | null> {
    const client = await clientOrNull(options);
    if (client === null) {
        return null;
    }
    const path = blockPath(client.env, request.host, request.project);
    const posted = await post(
        client,
        SERVICE_PATHS.block,
        request,
        client.timeouts.block,
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
    const client = await clientOrNull(options);
    if (client === null) {
        return null;
    }
    const posted = await post(
        client,
        SERVICE_PATHS.recall,
        request,
        client.timeouts.recall,
        recallResponseSchema,
    );
    return posted.kind === "ok" ? posted.data : null;
}

// Sends what waits, oldest first, until one cannot go or the record
// timeout is spent; how many still wait. It never throws.
export async function flushPending(
    options: ClientOptions = {},
): Promise<number> {
    try {
        const client = await clientOf(options);
        return await flush(client, Date.now() + client.timeouts.record);
    } catch {
        return 0;
    }
}

async function flush(client: Client, deadline: number): Promise<number> {
    let names: string[];
    try {
        names = (await readdir(pendingDir(client.env)))
            .filter((name) => name.endsWith(".json"))
            .sort();
    } catch {
        return 0;
    }
    for (const [at, name] of names.entries()) {
        const left = deadline - Date.now();
        if (left <= 0) {
            return names.length - at;
        }
        const path = join(pendingDir(client.env), name);
        let request: unknown;
        try {
            request = JSON.parse(await readFile(path, "utf8"));
        } catch {
            await rm(path, { force: true }).catch(() => {});
            continue;
        }
        const posted = await post(
            client,
            SERVICE_PATHS.record,
            request,
            left,
            recordResponseSchema,
        );
        if (posted.kind === "unreachable") {
            return names.length - at;
        }
        await rm(path, { force: true }).catch(() => {});
    }
    return 0;
}

// Breaks a tie between records made in one millisecond, in order.
let queued = 0;

export async function sendRecord(
    request: RecordRequest,
    options: ClientOptions = {},
): Promise<RecordResponse | null> {
    const client = await clientOrNull(options);
    if (client === null) {
        return null;
    }
    // One budget for the flush and the send together.
    const deadline = Date.now() + client.timeouts.record;
    const waiting = await flush(client, deadline);
    const left = deadline - Date.now();
    const posted =
        waiting === 0 && left > 0
            ? await post(
                  client,
                  SERVICE_PATHS.record,
                  request,
                  left,
                  recordResponseSchema,
              )
            : ({ kind: "unreachable" } as const);
    if (posted.kind === "ok") {
        return posted.data;
    }
    if (posted.kind === "unreachable") {
        await writePrivate(
            join(
                pendingDir(client.env),
                `${Date.now()}-${String(queued++).padStart(8, "0")}-${randomUUID()}.json`,
            ),
            JSON.stringify(request),
        ).catch(() => {});
    }
    return null;
}

async function healthy(client: Client, timeout: number): Promise<boolean> {
    try {
        const response = await client.fetch(
            new URL(SERVICE_PATHS.health, client.url),
            {
                headers:
                    client.token === null
                        ? {}
                        : { authorization: `Bearer ${client.token}` },
                signal: AbortSignal.timeout(timeout),
            },
        );
        return response.ok;
    } catch {
        return false;
    }
}

// Starts the service on this machine when it does not answer, detached,
// and waits a second at most for it; false when it is still not there or
// lives on another machine. It never throws.
export async function ensureService(
    command: readonly string[],
    options: ClientOptions = {},
): Promise<boolean> {
    try {
        const client = await clientOf(options);
        const { health } = client.timeouts;
        if (await healthy(client, health)) {
            return true;
        }
        if (!isLoopbackUrl(client.url) || command.length === 0) {
            return false;
        }
        const [program, ...args] = command;
        let failed = false;
        const child = spawn(program as string, args, {
            detached: true,
            stdio: "ignore",
        });
        child.on("error", () => {
            failed = true;
        });
        child.unref();
        const deadline = Date.now() + START_WAIT;
        while (!failed && Date.now() < deadline) {
            await Bun.sleep(100);
            const left = deadline - Date.now();
            if (!failed && (await healthy(client, Math.min(health, left)))) {
                return true;
            }
        }
        return false;
    } catch {
        return false;
    }
}
