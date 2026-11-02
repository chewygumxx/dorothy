// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/net/proxy.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import {
    type AddressInfo,
    connect,
    createServer,
    type Server,
    type Socket,
} from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type ProxyEntry, type ProxyOptions, startProxy } from "./proxy.js";

type Exchange = { status: string; socket: Socket };

// Sends one request line and headers, and reads the status line back.
function request(path: string, head: string): Promise<Exchange> {
    return new Promise((resolve, reject) => {
        const socket = connect({ path });
        let got = "";
        socket.on("data", (chunk) => {
            got += chunk.toString();
            const end = got.indexOf("\r\n");
            if (end >= 0) {
                socket.removeAllListeners("data");
                resolve({ status: got.slice(0, end), socket });
            }
        });
        socket.on("error", reject);
        socket.on("close", () => resolve({ status: got, socket }));
        socket.write(head);
    });
}

const connectLine = (target: string) =>
    `CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`;

describe("the proxy", () => {
    let dir: string;
    let echo: Server;
    let port: number;
    let log: ProxyEntry[];
    let close: () => Promise<void>;

    const start = async (options: Partial<ProxyOptions> = {}) => {
        const proxy = await startProxy({
            socket: join(dir, "proxy.sock"),
            hosts: new Set(["api.test", "registry.test"]),
            port,
            resolve: async (host) =>
                host === "private.test"
                    ? ["10.0.0.1"]
                    : host === "mixed.test"
                      ? ["127.0.0.1", "10.1.1.1"]
                      : ["127.0.0.1"],
            allowAddress: (address) => address === "127.0.0.1",
            log: (entry) => log.push(entry),
            ...options,
        });
        close = proxy.close;
        return join(dir, "proxy.sock");
    };

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "proxy-"));
        log = [];
        echo = createServer((socket) => socket.pipe(socket));
        await new Promise<void>((resolve) =>
            echo.listen(0, "127.0.0.1", resolve),
        );
        port = (echo.address() as AddressInfo).port;
        close = async () => {};
    });

    afterEach(async () => {
        await close();
        echo.close();
        await rm(dir, { recursive: true, force: true });
    });

    it("tunnels a listed host on its port, and logs it", async () => {
        const path = await start();
        const { status, socket } = await request(
            path,
            connectLine(`api.test:${port}`),
        );
        expect(status).toBe("HTTP/1.1 200 Connection Established");
        const back = new Promise<string>((resolve) =>
            socket.once("data", (d) => resolve(d.toString())),
        );
        socket.write("hello");
        expect(await back).toBe("hello");
        socket.destroy();
        expect(log).toEqual([
            expect.objectContaining({
                host: "api.test",
                port,
                decision: "allowed",
            }),
        ]);
    });

    it("forwards bytes sent with the request", async () => {
        const path = await start();
        const socket = connect({ path });
        let got = "";
        const done = new Promise<void>((resolve) =>
            socket.on("data", (d) => {
                got += d.toString();
                if (got.endsWith("early")) resolve();
            }),
        );
        socket.write(`${connectLine(`api.test:${port}`)}early`);
        await done;
        expect(got).toBe("HTTP/1.1 200 Connection Established\r\n\r\nearly");
        socket.destroy();
    });

    it("normalises the host's case and trailing dot", async () => {
        const path = await start();
        const { status, socket } = await request(
            path,
            connectLine(`API.Test.:${port}`),
        );
        expect(status).toBe("HTTP/1.1 200 Connection Established");
        socket.destroy();
    });

    it.each([
        [
            "an unlisted host",
            (p: number) => connectLine(`example.test:${p}`),
            "403",
        ],
        [
            "a listed host on another port",
            () => connectLine("api.test:22"),
            "403",
        ],
        [
            "an address for a host",
            (p: number) => connectLine(`127.0.0.1:${p}`),
            "403",
        ],
        ["an IPv6 address", (p: number) => connectLine(`[::1]:${p}`), "403"],
        ["a wildcard", (p: number) => connectLine(`*.test:${p}`), "403"],
        [
            "another method",
            () => "GET http://api.test/ HTTP/1.1\r\nHost: api.test\r\n\r\n",
            "405",
        ],
        ["a malformed line", () => "CONNECT\r\n\r\n", "400"],
    ])("refuses %s", async (_, head, code) => {
        const path = await start();
        const { status, socket } = await request(path, head(port));
        expect(status).toStartWith(`HTTP/1.1 ${code} `);
        socket.destroy();
        expect(log.at(-1)?.decision).toBe("refused");
    });

    it("refuses a listed host resolving to an address it may not reach", async () => {
        const path = await start({
            hosts: new Set(["private.test", "mixed.test"]),
        });
        for (const host of ["private.test", "mixed.test"]) {
            const { status, socket } = await request(
                path,
                connectLine(`${host}:${port}`),
            );
            expect(status).toStartWith("HTTP/1.1 403 ");
            socket.destroy();
        }
    });

    it("refuses loopback by default, whatever the host resolves to", async () => {
        const path = await start({ allowAddress: undefined });
        const { status, socket } = await request(
            path,
            connectLine(`api.test:${port}`),
        );
        expect(status).toStartWith("HTTP/1.1 403 ");
        socket.destroy();
    });

    it("refuses headers past their limit", async () => {
        const path = await start();
        const { status, socket } = await request(
            path,
            `CONNECT api.test:${port} HTTP/1.1\r\nX: ${"a".repeat(9000)}\r\n\r\n`,
        );
        expect(status).toStartWith("HTTP/1.1 431 ");
        socket.destroy();
    });

    it("gives up on a request that does not finish in time", async () => {
        const path = await start({ headerMs: 100 });
        const { status, socket } = await request(path, "CONNECT api.test");
        expect(status).toStartWith("HTTP/1.1 408 ");
        socket.destroy();
    });

    it("refuses a connection past the box's limit", async () => {
        const path = await start({ maxConnections: 1 });
        const first = await request(path, connectLine(`api.test:${port}`));
        expect(first.status).toBe("HTTP/1.1 200 Connection Established");
        const second = await request(path, connectLine(`api.test:${port}`));
        expect(second.status).toStartWith("HTTP/1.1 503 ");
        first.socket.destroy();
        second.socket.destroy();
    });

    it("closes a tunnel left idle", async () => {
        const path = await start({ idleMs: 100 });
        const { socket } = await request(path, connectLine(`api.test:${port}`));
        await new Promise<void>((resolve) =>
            socket.on("close", () => resolve()),
        );
    });

    it("ends its tunnels when it closes", async () => {
        const path = await start();
        const { socket } = await request(path, connectLine(`api.test:${port}`));
        const closed = new Promise<void>((resolve) =>
            socket.on("close", () => resolve()),
        );
        await close();
        await closed;
    });

    it("answers 502 when the host cannot be reached", async () => {
        const path = await start({ port: 1 });
        const { status, socket } = await request(
            path,
            connectLine("api.test:1"),
        );
        expect(status).toStartWith("HTTP/1.1 502 ");
        socket.destroy();
    });
});
