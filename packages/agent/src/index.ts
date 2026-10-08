// @dorothy/agent: Dorothy's model side, the only package that talks to
// the Agent SDK. A session, a structured call, her persona's prompts,
// the one-shot reply, and the request capture behind --dump-context.

export { type CaptureQueryFn, dumpRequest } from "./capture.js";
export {
    Conversation,
    conversationOptions,
    type SessionSetup,
} from "./conversation.js";
export { runOneShot } from "./one-shot.js";
export {
    type PersonaMode,
    personaPrompt,
    prepareCliHome,
    promptHash,
    systemPrompt,
} from "./persona.js";
export { structuredCall } from "./structured.js";
