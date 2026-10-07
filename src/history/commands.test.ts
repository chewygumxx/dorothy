// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/history/commands.test.ts
//
//

import { afterAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { binaryRepo } from "./binary.js";
import { commandHistory } from "./commands.js";
import { put, removeRoots, TEST_ENV, tempRoot } from "./testing.js";

afterAll(removeRoots);

function capture() {
    let text = "";
    return {
        write: (chunk: string) => {
            text += chunk;
        },
        get text() {
            return text;
        },
    };
}

let home = "";
let env: Record<string, string> = {};
beforeEach(() => {
    home = tempRoot();
    env = { XDG_DATA_HOME: home, XDG_CONFIG_HOME: home, HOME: home };
});

const messages = async () =>
    (await binaryRepo(join(home, "dorothy"), { env: TEST_ENV }).log()).map(
        (commit) => commit.message,
    );

describe("commandHistory", () => {
    it("adopts and sweeps the data directory, and closes", async () => {
        put(home, "dorothy/tags.json", '{"v":1,"rev":1,"concepts":{}}\n');
        const err = capture();
        const handle = await commandHistory({ env, err, hook: null })(null);
        expect(handle).not.toBeNull();
        expect(await messages()).toEqual(["adopt: 2 files"]);
        put(home, "dorothy/tags.json", '{"v":1,"rev":2,"concepts":{}}\n');
        await handle?.sweep();
        expect((await messages())[0]).toBe("outside: tags.json");
        handle?.close();
        expect(err.text).toBe(
            "dorothy: memory has no mirror · dorothy --mirror <url>\n",
        );
    });

    it("is off when the config says so", async () => {
        mkdirSync(join(home, "dorothy"), { recursive: true });
        writeFileSync(
            join(home, "dorothy", "config.toml"),
            "[history]\nenabled = false\n",
        );
        expect(await commandHistory({ env, hook: null })(null)).toBeNull();
    });

    it("says why when history can't be used, and goes on without", async () => {
        // The data directory is a file.
        writeFileSync(join(home, "dorothy"), "");
        const err = capture();
        expect(await commandHistory({ env, err, hook: null })(null)).toBeNull();
        expect(err.text).toStartWith("dorothy: history is off: ");
    });
});
