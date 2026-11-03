// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/host-hook.ts
//
//

// @dorothy/memory/host-hook: dorothy --hook, which Codex's hooks and her
// Hermes provider run, and dorothy --pi-hook, which her Pi extension
// runs, loading the client, the project finder and the Pi source alone.

export {
    HOOK_EVENTS,
    type HookEvent,
    type HookInput,
    parseHookInput,
} from "./hooks/payload.js";
export {
    PI_HOOK_EVENTS,
    type PiHookDeps,
    type PiHookReply,
    type PiHookRequest,
    runPiHostHook,
} from "./hooks/pi.js";
export { type HostHookDeps, runHostHook } from "./hooks/run.js";
// For her install, which names the root a profile's HERMES_HOME is in.
export { hermesRoot } from "./hosts/hermes-root.js";
// For her Pi launcher, which keeps a named session file inside it.
export { piSessionRoot } from "./hosts/pi-root.js";
// For the CLI's test that its hosts' profiles take hooks or a plugin.
export { loadProfiles } from "./hosts/profiles.js";
export { type PiRead, readPi } from "./recording/pi.js";
