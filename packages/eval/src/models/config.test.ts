// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/config.test.ts
//
//

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { writeFileSync } from "node:fs";
import { tempRoot } from "../testing.js";
import { configPath, readEvalConfig, requireRole, vendorOf } from "./config.js";

let temp: ReturnType<typeof tempRoot>;
beforeEach(() => {
    temp = tempRoot("config");
});
afterEach(() => temp.remove());

const write = (text: string) => writeFileSync(configPath(temp.root), text);

describe("eval.toml", () => {
    it("names no role when it is missing", async () => {
        expect(await readEvalConfig(temp.root)).toEqual({
            generate: null,
            answer: null,
            judge: null,
        });
    });

    it("reads each role", async () => {
        write(
            '[models.answer]\nbase-url = "https://openrouter.ai/api/v1"\nmodel = "openai/gpt-oss-120b"\nkey = "OPENROUTER_API_KEY"\n\n[models.judge]\nbase-url = "http://127.0.0.1:8080/v1"\nmodel = "local"\n',
        );
        expect(await readEvalConfig(temp.root)).toEqual({
            generate: null,
            answer: {
                baseUrl: "https://openrouter.ai/api/v1",
                model: "openai/gpt-oss-120b",
                key: "OPENROUTER_API_KEY",
            },
            judge: {
                baseUrl: "http://127.0.0.1:8080/v1",
                model: "local",
                key: null,
            },
        });
    });

    it("refuses a role it does not know", async () => {
        write('[models.critic]\nbase-url = "http://x"\nmodel = "m"\n');
        await expect(readEvalConfig(temp.root)).rejects.toThrow(
            "no role critic; the roles are generate, answer, judge",
        );
    });

    it("refuses a key in place of a variable's name, never repeating it", async () => {
        write(
            '[models.answer]\nbase-url = "http://x"\nmodel = "m"\nkey = "sk-or-v1-0123456789abcdef"\n',
        );
        const error = await readEvalConfig(temp.root).catch(
            (caught: Error) => caught,
        );
        expect(String(error)).toContain("key names a variable");
        expect(String(error)).not.toContain("0123456789abcdef");
    });

    it("refuses a base-url that is no http URL, and a setting it lacks", async () => {
        write('[models.answer]\nbase-url = "openrouter"\nmodel = "m"\n');
        await expect(readEvalConfig(temp.root)).rejects.toThrow(
            "needs base-url",
        );
        write(
            '[models.answer]\nbase-url = "http://x"\nmodel = "m"\ntemperature = 0\n',
        );
        await expect(readEvalConfig(temp.root)).rejects.toThrow(
            "has no setting temperature",
        );
    });

    it("says where to add a role a command needs", () => {
        expect(() =>
            requireRole({ generate: null, answer: null, judge: null }, "judge"),
        ).toThrow("eval.toml has no [models.judge]");
    });
});

describe("a model's vendor", () => {
    it("is the id's prefix, or its first word", () => {
        expect(vendorOf("openai/gpt-oss-120b")).toBe("openai");
        expect(vendorOf("gpt-4o")).toBe("gpt");
        expect(vendorOf("local")).toBe("local");
    });
});
