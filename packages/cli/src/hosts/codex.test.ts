// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/codex.test.ts
//
//

import { expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexArgs, runCodex, userInstructions } from "./codex.js";

const self = ["/bin/bun", "--no-env-file", "/d/packages/cli/src/index.ts"];
const flags = (args: string[]) =>
    args.flatMap((arg, i) => (args[i - 1] === "-c" ? [arg] : []));

it("gives Codex her persona, tools and hooks", () => {
    const args = codexArgs({ self, persona: "You are Dorothy,", theirs: null });
    expect(args.slice(0, 2)).toEqual(["--enable", "hooks"]);
    const set = flags(args);
    expect(set).toContain('developer_instructions="You are Dorothy,"');
    expect(set).toContain('mcp_servers.dorothy.command="/bin/bun"');
    expect(set).toContain(
        'mcp_servers.dorothy.args=["--no-env-file","/d/packages/cli/src/index.ts","--mcp","--host","codex"]',
    );
    expect(set).toContain("memories.use_memories=false");
    expect(set).toContain("memories.generate_memories=false");
    const start = set.find((flag) => flag.startsWith("hooks.SessionStart="));
    expect(start).toContain("--hook");
    expect(start).toContain("session-start");
    expect(
        set.find((flag) => flag.startsWith("hooks.UserPromptSubmit=")),
    ).toContain("prompt");
    expect(args).not.toContain("--dangerously-bypass-hook-trust");
});

it("keeps the user's own instructions after hers, quoted", () => {
    const set = flags(
        codexArgs({ self, persona: "Hers.", theirs: 'Say "hi".\nThen go.' }),
    );
    expect(set).toContain(
        `developer_instructions=${JSON.stringify('Hers.\n\nSay "hi".\nThen go.')}`,
    );
});

it("reads the user's instructions, the project's winning, or none", () => {
    const user = 'developer_instructions = "Be brief."\n';
    expect(userInstructions(user, null)).toBe("Be brief.");
    expect(
        userInstructions(user, 'developer_instructions = "Use Rust."\n'),
    ).toBe("Use Rust.");
    expect(userInstructions("[features]\nhooks = true\n", null)).toBeNull();
    expect(userInstructions(null, null)).toBeNull();
    expect(userInstructions("not = [toml", null)).toBeNull();
});

it("tells of hook trust once for each command", async () => {
    const state = await mkdtemp(join(tmpdir(), "codex-state-"));
    const said: string[] = [];
    const deps = {
        env: { PATH: "/bin", HOME: "/tmp/h", XDG_STATE_HOME: state },
        which: () => "/bin/codex",
        readConfigs: async () => [null, null],
        version: () => "0.165.0",
        self,
        persona: "P",
        write: (text: string) => said.push(text),
        spawn: () => ({ exited: Promise.resolve(0), kill: () => {} }),
    };
    await runCodex([], deps);
    await runCodex([], deps);
    expect(said.filter((line) => line.includes("trust")).length).toBe(1);
    await runCodex([], { ...deps, self: [...self.slice(0, 2), "/e/index.ts"] });
    expect(said.filter((line) => line.includes("trust")).length).toBe(2);
});

it("warns of a Codex its profile was not checked against", async () => {
    const said: string[] = [];
    await runCodex([], {
        env: {
            PATH: "/bin",
            HOME: "/tmp/h",
            XDG_STATE_HOME: await mkdtemp(join(tmpdir(), "s-")),
        },
        which: () => "/bin/codex",
        readConfigs: async () => [null, null],
        version: () => "0.999.0",
        self,
        persona: "P",
        write: (text) => said.push(text),
        spawn: () => ({ exited: Promise.resolve(0), kill: () => {} }),
    });
    expect(said.join("")).toContain("0.999.0");
});

it("passes the user's own arguments after hers", async () => {
    const seen: string[][] = [];
    const code = await runCodex(["exec", "hi"], {
        env: {
            PATH: "/bin",
            HOME: "/tmp/h",
            CODEX_HOME: "/tmp/h/codex",
            XDG_STATE_HOME: await mkdtemp(join(tmpdir(), "s-")),
        },
        which: () => "/bin/codex",
        readConfigs: async () => [null, null],
        version: () => "0.165.0",
        self,
        persona: "P",
        write: () => {},
        spawn: (cmd) => {
            seen.push(cmd);
            return { exited: Promise.resolve(0), kill: () => {} };
        },
    });
    expect(code).toBe(0);
    expect(seen[0]?.[0]).toBe("/bin/codex");
    expect(seen[0]?.slice(-2)).toEqual(["exec", "hi"]);
});

it("says when codex is missing", async () => {
    const said: string[] = [];
    const code = await runCodex([], {
        env: { PATH: "" },
        which: () => null,
        write: (text) => said.push(text),
    });
    expect(code).toBe(1);
    expect(said.join("")).toContain("codex");
});
