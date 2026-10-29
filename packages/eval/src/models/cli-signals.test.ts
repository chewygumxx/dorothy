// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/eval/src/models/cli-signals.test.ts
//
//

import { expect, it } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempRoot } from "../testing.js";

it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGHUP", 129],
] as const)(
    "stops all CLI groups and removes private dirs on %s",
    async (signal, code) => {
        const temp = tempRoot("cli-signals");
        const records = () =>
            ["claude", "codex"].flatMap((route) => {
                const path = join(temp.root, `${route}.pid`);
                return existsSync(path)
                    ? [readFileSync(path, "utf8").trim().split(" ")]
                    : [];
            });
        for (const route of ["claude", "codex"]) {
            writeFileSync(
                join(temp.root, route),
                `#!/bin/sh
trap 'wait "$grandchild"; exit 0' TERM
sleep 30 &
grandchild=$!
printf '%s %s %s\\n' "$$" "$grandchild" "$PWD" > "$HOME/${route}.pid"
wait
`,
                { mode: 0o700 },
            );
        }
        const harness = join(temp.root, "harness.ts");
        writeFileSync(
            harness,
            `import { cliAttempt } from ${JSON.stringify(join(import.meta.dir, "cli.ts"))};
const options = { env: { PATH: ${JSON.stringify(`${temp.root}:/usr/bin:/bin`)}, HOME: ${JSON.stringify(temp.root)}, CLAUDE_CODE_OAUTH_TOKEN: "fixture" } };
await Promise.all([
    cliAttempt({ via: "claude", model: "fixture" }, [{ role: "system", content: "Private system" }], undefined, options),
    cliAttempt({ via: "codex", model: "fixture", effort: "medium" }, [{ role: "user", content: "Private snapshot" }], { type: "object" }, options),
]).catch(() => {});
`,
        );
        const child = Bun.spawn([process.execPath, "--no-env-file", harness], {
            env: { PATH: "/usr/bin:/bin", HOME: temp.root },
            stdout: "ignore",
            stderr: "ignore",
        });
        let watchdog: ReturnType<typeof setTimeout> | undefined;
        try {
            for (let n = 0; n < 200 && records().length < 2; n++)
                await Bun.sleep(10);
            expect(records()).toHaveLength(2);
            child.kill(signal);
            const status = await Promise.race([
                child.exited,
                new Promise<null>((resolve) => {
                    watchdog = setTimeout(() => resolve(null), 2000);
                }),
            ]);
            expect(status).toBe(code);
            for (const [, grandchild, directory] of records()) {
                expect(() => process.kill(Number(grandchild), 0)).toThrow();
                expect(existsSync(directory as string)).toBe(false);
            }
        } finally {
            clearTimeout(watchdog);
            child.kill("SIGKILL");
            await child.exited;
            for (const [parent, grandchild, directory] of records()) {
                for (const pid of [grandchild, parent]) {
                    try {
                        process.kill(Number(pid), "SIGTERM");
                    } catch {
                        /* Gone. */
                    }
                }
                await Bun.sleep(20);
                for (const pid of [grandchild, parent]) {
                    try {
                        process.kill(Number(pid), "SIGKILL");
                    } catch {
                        /* Gone. */
                    }
                }
                if (directory?.startsWith("/tmp/dorothy-eval-model-"))
                    rmSync(directory, { recursive: true, force: true });
            }
            temp.remove();
        }
    },
    5000,
);
