// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/bodies/fixtures.ts
//
//

// Claude Code's transcript lines as the recording probe found them, for
// the reader's and the hook's tests. Only the keys the reader looks at,
// and the ones that tell a line apart, are filled.

export const SESSION = "0f8fad5b-d9cb-469f-a165-70867728950e";
export const at = (minute: number) =>
    new Date(Date.UTC(2026, 9, 15, 9, minute)).toISOString();

type Fields = Record<string, unknown>;
const base = (type: string, uuid: string, minute: number, fields: Fields) =>
    JSON.stringify({
        type,
        uuid,
        parentUuid: null,
        isSidechain: false,
        sessionId: SESSION,
        timestamp: at(minute),
        cwd: "/work",
        version: "2.1.300",
        ...fields,
    });

export const text = (words: string) => ({ type: "text", text: words });
export const use = (id: string, name: string, input: unknown = {}) => ({
    type: "tool_use",
    id,
    name,
    input,
});
export const result = (id: string, content: unknown, isError = false) => ({
    type: "tool_result",
    tool_use_id: id,
    content,
    ...(isError ? { is_error: true } : {}),
});

export const userLine = (
    uuid: string,
    minute: number,
    content: unknown,
    fields: Fields = {},
) =>
    base("user", uuid, minute, {
        message: { role: "user", content },
        ...fields,
    });

export const assistantLine = (
    uuid: string,
    minute: number,
    content: unknown[],
    fields: Fields = {},
) =>
    base("assistant", uuid, minute, {
        message: { role: "assistant", model: "claude-opus-5-5", content },
        ...fields,
    });

export const queued = (
    uuid: string,
    minute: number,
    prompt: unknown,
    // null leaves commandMode out, as an older Claude Code did.
    mode: string | null = "prompt",
) =>
    base("attachment", uuid, minute, {
        attachment: {
            type: "queued_command",
            prompt,
            ...(mode === null ? {} : { commandMode: mode }),
        },
    });

// A bookkeeping line, as most of Claude Code's are: a type, no uuid.
export const meta = (type: string, fields: Fields = {}) =>
    JSON.stringify({ type, sessionId: SESSION, ...fields });
