// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/box/box.ts
//
//

// The box: bubblewrap around a worker's adapter, and so its agent and
// every command the agent runs. It starts from an empty root and mounts
// only what the spec names: the system's /usr and its links, a few /etc
// entries, the runtime read-only at its own paths, the clone read-write,
// and, at fixed places, the login and the box's socket directory. Every
// namespace is its own, so its network is loopback alone.

import { readFileSync } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { join } from "node:path";

// The home a box's agent sees, a fresh tmpfs each time.
export const BOX_HOME = "/home/worker";
// Where the box's sockets directory is mounted: proxy.sock, key.sock.
export const BOX_SOCKETS = "/run/dorothy";
// Where the bridge script is mounted.
export const BRIDGE_PATH = "/run/dorothy-bridge.ts";

const ROOT_ENTRIES = ["bin", "sbin", "lib", "lib32", "lib64"];
const ETC_ENTRIES = [
    "ssl",
    "ca-certificates",
    "pki",
    "passwd",
    "group",
    "nsswitch.conf",
    "localtime",
    "hosts",
];

// The host's top-level system entries: those that link into /usr, those
// that are directories of their own, and the /etc entries a box keeps.
export type SystemLayout = {
    links: [path: string, target: string][];
    dirs: string[];
    etc: string[];
};

export async function systemLayout(root = "/"): Promise<SystemLayout> {
    const layout: SystemLayout = { links: [], dirs: [], etc: [] };
    for (const name of ROOT_ENTRIES) {
        const path = join(root, name);
        const stat = await lstat(path).catch(() => null);
        if (stat?.isSymbolicLink()) {
            layout.links.push([path, await readlink(path)]);
        } else if (stat?.isDirectory()) {
            layout.dirs.push(path);
        }
    }
    for (const name of ETC_ENTRIES) {
        const path = join(root, "etc", name);
        if (await lstat(path).catch(() => null)) {
            layout.etc.push(path);
        }
    }
    return layout;
}

export type BoxSpec = {
    // Read-write, at its own path; the box works in it. None for a box
    // that writes nothing of the host's, which works in /.
    clone: string | null;
    // Read-only, each at its own path: the runtime, the adapter's store,
    // the borrowed objects.
    readOnly: string[];
    // Read-only, each at a target of its own: logins, the bridge.
    files: { source: string; target: string }[];
    // The box's own socket directory, read-only at BOX_SOCKETS; a socket
    // on a read-only mount can still be connected to.
    sockets: string | null;
    // The whole environment; nothing else is inherited.
    env: Record<string, string>;
    command: string[];
};

export function boxArgs(spec: BoxSpec, layout: SystemLayout): string[] {
    const args = [
        "bwrap",
        "--unshare-all",
        "--new-session",
        "--die-with-parent",
        "--clearenv",
        "--hostname",
        "box",
        "--ro-bind",
        "/usr",
        "/usr",
    ];
    for (const [path, target] of layout.links) {
        args.push("--symlink", target, path);
    }
    for (const path of layout.dirs) {
        args.push("--ro-bind", path, path);
    }
    for (const path of layout.etc) {
        args.push("--ro-bind-try", path, path);
    }
    args.push("--dev", "/dev", "--proc", "/proc");
    args.push("--tmpfs", BOX_HOME, "--tmpfs", "/tmp");
    for (const path of spec.readOnly) {
        args.push("--ro-bind", path, path);
    }
    if (spec.clone !== null) {
        args.push("--bind", spec.clone, spec.clone);
    }
    for (const { source, target } of spec.files) {
        args.push("--ro-bind", source, target);
    }
    if (spec.sockets !== null) {
        args.push("--ro-bind", spec.sockets, BOX_SOCKETS);
    }
    for (const [name, value] of Object.entries(spec.env)) {
        args.push("--setenv", name, value);
    }
    args.push("--chdir", spec.clone ?? "/", "--", ...spec.command);
    return args;
}

// Whether bubblewrap is here and may make a user namespace.
export async function boxAvailable(): Promise<boolean> {
    try {
        const args = boxArgs(
            {
                clone: "/tmp",
                readOnly: [],
                files: [],
                sockets: null,
                env: {},
                command: ["/usr/bin/true"],
            },
            await systemLayout(),
        );
        const proc = Bun.spawn(args, { stdout: "ignore", stderr: "ignore" });
        return (await proc.exited) === 0;
    } catch {
        return false;
    }
}

// The bridge's source, which the engine writes beside a box's sockets
// and mounts alone at BRIDGE_PATH.
export const bridgeSource = (): string =>
    readFileSync(join(import.meta.dir, "bridge.ts"), "utf8");
