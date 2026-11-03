// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/runtime.test.ts
//
//

import { afterAll, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { resolvePiRuntime } from "./runtime.js";

const roots: string[] = [];
const cliDir = resolve(import.meta.dir, "../../..");
const packageName = "@earendil-works/pi-coding-agent";

afterAll(async () => {
    await Promise.all(
        roots.map((root) => rm(root, { recursive: true, force: true })),
    );
});

async function scratch() {
    const root = await mkdtemp(join(tmpdir(), "dorothy-pi-runtime-"));
    roots.push(root);
    return root;
}

async function write(path: string, text: string) {
    await mkdir(dirname(path), { recursive: true });
    await Bun.write(path, text);
}

async function fixture(version = "22.19.0") {
    const root = await scratch();
    const node = join(root, "bin/node");
    await write(node, `#!/bin/sh\nprintf 'v${version}\\n'\n`);
    await chmod(node, 0o755);
    await write(
        join(root, "package.json"),
        JSON.stringify({ dependencies: { [packageName]: "1.5.0" } }),
    );
    const installed = join(root, "node_modules", packageName);
    await write(
        join(installed, "package.json"),
        JSON.stringify({
            name: packageName,
            version: "1.5.0",
            bin: { pi: "dist/cli.js" },
        }),
    );
    const binary = join(installed, "dist/cli.js");
    await write(binary, "console.log('1.5.0');\n");
    await mkdir(join(root, "node_modules/.bin"), { recursive: true });
    const link = join(root, "node_modules/.bin/pi");
    await symlink("../@earendil-works/pi-coding-agent/dist/cli.js", link);
    return {
        root,
        node,
        installed,
        binary,
        link,
        env: { PATH: join(root, "bin"), HOME: root },
    };
}

it("accepts Node 22.19 and resolves the pinned public executable", async () => {
    const f = await fixture();
    expect(await resolvePiRuntime(f.root, f.env)).toEqual({
        command: [f.node, f.binary],
        version: "1.5.0",
    });
});

it("refuses Node 22.18 before launching Pi", async () => {
    const f = await fixture("22.18.0");
    await expect(resolvePiRuntime(f.root, f.env)).rejects.toThrow(
        "pi_node_version",
    );
});

it("refuses a missing Node without consulting ambient PATH", async () => {
    const f = await fixture();
    await expect(resolvePiRuntime(f.root, { PATH: "" })).rejects.toThrow(
        "pi_node_missing",
    );
});

it("refuses a missing package binary", async () => {
    const f = await fixture();
    await rm(f.link);
    await expect(resolvePiRuntime(f.root, f.env)).rejects.toThrow(
        "pi_binary_missing",
    );
});

it("refuses a dependency range instead of the exact pin", async () => {
    const f = await fixture();
    await write(
        join(f.root, "package.json"),
        JSON.stringify({ dependencies: { [packageName]: "^1.5.0" } }),
    );
    await expect(resolvePiRuntime(f.root, f.env)).rejects.toThrow(
        "pi_dependency_pin",
    );
});

it("refuses an installed version different from the manifest pin", async () => {
    const f = await fixture();
    await write(
        join(f.installed, "package.json"),
        JSON.stringify({
            name: packageName,
            version: "1.5.1",
            bin: { pi: "dist/cli.js" },
        }),
    );
    await expect(resolvePiRuntime(f.root, f.env)).rejects.toThrow(
        "pi_package_pin",
    );
});

it("refuses a binary link outside the package's published bin", async () => {
    const f = await fixture();
    const decoy = join(f.root, "decoy.js");
    await write(decoy, "throw Error('wrong executable');\n");
    await rm(f.link);
    await symlink(decoy, f.link);
    await expect(resolvePiRuntime(f.root, f.env)).rejects.toThrow(
        "pi_binary_mismatch",
    );
});

it("reports Node probe failure by code and path, without its output", async () => {
    const f = await fixture();
    await write(
        f.node,
        "#!/bin/sh\nprintf 'private-probe-output' >&2\nexit 1\n",
    );
    try {
        await resolvePiRuntime(f.root, f.env);
        throw new Error("expected refusal");
    } catch (error) {
        expect(String(error)).toContain("pi_node_version");
        expect(String(error)).toContain(f.node);
        expect(String(error)).not.toContain("private-probe-output");
    }
});

it("runs published Pi offline, ignoring a hostile global pi", async () => {
    const root = await scratch();
    const decoy = join(root, "bin/pi");
    const marker = join(root, "decoy-ran");
    await write(decoy, `#!/bin/sh\nprintf decoy > '${marker}'\nexit 91\n`);
    await chmod(decoy, 0o755);
    // `bun run test` prepends a node alias pointing to Bun. This probe
    // exercises the published CLI with a real Node, even from that script.
    const bun = await realpath(process.execPath);
    const path: string[] = [];
    for (const directory of (process.env.PATH ?? "").split(":")) {
        const node = Bun.which("node", { PATH: directory });
        if (node && (await realpath(node)) === bun) continue;
        path.push(directory);
    }
    const env = {
        PATH: `${dirname(decoy)}:${path.join(":")}`,
        HOME: root,
        XDG_CONFIG_HOME: join(root, "config"),
        XDG_DATA_HOME: join(root, "data"),
        XDG_CACHE_HOME: join(root, "cache"),
        XDG_STATE_HOME: join(root, "state"),
        PI_CODING_AGENT_DIR: join(root, "agent"),
        PI_OFFLINE: "1",
    };
    const runtime = await resolvePiRuntime(cliDir, env);
    expect(runtime.version).toBe("1.5.0");
    expect(runtime.command[0]).not.toBe(decoy);
    expect(runtime.command[1]).toBe(
        await realpath(join(cliDir, "node_modules/.bin/pi")),
    );
    const child = Bun.spawn([...runtime.command, "--offline", "--version"], {
        cwd: root,
        env,
        stdout: "pipe",
        stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    expect({ code, stderr, stdout: stdout.trim() }).toEqual({
        code: 0,
        stderr: "",
        stdout: "1.5.0",
    });
    expect(await Bun.file(marker).exists()).toBe(false);
}, 30_000);
