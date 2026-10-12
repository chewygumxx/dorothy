// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/agent-memory.ts
//
//

// Points Claude Code's auto memory at .agents/memory/. The setting must be
// absolute, so it can live only in the gitignored settings.local.json;
// `prepare` runs this on every install, from the checkout's own path, so
// no one sets it by hand.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Settings = Record<string, unknown>;

// The settings with auto memory pointed at the checkout's .agents/memory/,
// every other setting left as it was.
export const withMemoryDirectory = (
    settings: Settings,
    root: string,
): Settings => ({
    ...settings,
    autoMemoryDirectory: join(root, ".agents", "memory"),
});

if (import.meta.main) {
    const root = join(import.meta.dir, "..");
    const path = join(root, ".claude", "settings.local.json");
    const settings: Settings = existsSync(path)
        ? JSON.parse(readFileSync(path, "utf8"))
        : {};
    const next = withMemoryDirectory(settings, root);
    if (next.autoMemoryDirectory !== settings.autoMemoryDirectory) {
        writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
    }
}
