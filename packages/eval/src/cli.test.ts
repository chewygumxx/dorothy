// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/cli.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import { COMMANDS, runCli } from "./cli.js";
import { fakeIo, tempRoot, writeFixtureData } from "./testing.js";

let temp: ReturnType<typeof tempRoot>;
beforeEach(() => {
    temp = tempRoot("cli");
});
afterEach(() => temp.remove());

describe("bun run eval", () => {
    it("gives its usage, and fails, with no command", async () => {
        const { io, err } = fakeIo();
        expect(await runCli([], io)).toBe(1);
        expect(err.join("")).toContain("Usage: bun run eval -- <command>");
        expect(err.join("")).toContain("snapshot");
    });

    it("gives its usage on --help, and succeeds", async () => {
        const { io, out } = fakeIo();
        expect(await runCli(["--help"], io)).toBe(0);
        expect(out.join("")).toContain("Usage:");
    });

    it("gives its usage on help, and succeeds", async () => {
        const { io, out } = fakeIo();
        expect(await runCli(["help"], io)).toBe(0);
        expect(out.join("")).toContain("Usage: bun run eval -- <command>");
        expect(out.join("")).toContain("compare");
    });

    it("gives a command's usage and options on --help", async () => {
        const { io, out, err } = fakeIo();
        expect(await runCli(["run", "--help"], io)).toBe(0);
        const text = out.join("");
        expect(text).toStartWith("Usage: bun run eval -- run [options]\n");
        expect(text).toContain("ask the accepted questions");
        expect(text).toMatch(/\n {2}--work <value> +the evaluation's /);
        expect(text).toMatch(/\n {2}--dry-run +count the model calls/);
        expect(text).toContain("--max-calls <value>");
        expect(err).toEqual([]);
    });

    it("gives a command's usage on help <command>, with its arguments", async () => {
        const { io, out } = fakeIo();
        expect(await runCli(["help", "compare"], io)).toBe(0);
        expect(out.join("")).toStartWith(
            "Usage: bun run eval -- compare [options] <run> <run>\n",
        );
        const { io: other, out: more } = fakeIo();
        expect(await runCli(["generate", "--work", "w", "--help"], other)).toBe(
            0,
        );
        expect(more.join("")).toMatch(/--type <value> +.*repeat/);
    });

    it("takes --help as an option's value for no help", async () => {
        const { io, out, err } = fakeIo();
        expect(await runCli(["run", "--work", "--help"], io)).toBe(1);
        expect(out).toEqual([]);
        expect(err.join("")).toStartWith("eval: ");
        expect(err.join("")).toContain("--work");
        const asked = fakeIo();
        expect(await runCli(["help", "--help"], asked.io)).toBe(0);
        expect(asked.out.join("")).toContain("Commands:");
    });

    it("describes every option of every command", () => {
        for (const [name, command] of Object.entries(COMMANDS)) {
            for (const [option, spec] of Object.entries(command.options)) {
                expect([name, option, typeof spec.description]).toEqual([
                    name,
                    option,
                    "string",
                ]);
                expect(spec.description.trim()).not.toBe("");
            }
        }
    });

    it("names a command it lacks", async () => {
        const { io, err } = fakeIo();
        expect(await runCli(["dance"], io)).toBe(1);
        expect(err.join("")).toContain("eval: no command dance");
    });

    it("takes an inherited key for no command", async () => {
        for (const name of ["constructor", "toString", "__proto__"]) {
            const { io, err } = fakeIo();
            expect(await runCli([name], io)).toBe(1);
            expect(err.join("")).toContain(`eval: no command ${name}`);
            const helped = fakeIo();
            expect(await runCli(["help", name], helped.io)).toBe(1);
            expect(helped.err.join("")).toContain(`no command ${name}`);
        }
        const { io, err } = fakeIo();
        expect(await runCli(["run", "--constructor"], io)).toBe(1);
        expect(err.join("")).toContain("--constructor");
    });

    it("names an option a command lacks", async () => {
        const { io, err } = fakeIo();
        expect(await runCli(["snapshot", "--frm", "x"], io)).toBe(1);
        expect(err.join("")).toStartWith("eval: ");
        expect(err.join("")).toContain("--frm");
    });

    it("asks for --from and --work", async () => {
        const { io, err } = fakeIo();
        expect(await runCli(["snapshot", "--work", "w"], io)).toBe(1);
        expect(err.join("")).toContain("give --from");
        expect(await runCli(["snapshot", "--from", "d"], io)).toBe(1);
        expect(err.join("")).toContain("give --work");
    });

    it("takes a snapshot", async () => {
        const data = await writeFixtureData(temp.root);
        const { io, out } = fakeIo();
        const work = join(temp.root, "work");
        expect(
            await runCli(["snapshot", "--from", data, "--work", work], io),
        ).toBe(0);
        expect(out.join("")).toBe(
            `copied 4 conversations and 3 knowledge files from ${data}\n`,
        );
    });
});
