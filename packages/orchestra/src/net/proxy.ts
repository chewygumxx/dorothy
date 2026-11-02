// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/net/proxy.ts
//
//

// A box's proxy: one listener per box, on the Unix socket the box
// mounts. It restricts egress by TCP destination and reads no TLS: one
// CONNECT to an exact host on the one port, resolved here, every address
// public, connected to as checked and never resolved again.

import { lookup } from "node:dns/promises";
import { unlink } from "node:fs/promises";
import { connect, createServer, type Socket } from "node:net";
import { hostName } from "../config.js";
import { isPublicAddress } from "./addresses.js";

export type ProxyEntry = {
    at: string;
    host: string;
    port: number;
    decision: "allowed" | "refused";
    reason: string;
};

export type ProxyOptions = {
    socket: string;
    // Exact host names, normalised as config's hostName gives them.
    hosts: ReadonlySet<string>;
    log: (entry: ProxyEntry) => void;
    // The one port a tunnel may reach; tests name their fake's.
    port?: number;
    resolve?: (host: string) => Promise<string[]>;
    allowAddress?: (address: string) => boolean;
    maxConnections?: number;
    headerBytes?: number;
    headerMs?: number;
    idleMs?: number;
};

export type Proxy = { close: () => Promise<void> };

const REASONS: Record<number, string> = {
    400: "Bad Request",
    403: "Forbidden",
    405: "Method Not Allowed",
    408: "Request Timeout",
    431: "Request Header Fields Too Large",
    502: "Bad Gateway",
    503: "Service Unavailable",
};

const resolveAll = async (host: string) =>
    (await lookup(host, { all: true, verbatim: true })).map(
        ({ address }) => address,
    );

export async function startProxy(options: ProxyOptions): Promise<Proxy> {
    const {
        socket: path,
        hosts,
        log,
        port: allowedPort = 443,
        resolve = resolveAll,
        allowAddress = isPublicAddress,
        maxConnections = 32,
        headerBytes = 8192,
        headerMs = 10_000,
        idleMs = 600_000,
    } = options;
    let open = 0;
    // Every socket either side, so that closing the proxy ends its tunnels.
    const sockets = new Set<Socket>();
    const track = (socket: Socket) => {
        sockets.add(socket);
        socket.once("close", () => sockets.delete(socket));
    };

    const say = (
        host: string,
        port: number,
        decision: ProxyEntry["decision"],
        reason: string,
    ) => log({ at: new Date().toISOString(), host, port, decision, reason });

    const refuse = (
        client: Socket,
        code: number,
        host: string,
        port: number,
        reason: string,
    ) => {
        say(host, port, "refused", reason);
        client.end(
            `HTTP/1.1 ${code} ${REASONS[code]}\r\nConnection: close\r\n\r\n`,
        );
    };

    const tunnel = async (client: Socket, head: string, rest: Buffer) => {
        const line = head.slice(0, head.indexOf("\r\n"));
        const match = line.match(/^([A-Z]+) (\S+) HTTP\/1\.[01]$/);
        if (match === null) {
            return refuse(client, 400, "", 0, "malformed request");
        }
        const [, method, target = ""] = match;
        if (method !== "CONNECT") {
            return refuse(client, 405, target, 0, `method ${method}`);
        }
        const colon = target.lastIndexOf(":");
        const port = Number(target.slice(colon + 1));
        const host = colon > 0 ? hostName(target.slice(0, colon)) : null;
        if (host === null || !hosts.has(host)) {
            return refuse(
                client,
                403,
                target.slice(0, colon),
                port,
                "host not allowed",
            );
        }
        if (port !== allowedPort) {
            return refuse(client, 403, host, port, "port not allowed");
        }
        let addresses: string[];
        try {
            addresses = await resolve(host);
        } catch {
            return refuse(client, 502, host, port, "host did not resolve");
        }
        if (addresses.length === 0 || !addresses.every(allowAddress)) {
            return refuse(client, 403, host, port, "address not allowed");
        }
        const upstream = connect({ host: addresses[0], port });
        track(upstream);
        upstream.once("error", () => {
            if (!client.destroyed && upstream.bytesRead === 0) {
                refuse(client, 502, host, port, "host refused the connection");
            }
            client.destroy();
        });
        upstream.once("connect", () => {
            say(host, port, "allowed", `connected to ${addresses[0]}`);
            client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
            if (rest.length > 0) {
                upstream.write(rest);
            }
            client.pipe(upstream).pipe(client);
            for (const end of [client, upstream]) {
                end.setTimeout(idleMs, () => {
                    client.destroy();
                    upstream.destroy();
                });
            }
        });
        client.once("close", () => upstream.destroy());
    };

    const server = createServer((client) => {
        track(client);
        client.on("error", () => client.destroy());
        if (open >= maxConnections) {
            refuse(client, 503, "", 0, "too many connections");
            return;
        }
        open++;
        client.once("close", () => open--);
        let buffered = Buffer.alloc(0);
        const timer = setTimeout(
            () => refuse(client, 408, "", 0, "request too slow"),
            headerMs,
        );
        const onData = (chunk: Buffer) => {
            buffered = Buffer.concat([buffered, chunk]);
            const end = buffered.indexOf("\r\n\r\n");
            if (end < 0 && buffered.length <= headerBytes) {
                return;
            }
            client.off("data", onData);
            clearTimeout(timer);
            if (end < 0 || end + 4 > headerBytes) {
                return refuse(client, 431, "", 0, "request too large");
            }
            void tunnel(
                client,
                buffered.subarray(0, end + 4).toString("latin1"),
                buffered.subarray(end + 4),
            );
        };
        client.on("data", onData);
        client.once("close", () => clearTimeout(timer));
    });

    await unlink(path).catch(() => {});
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(path, () => resolve());
    });
    return {
        close: () =>
            new Promise<void>((resolve) => {
                server.close(() => resolve());
                for (const socket of sockets) {
                    socket.destroy();
                }
            }),
    };
}
