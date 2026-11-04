// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/workspace.test.ts
//
//

// The workspace's shape, as the spec agreed it. The isolated linker
// enforces whatever the manifests declare; this keeps the manifests
// from drifting.

import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

type Manifest = {
    name: string;
    exports?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
};

const PACKAGES = join(import.meta.dir, "packages");

const GRAPH: Record<string, string[]> = {
    agent: ["core", "identity"],
    cli: ["agent", "core", "gateway", "identity", "memory", "tui"],
    core: [],
    eval: ["core", "memory"],
    gateway: ["core", "identity"],
    identity: [],
    memory: ["core"],
    tui: ["core"],
};

const ENTRIES: Record<string, string[]> = {
    agent: ["."],
    cli: [],
    core: ["."],
    eval: [],
    gateway: ["."],
    identity: ["."],
    memory: [
        ".",
        "./bridge",
        "./claude-hook",
        "./client",
        "./commands",
        "./evaluation",
        "./host-hook",
        "./recall-server",
        "./service",
    ],
    tui: [".", "./editor"],
};

// The Agent SDK, which nothing may declare now, and the AI SDK's
// packages, which only the agent may.
const AGENT_SDK = "@anthropic-ai/claude-agent-sdk";
const AI_SDK = /^(ai|@ai-sdk\/.+|@openrouter\/.+)$/;
const PI = /^@earendil-works\/pi-.+$/;

const manifest = async (name: string): Promise<Manifest> =>
    Bun.file(join(PACKAGES, name, "package.json")).json();

const declared = (of: Manifest) => ({
    ...of.dependencies,
    ...of.devDependencies,
});

describe("the workspace", () => {
    it("holds exactly the agreed packages", () => {
        expect(readdirSync(PACKAGES).sort()).toEqual(Object.keys(GRAPH));
    });

    for (const name of Object.keys(GRAPH)) {
        it(`names ${name} @dorothy/${name}`, async () => {
            expect((await manifest(name)).name).toBe(`@dorothy/${name}`);
        });

        it(`gives ${name} its agreed packages`, async () => {
            const packages = Object.keys(declared(await manifest(name)))
                .filter((dependency) => dependency.startsWith("@dorothy/"))
                .map((dependency) => dependency.slice("@dorothy/".length))
                .sort();
            expect(packages).toEqual(GRAPH[name] as string[]);
        });

        it(`gives ${name} its agreed entry points`, async () => {
            const exports = (await manifest(name)).exports ?? {};
            expect(Object.keys(exports).sort()).toEqual(
                ENTRIES[name] as string[],
            );
            for (const target of Object.values(exports)) {
                expect(target).toEndWith(".ts");
                expect(existsSync(join(PACKAGES, name, target))).toBe(true);
            }
        });
    }

    it("declares the Agent SDK nowhere", async () => {
        const holders: string[] = [];
        for (const name of Object.keys(GRAPH)) {
            if (AGENT_SDK in declared(await manifest(name))) {
                holders.push(name);
            }
        }
        expect(holders).toEqual([]);
    });

    it("leaves the AI SDK to the agent", async () => {
        const holders: string[] = [];
        for (const name of Object.keys(GRAPH)) {
            if (
                Object.keys(declared(await manifest(name))).some((dependency) =>
                    AI_SDK.test(dependency),
                )
            ) {
                holders.push(name);
            }
        }
        expect(holders).toEqual(["agent"]);
    });

    it("leaves Pi packages to the CLI, with the runtime pinned", async () => {
        const holders: string[] = [];
        for (const name of Object.keys(GRAPH)) {
            if (
                Object.keys(declared(await manifest(name))).some((key) =>
                    PI.test(key),
                )
            ) {
                holders.push(name);
            }
        }
        expect(holders).toEqual(["cli"]);
        expect(
            (await manifest("cli")).dependencies?.[
                "@earendil-works/pi-coding-agent"
            ],
        ).toBe("1.5.0");
        expect(
            Object.keys(
                declared(
                    await Bun.file(
                        join(import.meta.dir, "package.json"),
                    ).json(),
                ),
            ).some((key) => PI.test(key)),
        ).toBe(false);
    });

    it("lints an import of what a package does not declare", async () => {
        const biome = await Bun.file(
            join(import.meta.dir, ".biome.json"),
        ).json();
        expect(biome.linter.rules.correctness.noUndeclaredDependencies).toBe(
            "error",
        );
    });

    it("resolves only what a package declares, and only its doors", () => {
        const from = (name: string) => join(PACKAGES, name, "src");
        expect(() =>
            Bun.resolveSync("@dorothy/core", from("memory")),
        ).not.toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/memory/commands", from("cli")),
        ).not.toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/agent", from("memory")),
        ).toThrow();
        expect(() => Bun.resolveSync("ai", from("memory"))).toThrow();
        expect(() => Bun.resolveSync("ai", from("tui"))).toThrow();
        expect(() => Bun.resolveSync("ai", from("agent"))).not.toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/tui/editor", from("cli")),
        ).not.toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/memory/src/memory/open.ts", from("cli")),
        ).toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/cli/src/run-tui.ts", from("memory")),
        ).toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/identity", from("agent")),
        ).not.toThrow();
        expect(() => Bun.resolveSync("ai", from("identity"))).toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/core", from("identity")),
        ).toThrow();
        expect(() => Bun.resolveSync("ai", from("gateway"))).toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/agent", from("gateway")),
        ).toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/memory/evaluation", from("eval")),
        ).not.toThrow();
        expect(() => Bun.resolveSync("@dorothy/agent", from("eval"))).toThrow();
    });
});
