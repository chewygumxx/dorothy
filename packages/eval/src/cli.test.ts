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
import { runCli } from "./cli.js";
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

    it("names a command it lacks", async () => {
        const { io, err } = fakeIo();
        expect(await runCli(["dance"], io)).toBe(1);
        expect(err.join("")).toContain("eval: no command dance");
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
