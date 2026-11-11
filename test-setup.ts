// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/test-setup.ts
//
//

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Preloaded by `bun test` (bunfig.toml) before any test file imports Ink.
// Chalk reads FORCE_COLOR once, at import, and a shell that sets it would
// otherwise wrap every rendered frame the tests compare in ANSI codes.
process.env.FORCE_COLOR = "0";

// The recall index lives in the cache directory; no test may touch the
// user's.
process.env.XDG_CACHE_HOME = mkdtempSync(join(tmpdir(), "dorothy-cache-"));

// Recording keeps unread lines and notices in the state directory and
// notes launches in the runtime directory; no test may touch the
// user's.
process.env.XDG_STATE_HOME = mkdtempSync(join(tmpdir(), "dorothy-state-"));
process.env.XDG_RUNTIME_DIR = mkdtempSync(join(tmpdir(), "dorothy-run-"));

// A pre-commit hook runs the tests with git's variables set, and a test
// that runs git in a scratch repository would otherwise write the real
// index.
for (const name of Object.keys(process.env)) {
    if (name.startsWith("GIT_")) delete process.env[name];
}

// Bun.spawn and Bun.spawnSync hand a child the environment the process
// started with, not process.env as the loop above left it, unless given
// an env; node:child_process and Bun's shell already read process.env.
type Spawn = (command: never, options?: never) => unknown;
const inheritingEnv = (spawn: Spawn): Spawn =>
    ((command: unknown, options?: Record<string, unknown>) => {
        if (Array.isArray(command)) {
            const env = options?.env ?? process.env;
            return spawn(command as never, { ...options, env } as never);
        }
        const given = command as { env?: unknown };
        const env = given.env ?? process.env;
        return spawn({ ...given, env } as never);
    }) as Spawn;
Bun.spawn = inheritingEnv(Bun.spawn as Spawn) as unknown as typeof Bun.spawn;
Bun.spawnSync = inheritingEnv(
    Bun.spawnSync as Spawn,
) as unknown as typeof Bun.spawnSync;
