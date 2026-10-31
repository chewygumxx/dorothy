// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/src/hosts/hermes.test.ts
//
//

import { expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { installHermes, uninstallHermes } from "./hermes.js";

const setup = async () => {
    const home = await mkdtemp(join(tmpdir(), "hermes-"));
    const said: string[] = [];
    const runs: string[][] = [];
    const deps = {
        home,
        self: ["/bin/bun", "--no-env-file", "/d/packages/cli/src/index.ts"],
        persona: "You are Dorothy,",
        write: (text: string) => {
            said.push(text);
        },
        answers: async () => true,
        which: () => "/bin/hermes",
        version: () => "0.22.2",
        // Stands in for `hermes profile create --clone`, which copies the
        // user's SOUL.md and .env as well as config.yaml.
        run: async (cmd: string[]) => {
            runs.push(cmd);
            const dir = join(home, "profiles", "dorothy");
            await mkdir(dir, { recursive: true });
            await writeFile(
                join(dir, "config.yaml"),
                "model:\n  default: m\nmemory:\n  memory_enabled: true\n",
            );
            await writeFile(join(dir, "SOUL.md"), "The user's own persona.\n");
            return 0;
        },
    };
    return {
        home,
        said,
        runs,
        deps,
        profile: join(home, "profiles", "dorothy"),
    };
};

it("makes her profile, persona, plugin and keys", async () => {
    const { runs, deps, profile, said } = await setup();
    expect(await installHermes(deps)).toBe(0);
    expect(runs[0]).toEqual([
        "hermes",
        "profile",
        "create",
        "dorothy",
        "--no-alias",
        "--clone",
    ]);
    expect(await readFile(join(profile, "SOUL.md"), "utf8")).toBe(
        "You are Dorothy,\n",
    );
    const config = parse(await readFile(join(profile, "config.yaml"), "utf8"));
    expect(config.model.default).toBe("m");
    expect(config.memory.provider).toBe("dorothy");
    expect(config.memory.memory_enabled).toBe(false);
    expect(config.memory.user_profile_enabled).toBe(false);
    expect(config.mcp_servers.dorothy.command).toBe("/bin/bun");
    expect(config.mcp_servers.dorothy.args).toEqual([
        "--no-env-file",
        "/d/packages/cli/src/index.ts",
        "--mcp",
        "--host",
        "hermes",
    ]);
    expect(
        JSON.parse(await readFile(join(profile, "dorothy.json"), "utf8"))
            .command,
    ).toEqual(deps.self);
    expect(
        await Bun.file(
            join(profile, "plugins", "dorothy", "__init__.py"),
        ).exists(),
    ).toBe(true);
    expect(said.join("")).toContain("SOUL.md");
});

it("makes a config.yaml where the clone had none", async () => {
    const { deps, profile } = await setup();
    // Hermes clones no config.yaml from a home that has none.
    const run = async () => {
        await mkdir(profile, { recursive: true });
        await writeFile(join(profile, "SOUL.md"), "The user's own.\n");
        return 0;
    };
    expect(await installHermes({ ...deps, run })).toBe(0);
    const config = parse(await readFile(join(profile, "config.yaml"), "utf8"));
    expect(config.memory.provider).toBe("dorothy");
});

it("rewrites only its own on a second run", async () => {
    const { deps, profile, runs } = await setup();
    await installHermes(deps);
    const path = join(profile, "config.yaml");
    await writeFile(
        path,
        `${await readFile(path, "utf8")}display:\n  theme: dark\n`,
    );
    expect(await installHermes(deps)).toBe(0);
    expect(runs).toHaveLength(1);
    expect(parse(await readFile(path, "utf8")).display.theme).toBe("dark");
});

it("rewrites her SOUL.md when her persona changes", async () => {
    const { deps, profile } = await setup();
    await installHermes(deps);
    expect(
        await installHermes({ ...deps, persona: "You are Dorothy, still," }),
    ).toBe(0);
    expect(await readFile(join(profile, "SOUL.md"), "utf8")).toBe(
        "You are Dorothy, still,\n",
    );
});

it("refuses a SOUL.md the user edited, unless forced", async () => {
    const { deps, profile } = await setup();
    await installHermes(deps);
    await writeFile(join(profile, "SOUL.md"), "Edited by the user.\n");
    expect(await installHermes(deps)).toBe(1);
    expect(await installHermes({ ...deps, force: true })).toBe(0);
});

it("refuses a dorothy profile it did not make", async () => {
    const { deps, profile } = await setup();
    await mkdir(profile, { recursive: true });
    await writeFile(join(profile, "config.yaml"), "{}\n");
    await writeFile(join(profile, "SOUL.md"), "Someone else.\n");
    expect(await installHermes(deps)).toBe(1);
    const runs: string[][] = [];
    expect(
        await uninstallHermes({
            ...deps,
            run: async (cmd) => {
                runs.push(cmd);
                return 0;
            },
        }),
    ).toBe(1);
    expect(runs).toEqual([]);
});

it("removes the profile it made", async () => {
    const { deps } = await setup();
    await installHermes(deps);
    const runs: string[][] = [];
    expect(
        await uninstallHermes({
            ...deps,
            run: async (cmd) => {
                runs.push(cmd);
                return 0;
            },
        }),
    ).toBe(0);
    expect(runs[0]).toEqual([
        "hermes",
        "profile",
        "delete",
        "dorothy",
        "--yes",
    ]);
});

it("refuses an entry that cannot answer --hook", async () => {
    const { deps, runs } = await setup();
    expect(await installHermes({ ...deps, answers: async () => false })).toBe(
        1,
    );
    expect(runs).toEqual([]);
});

it("says each key it wrote", async () => {
    const { deps, said, profile } = await setup();
    await installHermes(deps);
    const config = join(profile, "config.yaml");
    for (const key of [
        "memory.provider",
        "memory.memory_enabled",
        "memory.user_profile_enabled",
        "mcp_servers.dorothy",
    ]) {
        expect(said).toContain(`dorothy: wrote ${key} in ${config}\n`);
    }
});

it("keeps a long value of the user's on one line", async () => {
    const { deps, profile } = await setup();
    const long = `${"word ".repeat(40)}end`;
    const run = async (cmd: string[]) => {
        await deps.run(cmd);
        await writeFile(
            join(profile, "config.yaml"),
            `model:\n  note: ${long}\n`,
        );
        return 0;
    };
    expect(await installHermes({ ...deps, run })).toBe(0);
    const text = await readFile(join(profile, "config.yaml"), "utf8");
    expect(text).toContain(`note: ${long}\n`);
});

// Directories and files of the profile, to see that nothing was written.
const listing = (dir: string) =>
    readdir(dir, { recursive: true }).catch(() => []);

for (const [name, config, problem] of [
    ["memory with no value", "memory:\nmodel: m\n", "Expected YAML collection"],
    ["unparseable YAML", "memory: [unclosed\nmodel: {\n", "dorothy:"],
] as const) {
    it(`writes nothing over a config with ${name}`, async () => {
        const { deps, profile, said } = await setup();
        const run = async (cmd: string[]) => {
            await deps.run(cmd);
            await writeFile(join(profile, "config.yaml"), config);
            return 0;
        };
        // Her profile exists, unmarked until an install of hers wrote it.
        await run([]);
        const before = await listing(profile);
        expect(await installHermes({ ...deps, run, force: true })).toBe(1);
        expect(await listing(profile)).toEqual(before);
        expect(await readFile(join(profile, "config.yaml"), "utf8")).toBe(
            config,
        );
        expect(await readFile(join(profile, "SOUL.md"), "utf8")).toBe(
            "The user's own persona.\n",
        );
        expect(said.join("")).toContain(join(profile, "config.yaml"));
        expect(said.join("")).toContain(problem);
    });
}

it("does not make her profile from a home config it cannot merge", async () => {
    const { deps, home, runs, said } = await setup();
    await writeFile(join(home, "config.yaml"), "memory:\n");
    expect(await installHermes(deps)).toBe(1);
    expect(runs).toEqual([]);
    expect(said.join("")).toContain(join(home, "config.yaml"));
});

it("says hermes is missing and exits 1", async () => {
    const { deps, runs, said, home } = await setup();
    const none = { ...deps, which: () => null };
    expect(await installHermes(none)).toBe(1);
    expect(await uninstallHermes(none)).toBe(1);
    expect(runs).toEqual([]);
    expect(said.join("")).toContain("hermes is not on PATH");
    expect(await listing(home)).toEqual([]);
});

it("warns of a Hermes her profile was not checked against", async () => {
    const { deps, said } = await setup();
    expect(await installHermes({ ...deps, version: () => "9.9.9" })).toBe(0);
    expect(said.join("")).toContain(
        "Hermes 9.9.9 is not one her profile was checked against (0.22.2)",
    );
    said.length = 0;
    await installHermes(deps);
    expect(said.join("")).not.toContain("checked against");
});
