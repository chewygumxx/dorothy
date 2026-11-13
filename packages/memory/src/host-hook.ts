// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/memory/src/host-hook.ts
//
//

// @dorothy/memory/host-hook: dorothy --hook, which Codex's hooks and her
// Hermes provider run, and dorothy --pi-hook, which her Pi extension
// runs, loading the client and the project finder, and the Pi source only
// when the Pi hook runs.

export {
    HOOK_EVENTS,
    type HookEvent,
    type HookInput,
    PI_HOOK_EVENTS,
    parseHookInput,
} from "./hooks/payload.js";

import type { PiHookDeps, PiHookReply } from "./hooks/pi.js";

export type { PiHookDeps, PiHookReply, PiHookRequest } from "./hooks/pi.js";

// The Pi hook, loaded when it runs: Codex's and Hermes's hooks share this
// entry point and need neither the Pi reader nor what it reads with.
export async function runPiHostHook(
    input: unknown,
    deps: PiHookDeps,
): Promise<PiHookReply> {
    return (await import("./hooks/pi.js")).runPiHostHook(input, deps);
}
export { type HostHookDeps, runHostHook } from "./hooks/run.js";
// For her install, which names the root a profile's HERMES_HOME is in.
export { hermesRoot } from "./hosts/hermes-root.js";
// For her Pi launcher, which keeps a named session file inside it.
export { piSessionRoot } from "./hosts/pi-root.js";
// For the CLI's test that its hosts' profiles take hooks or a plugin.
export { loadProfiles } from "./hosts/profiles.js";
export { type PiRead, readPi } from "./recording/pi.js";
