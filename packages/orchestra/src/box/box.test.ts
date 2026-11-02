// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/orchestra/src/box/box.test.ts
//
//

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    symlink,
    writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
    BOX_HOME,
    BOX_SOCKETS,
    type BoxSpec,
    BRIDGE_PATH,
    boxArgs,
    boxAvailable,
    bridgeSource,
    type SystemLayout,
    systemLayout,
} from "./box.js";

const LAYOUT: SystemLayout = {
    links: [["/bin", "usr/bin"]],
    dirs: ["/lib64"],
    etc: ["/etc/ssl", "/etc/passwd"],
};

const SPEC = {
    clone: "/w/s1/codex-1",
    readOnly: ["/opt/bun/bin", "/repo/node_modules"],
    files: [
        {
            source: "/h/.codex/auth.json",
            target: `${BOX_HOME}/.codex/auth.json`,
        },
    ],
    sockets: "/state/boxes/codex-1",
    env: { PATH: "/usr/bin", HOME: BOX_HOME },
    command: ["/opt/bun/bin/bun", "/repo/adapter.js"],
} satisfies BoxSpec;

describe("boxArgs", () => {
    const args = boxArgs(SPEC, LAYOUT);
    const pairs = (flag: string) =>
        args.flatMap((arg, i) =>
            arg === flag ? [args.slice(i + 1, i + 3)] : [],
        );

    it("starts from an empty root, every namespace its own, the environment cleared", () => {
        for (const flag of [
            "--unshare-all",
            "--new-session",
            "--die-with-parent",
            "--clearenv",
        ]) {
            expect(args).toContain(flag);
        }
        expect(args).not.toContain("--share-net");
        expect(args.some((arg) => arg === "/")).toBe(false);
    });

    it("mounts the system's /usr, its links and the named /etc entries read-only", () => {
        expect(pairs("--ro-bind")).toContainEqual(["/usr", "/usr"]);
        expect(pairs("--symlink")).toContainEqual(["usr/bin", "/bin"]);
        expect(pairs("--ro-bind")).toContainEqual(["/lib64", "/lib64"]);
        expect(pairs("--ro-bind-try")).toContainEqual(["/etc/ssl", "/etc/ssl"]);
        expect(pairs("--ro-bind-try")).toContainEqual([
            "/etc/passwd",
            "/etc/passwd",
        ]);
    });

    it("binds the clone alone read-write, and works in it", () => {
        expect(pairs("--bind")).toEqual([[SPEC.clone, SPEC.clone]]);
        expect(pairs("--chdir")).toEqual([[SPEC.clone, expect.any(String)]]);
    });

    it("binds nothing read-write for a box without a clone, and works in /", () => {
        const none = boxArgs({ ...SPEC, clone: null }, LAYOUT);
        expect(none).not.toContain("--bind");
        const chdir = none.indexOf("--chdir");
        expect(none.slice(chdir, chdir + 2)).toEqual(["--chdir", "/"]);
    });

    it("binds the runtime, the login and the sockets read-only", () => {
        const ro = pairs("--ro-bind");
        expect(ro).toContainEqual(["/opt/bun/bin", "/opt/bun/bin"]);
        expect(ro).toContainEqual(["/repo/node_modules", "/repo/node_modules"]);
        expect(ro).toContainEqual([
            "/h/.codex/auth.json",
            `${BOX_HOME}/.codex/auth.json`,
        ]);
        expect(ro).toContainEqual(["/state/boxes/codex-1", BOX_SOCKETS]);
    });

    it("gives fresh tmpfs for the home and /tmp, and its own /dev and /proc", () => {
        expect(pairs("--tmpfs").map(([path]) => path)).toEqual([
            BOX_HOME,
            "/tmp",
        ]);
        expect(pairs("--dev").map(([path]) => path)).toEqual(["/dev"]);
        expect(pairs("--proc").map(([path]) => path)).toEqual(["/proc"]);
    });

    it("sets exactly the environment given, then runs the command", () => {
        expect(pairs("--setenv")).toEqual([
            ["PATH", "/usr/bin"],
            ["HOME", BOX_HOME],
        ]);
        expect(args.slice(args.indexOf("--") + 1)).toEqual(SPEC.command);
    });
});

describe("systemLayout", () => {
    it("reads the host's links and directories", async () => {
        const root = await mkdtemp(join(tmpdir(), "layout-"));
        try {
            await mkdir(join(root, "usr", "bin"), { recursive: true });
            await mkdir(join(root, "lib64"));
            await symlink("usr/bin", join(root, "bin"));
            await mkdir(join(root, "etc", "ssl"), { recursive: true });
            const layout = await systemLayout(root);
            expect(layout.links).toEqual([[join(root, "bin"), "usr/bin"]]);
            expect(layout.dirs).toEqual([join(root, "lib64")]);
            expect(layout.etc).toContain(join(root, "etc", "ssl"));
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

// Real boxes, where bubblewrap can make a user namespace.
const available = await boxAvailable();

describe.if(available)("a box", () => {
    let root: string;
    let clone: string;
    let sockets: string;
    let bun: string;
    let echo: Server;
    let layout: SystemLayout;

    const run = async (script: string, env: Record<string, string> = {}) => {
        const proc = Bun.spawn(
            boxArgs(
                {
                    clone,
                    readOnly: [bun],
                    files: [
                        {
                            source: join(root, "login.json"),
                            target: `${BOX_HOME}/.codex/auth.json`,
                        },
                    ],
                    sockets,
                    env: {
                        PATH: `${bun}:/usr/bin:/bin`,
                        HOME: BOX_HOME,
                        ...env,
                    },
                    command: ["/bin/sh", "-c", script],
                },
                layout,
            ),
            { stdout: "pipe", stderr: "pipe" },
        );
        const [out, err] = [
            await new Response(proc.stdout).text(),
            await new Response(proc.stderr).text(),
        ];
        return { code: await proc.exited, out: out.trim(), err };
    };

    beforeAll(async () => {
        root = await realpath(await mkdtemp(join(tmpdir(), "box-")));
        clone = join(root, "s1", "codex-1");
        sockets = join(root, "sockets");
        await mkdir(clone, { recursive: true });
        await mkdir(sockets);
        await writeFile(join(root, "secret"), "the sibling's secret\n");
        await writeFile(join(root, "login.json"), '{"token":"t"}\n');
        await symlink(join(root, "secret"), join(clone, "out"));
        bun = dirname(await realpath(process.execPath));
        layout = await systemLayout();
        echo = createServer((socket) => socket.pipe(socket)).listen(
            join(sockets, "echo.sock"),
        );
        // A host service's socket beside the clone, never mounted.
        createServer().listen(join(root, "host.sock"));
    });

    afterAll(async () => {
        echo.close();
        await rm(root, { recursive: true, force: true });
    });

    it("writes to the clone, onto the host", async () => {
        expect((await run("echo work > made")).code).toBe(0);
        expect(await readFile(join(clone, "made"), "utf8")).toBe("work\n");
    });

    it("writes nowhere else on the host", async () => {
        const { out } = await run(
            `touch /usr/x 2>/dev/null && echo usr; touch ${root}/x; echo t > /tmp/t; echo h > $HOME/h; echo done`,
        );
        expect(out).toBe("done");
        // The clone's parents exist in the box's own tmpfs, not the host's.
        expect(await Bun.file(join(root, "x")).exists()).toBe(false);
    });

    it("shows none of the host beyond what it mounts", async () => {
        const { out } = await run(
            `for p in /var /opt /mnt /media /srv /run/user ${root}/secret ${root}/host.sock; do test -e "$p" && echo "$p"; done; cat out 2>/dev/null; echo end`,
        );
        expect(out).toBe("end");
    });

    it("shows of the user's home only the path to a runtime it mounts", async () => {
        const home = process.env.HOME ?? "/nonexistent";
        const { out } = await run(`ls -A ${home} 2>/dev/null; echo end`);
        const shown = out.split("\n").filter((line) => line !== "end");
        const allowed = bun.startsWith(`${home}/`)
            ? [bun.slice(home.length + 1).split("/")[0] ?? ""]
            : [];
        expect(shown).toEqual(allowed);
    });

    it("admits the login read-only, at its place in the home", async () => {
        const { out } = await run(
            `cat $HOME/.codex/auth.json; echo x > $HOME/.codex/auth.json 2>/dev/null && echo wrote`,
        );
        expect(out).toBe('{"token":"t"}');
    });

    it("passes no descriptor but stdin, stdout and stderr", async () => {
        const { out } = await run("ls /proc/self/fd | tr '\\n' ' '");
        // ls's own listing of the directory is the fourth.
        expect(out.split(" ").filter(Boolean)).toEqual(["0", "1", "2", "3"]);
    });

    it("sets only the environment given", async () => {
        // The shell's environment as it was given, before it adds its own;
        // bubblewrap sets PWD as it changes directory.
        const { out } = await run(
            "tr '\\0' '\\n' < /proc/$$/environ | cut -d= -f1 | sort | tr '\\n' ' '",
            { LANG: "C.UTF-8" },
        );
        expect(out.split(" ").filter(Boolean)).toEqual([
            "HOME",
            "LANG",
            "PATH",
            "PWD",
        ]);
    });

    it("has no network but loopback", async () => {
        const { out } = await run(
            `${bun}/bun -e 'try { await fetch("http://1.1.1.1", { signal: AbortSignal.timeout(2000) }); console.log("reached") } catch { console.log("none") }'`,
        );
        expect(out).toBe("none");
    });

    it("bridges a loopback port to a socket of its own", async () => {
        await writeFile(join(root, "bridge.ts"), bridgeSource());
        const proc = Bun.spawn(
            boxArgs(
                {
                    clone,
                    readOnly: [bun],
                    files: [
                        {
                            source: join(root, "bridge.ts"),
                            target: BRIDGE_PATH,
                        },
                    ],
                    sockets,
                    env: { PATH: `${bun}:/usr/bin:/bin`, HOME: BOX_HOME },
                    command: [
                        `${bun}/bun`,
                        BRIDGE_PATH,
                        `3128=${BOX_SOCKETS}/echo.sock`,
                        "--",
                        `${bun}/bun`,
                        "-e",
                        `const s = await Bun.connect({ hostname: "127.0.0.1", port: 3128, socket: { data(_, d) { console.log(d.toString()); process.exit(0) } } }); s.write("ping")`,
                    ],
                },
                layout,
            ),
            { stdout: "pipe", stderr: "pipe" },
        );
        expect((await new Response(proc.stdout).text()).trim()).toBe("ping");
        expect(await proc.exited).toBe(0);
    });
});
