// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/box/bridge.ts
//
//

// Runs inside a box, never imported: mounted alone at BRIDGE_PATH, it
// listens on loopback ports and forwards each to a Unix socket the box
// mounts, then runs the command after "--" and exits with it. It checks
// nothing: the worker may use, bypass or kill it, so every check is the
// host's, behind the socket.
//
//     bun /run/dorothy-bridge.ts 3128=/run/dorothy/proxy.sock -- cmd...

import { connect, createServer } from "node:net";

const args = process.argv.slice(2);
const split = args.indexOf("--");
const forwards = (split < 0 ? args : args.slice(0, split)).map((arg) => {
    const [port, path] = arg.split("=", 2);
    return { port: Number(port), path: path ?? "" };
});
const command = split < 0 ? [] : args.slice(split + 1);
if (
    command.length === 0 ||
    forwards.some(({ port, path }) => !(port > 0) || path === "")
) {
    process.stderr.write("bridge: <port>=<socket>... -- <command>\n");
    process.exit(2);
}

await Promise.all(
    forwards.map(
        ({ port, path }) =>
            new Promise<void>((resolve, reject) => {
                const server = createServer((socket) => {
                    const upstream = connect({ path });
                    socket.pipe(upstream).pipe(socket);
                    upstream.on("error", () => socket.destroy());
                    socket.on("error", () => upstream.destroy());
                });
                server.once("error", reject);
                server.listen(port, "127.0.0.1", () => resolve());
            }),
    ),
);

const env = { ...process.env };
if (env.DOROTHY_KEY_FILE && env.DOROTHY_KEY_NAME) {
    env[env.DOROTHY_KEY_NAME] = await Bun.file(env.DOROTHY_KEY_FILE).text();
    delete env.DOROTHY_KEY_FILE;
    delete env.DOROTHY_KEY_NAME;
}
const child = Bun.spawn(command, {
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
});
process.exit(await child.exited);
