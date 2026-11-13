// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/agent/src/index.ts
//
//

// @dorothy/agent: Dorothy's model side, the only package that talks to
// a model provider's SDK: a session, a structured call, her persona's
// prompts, the one-shot reply, and the request capture behind
// --dump-context.

export { captureServer, DUMP_KEY, dumpRequest } from "./capture.js";
export {
    Conversation,
    type ConversationDeps,
    type ConversationSetup,
    conversationSetup,
    MAX_STEPS,
    type SessionSetup,
} from "./conversation.js";
export { type OneShotDeps, runOneShot } from "./one-shot.js";
export {
    type PersonaMode,
    personaPrompt,
    promptHash,
    routeLine,
    systemPrompt,
} from "./persona.js";
export {
    type ConnectRecall,
    connectRecall,
    type RecallTools,
    recallEnv,
} from "./recall-tools.js";
export { structuredCall } from "./structured.js";
