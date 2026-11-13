// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/memory/src/recording/pi-fixtures.ts
//
//

// Synthetic Pi v3 session lines in the shapes of the installed
// @earendil-works/pi-coding-agent 1.5.0: docs/session-format.md,
// docs/message-types.md and dist/core/session-manager.d.ts, inspected
// read-only on 2026-11-04. No value comes from a user's session.
export const PI_SESSION = "11111111-2222-4333-8444-555555555555";
export const PI_FORK = "66666666-7777-4888-8999-aaaaaaaaaaaa";
export const PARENT_PATH = "/fixture/sessions/parent.jsonl";

export const piAt = (second: number) =>
    new Date(Date.UTC(2026, 10, 3, 9, 0, second)).toISOString();
const ms = (second: number) => Date.parse(piAt(second));

export const header = (
    id = PI_SESSION,
    parentSession?: string,
    version: unknown = 3,
    cwd = "/fixture/project",
) =>
    JSON.stringify({
        type: "session",
        version,
        id,
        timestamp: piAt(0),
        cwd,
        ...(parentSession === undefined ? {} : { parentSession }),
    });

// SessionEntryBase: type, id, parentId, timestamp, then the entry's fields.
export const entry = (
    type: string,
    id: string,
    parentId: string | null,
    fields: Record<string, unknown> = {},
    second = 1,
) => JSON.stringify({ type, id, parentId, timestamp: piAt(second), ...fields });
const message = (
    id: string,
    parentId: string | null,
    body: Record<string, unknown>,
    second: number,
) =>
    entry(
        "message",
        id,
        parentId,
        { message: { ...body, timestamp: ms(second) } },
        second,
    );

export const text = (value: string) => ({ type: "text", text: value });
export const image = {
    type: "image",
    data: "c3ludGhldGlj",
    mimeType: "image/png",
};
export const thinking = (value: string) => ({
    type: "thinking",
    thinking: value,
    thinkingSignature: "synthetic-signature",
});
export const toolCall = (
    id: string,
    name: string,
    args: Record<string, unknown> = {},
) => ({ type: "toolCall", id, name, arguments: args });

const usage = {
    input: 1,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 3,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export const system = (id: string, parentId: string | null, second = 1) =>
    message(
        id,
        parentId,
        {
            role: "system",
            content: "",
            sections: { preamble: "Synthetic system prompt." },
            toolsAdded: [{ name: "read", description: "", parameters: {} }],
        },
        second,
    );
export const user = (
    id: string,
    parentId: string | null,
    content: unknown,
    second = 1,
) => message(id, parentId, { role: "user", content }, second);
export const assistant = (
    id: string,
    parentId: string | null,
    content: unknown[],
    second = 2,
    stopReason = "stop",
) =>
    message(
        id,
        parentId,
        {
            role: "assistant",
            content,
            api: "fixture-api",
            provider: "fixture-provider",
            model: "fixture-model",
            usage,
            stopReason,
        },
        second,
    );
export const toolResult = (
    id: string,
    parentId: string | null,
    toolCallId: string,
    toolName: string,
    content: unknown[],
    second = 3,
    isError = false,
) =>
    message(
        id,
        parentId,
        { role: "toolResult", toolCallId, toolName, content, isError },
        second,
    );
export const bashExecution = (
    id: string,
    parentId: string | null,
    command: string,
    output: string,
    exitCode: number | undefined,
    second = 1,
) =>
    message(
        id,
        parentId,
        {
            role: "bashExecution",
            command,
            output,
            exitCode,
            cancelled: false,
            truncated: false,
        },
        second,
    );
export const customRole = (id: string, parentId: string | null) =>
    message(
        id,
        parentId,
        {
            role: "custom",
            customType: "fixture-extension",
            content: "Synthetic extension context.",
            display: false,
        },
        1,
    );

// Entries that carry no speech, each with synthetic fields.
export const modelChange = (id: string, parentId: string | null) =>
    entry("model_change", id, parentId, {
        provider: "fixture-provider",
        modelId: "fixture-other",
    });
export const thinkingLevel = (id: string, parentId: string | null) =>
    entry("thinking_level_change", id, parentId, { thinkingLevel: "high" });
export const usageEntry = (id: string, parentId: string | null) =>
    entry("usage", id, parentId, {
        kind: "cache_warm",
        provider: "fixture-provider",
        model: "fixture-model",
        usage,
    });
export const compaction = (
    id: string,
    parentId: string | null,
    firstKeptEntryId: string,
) =>
    entry("compaction", id, parentId, {
        summary: "Synthetic compaction summary.",
        firstKeptEntryId,
        tokensBefore: 1000,
        systemMessage: {
            role: "system",
            content: "Synthetic checkpoint.",
            toolsAdded: [],
            timestamp: ms(1),
        },
    });
export const branchSummary = (
    id: string,
    parentId: string | null,
    fromId: string,
) =>
    entry("branch_summary", id, parentId, {
        fromId,
        summary: "Synthetic branch summary.",
    });
export const custom = (id: string, parentId: string | null) =>
    entry("custom", id, parentId, {
        customType: "fixture-extension",
        data: { count: 1 },
    });
// The result Dorothy's extension saw for a call Pi wrote none for, as
// assets/pi/context.ts appends it: the call's entry and id, and content.
export const toolFinal = (
    id: string,
    parentId: string | null,
    entryId: string,
    toolCallId: string,
    content: unknown[],
    isError = false,
    second = 4,
) =>
    entry(
        "custom",
        id,
        parentId,
        {
            customType: "dorothy.tool-final",
            data: { entryId, toolCallId, content, isError },
        },
        second,
    );
export const customMessage = (id: string, parentId: string | null) =>
    entry("custom_message", id, parentId, {
        customType: "fixture-extension",
        content: "Synthetic injected memory.",
        display: true,
    });
export const contextEdit = (
    id: string,
    parentId: string | null,
    targetId: string,
) =>
    entry("context_edit", id, parentId, {
        targetId,
        replacement: { content: "Synthetic replacement." },
    });
export const label = (id: string, parentId: string | null, targetId: string) =>
    entry("label", id, parentId, { targetId, label: "fixture-mark" });
export const sessionInfo = (id: string, parentId: string | null) =>
    entry("session_info", id, parentId, { name: "Synthetic name" });

// A session and a fork of it as createBranchedSession writes one, its
// header naming the parent's file: for the source, the sweep and hooks.
export const PARENT_LINES = [
    header(),
    user("user0001", null, "Synthetic parent question.", 1),
    assistant("asst0001", "user0001", [text("Synthetic parent answer.")], 2),
];
export const forkLines = (parentPath: string, id = PI_FORK) => [
    header(id, parentPath),
    ...PARENT_LINES.slice(1),
    user("user0002", "asst0001", "Synthetic fork question.", 3),
    assistant("asst0002", "user0002", [text("Synthetic fork answer.")], 4),
];
export const piText = (lines: readonly string[]) => `${lines.join("\n")}\n`;

// A session as Pi 1.5.0 writes one in its own terminal (the CLI's native
// run in wire.test.ts): model, thinking and system entries first, a call
// the person interrupted (Pi's own failed result, then an empty errored
// reply), and a split-turn compaction keeping the last reply. A fork
// from past it copies the path verbatim, compaction and ids alike.
export const COMPACTED_LINES = [
    header(),
    modelChange("modl0001", null),
    thinkingLevel("thnk0001", "modl0001"),
    system("syst0001", "thnk0001"),
    user("user0001", "syst0001", [text("Synthetic slow request.")], 1),
    assistant(
        "asst0001",
        "user0001",
        [toolCall("call0001", "bash", { command: "sleep 30" })],
        2,
        "toolUse",
    ),
    toolResult(
        "tool0001",
        "asst0001",
        "call0001",
        "bash",
        [text("Command aborted")],
        3,
        true,
    ),
    assistant("asst0002", "tool0001", [], 4, "error"),
    user("user0002", "asst0002", [text("Synthetic second request.")], 5),
    assistant("asst0003", "user0002", [text("Synthetic second answer.")], 6),
    compaction("comp0001", "asst0003", "asst0003"),
    user("user0003", "comp0001", [text("Synthetic third request.")], 7),
    assistant("asst0004", "user0003", [text("Synthetic third answer.")], 8),
];
export const compactedForkLines = (parentPath: string) => [
    header(PI_FORK, parentPath),
    ...COMPACTED_LINES.slice(1, 11),
    user("user0004", "comp0001", [text("Synthetic forked request.")], 9),
    assistant("asst0005", "user0004", [text("Synthetic forked answer.")], 10),
];
