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
    agent: ["core"],
    cli: ["agent", "core", "memory", "tui"],
    core: [],
    memory: ["core"],
    tui: ["core"],
};

const ENTRIES: Record<string, string[]> = {
    agent: ["."],
    cli: [],
    core: ["."],
    memory: [".", "./commands", "./recall-server"],
    tui: ["."],
};

const SDK = "@anthropic-ai/claude-agent-sdk";

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

    it("leaves the Agent SDK to the agent", async () => {
        const holders: string[] = [];
        for (const name of Object.keys(GRAPH)) {
            if (SDK in declared(await manifest(name))) {
                holders.push(name);
            }
        }
        expect(holders).toEqual(["agent"]);
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
        expect(() => Bun.resolveSync(SDK, from("memory"))).toThrow();
        expect(() => Bun.resolveSync(SDK, from("tui"))).toThrow();
        expect(() =>
            Bun.resolveSync("@dorothy/memory/src/memory/open.ts", from("cli")),
        ).toThrow();
    });
});
