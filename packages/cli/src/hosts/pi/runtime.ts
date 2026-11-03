// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/pi/runtime.ts
//
//

import { realpath } from "node:fs/promises";
import { join } from "node:path";
import type { Env } from "@dorothy/core";

export type PiRuntime = { command: string[]; version: "1.5.0" };

const PACKAGE = "@earendil-works/pi-coding-agent";
const VERSION = "1.5.0";

type Metadata = {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    bin?: string | Record<string, string>;
};

async function metadata(path: string, code: string): Promise<Metadata> {
    try {
        const value: unknown = await Bun.file(path).json();
        if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error();
        }
        return value as Metadata;
    } catch {
        throw new Error(`${code}: ${path}`);
    }
}

async function binaryPath(path: string): Promise<string> {
    try {
        return await realpath(path);
    } catch {
        throw new Error(`pi_binary_missing: ${path}`);
    }
}

async function checkNode(node: string, env: Env): Promise<void> {
    try {
        const child = Bun.spawn([node, "--version"], {
            env,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "ignore",
        });
        const [output, code] = await Promise.all([
            new Response(child.stdout).text(),
            child.exited,
        ]);
        const match = /^v(\d+)\.(\d+)\.(\d+)$/.exec(output.trim());
        const major = Number(match?.[1]);
        const minor = Number(match?.[2]);
        if (
            code !== 0 ||
            !match ||
            !(major > 22 || (major === 22 && minor >= 19))
        ) {
            throw new Error();
        }
    } catch {
        throw new Error(`pi_node_version: ${node}`);
    }
}

export async function resolvePiRuntime(
    cliDir: string,
    env: Env,
): Promise<PiRuntime> {
    const manifestPath = join(cliDir, "package.json");
    const manifest = await metadata(manifestPath, "pi_dependency_pin");
    if (manifest.dependencies?.[PACKAGE] !== VERSION) {
        throw new Error(`pi_dependency_pin: ${manifestPath}`);
    }
    const packageDir = join(cliDir, "node_modules", PACKAGE);
    const packagePath = join(packageDir, "package.json");
    const installed = await metadata(packagePath, "pi_package_pin");
    if (installed.name !== PACKAGE || installed.version !== VERSION) {
        throw new Error(`pi_package_pin: ${packagePath}`);
    }
    const bin =
        typeof installed.bin === "string" ? installed.bin : installed.bin?.pi;
    if (typeof bin !== "string" || !bin) {
        throw new Error(`pi_binary_missing: ${packagePath}`);
    }
    const link = join(cliDir, "node_modules/.bin/pi");
    const binary = await binaryPath(link);
    if (binary !== (await binaryPath(join(packageDir, bin)))) {
        throw new Error(`pi_binary_mismatch: ${link}`);
    }
    const node = Bun.which("node", { PATH: env.PATH ?? "" });
    if (!node) throw new Error("pi_node_missing");
    await checkNode(node, env);
    return { command: [node, binary], version: VERSION };
}
