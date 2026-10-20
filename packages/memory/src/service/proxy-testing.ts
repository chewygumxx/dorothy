// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/proxy-testing.ts
//
//

// A user's proxy, for tests: a listener that counts its connections and
// closes each at once, so a request that goes through it is seen and
// fails. Bun keeps the proxy a process first saw, even once its
// variable is gone, so what runs behind it runs in a process of its own.

import { createServer } from "node:net";

const PROXIES = [
    "HTTP_PROXY",
    "http_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
];

export type ProxyTrap = {
    // Every proxy variable pointing at the listener, and no NO_PROXY.
    env: Record<string, string>;
    connections: () => number;
    close: () => Promise<void>;
};

export async function trapProxy(): Promise<ProxyTrap> {
    let connections = 0;
    const server = createServer((socket) => {
        connections++;
        socket.destroy();
    });
    await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as { port: number };
    return {
        env: Object.fromEntries(
            PROXIES.map((name) => [name, `http://127.0.0.1:${port}`]),
        ),
        connections: () => connections,
        close: () =>
            new Promise<void>((resolve) => server.close(() => resolve())),
    };
}

// What a script prints, run by Bun in a process of its own with only
// the environment given (and PATH), from a directory of no checkout's.
export async function runScript(
    script: string,
    env: Record<string, string>,
    cwd: string,
): Promise<string> {
    const child = Bun.spawn([process.execPath, "-e", script], {
        cwd,
        env: { PATH: process.env.PATH ?? "", ...env },
        stdout: "pipe",
        stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    if (code !== 0) {
        throw new Error(`the script failed (${code}): ${err}`);
    }
    return out;
}
