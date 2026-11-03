// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/cli/assets/pi/context.ts
//
//

// Dorothy's memory in a Pi session, through `dorothy --pi-hook`: the
// opening block at a session's start, replacement, compaction or tree
// move, recall before each human prompt, and the notices that let memory
// record the saved file, after each settled run and at shutdown.
//
// - The memory layer is one extension-authored message, placed before the
//   latest human prompt on every model request and never saved: a newer
//   block or recall supersedes it, and a saved copy is dropped, so a
//   request carries exactly one and nothing of it reads as speech.
// - Each request names the live cwd and session, so a resumed session in
//   another project is asked for in that project; Pi builds a new instance
//   for each runtime, and nothing of the former session's layer survives.
// - Calls are bounded: 2500 ms for context, 5000 ms for records, the
//   helper killed past either. A fault leaves no layer, a warning shown
//   once by code, and the JSONL for the sweep to catch up.
// - A call Pi finalized (tool_execution_end) without saving its result
//   gets a `dorothy.tool-final` entry naming its saved assistant entry, the
//   call's id and the result, which memory's reader uses only where no
//   ordinary result exists. A call whose entry is not saved yet waits;
//   nested calls, never in the transcript, are left out.

import type {
    ContextEvent,
    ExtensionAPI,
    ExtensionContext,
    SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import {
    failed,
    type InvokeHook,
    type PiHookReply,
    type PiHookRequest,
} from "./helper.js";

export const MEMORY_LAYER = "dorothy.memory";
export const TOOL_FINAL = "dorothy.tool-final";
export const CONTEXT_MS = 2500;
export const RECORD_MS = 5000;

type Message = ContextEvent["messages"][number];
type Reason = NonNullable<PiHookRequest["reason"]>;
type Content = { type: "text"; text: string } | { type: "image" };
type Finished = { content: Content[]; isError: boolean };

const isMessage = (
    entry: unknown,
    role: string,
): entry is {
    type: "message";
    id: string;
    message: Record<string, unknown>;
} => {
    const value = entry as { type?: unknown; message?: { role?: unknown } };
    return value?.type === "message" && value.message?.role === role;
};

// Text and images alone, the images without their data: what the reader
// needs of a result, nothing it would have to refuse.
function contentOf(result: unknown): Content[] {
    const content = (result as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((block): Content[] => {
        if (block?.type === "text" && typeof block.text === "string")
            return [{ type: "text", text: block.text }];
        return block?.type === "image" ? [{ type: "image" }] : [];
    });
}

// The block a start asks for: a startup over saved speech is a resume.
function startReason(event: SessionStartEvent, ctx: ExtensionContext): Reason {
    if (event.reason === "new") return "clear";
    if (event.reason !== "startup") return "resume";
    const spoken = ctx.sessionManager
        .getEntries()
        .some((entry) => entry.type === "message");
    return spoken ? "resume" : "startup";
}

// The conversation with this one layer before its latest human prompt,
// any other copy of the layer gone; undefined where nothing changes.
export function layered(
    messages: readonly Message[],
    text: string,
): Message[] | undefined {
    const kept = messages.filter(
        (message) =>
            !(message.role === "custom" && message.customType === MEMORY_LAYER),
    );
    if (text === "") return kept.length === messages.length ? undefined : kept;
    const layer: Message = {
        role: "custom",
        customType: MEMORY_LAYER,
        content: text,
        display: false,
        timestamp: Date.now(),
    };
    let at = kept.length;
    while (at > 0 && kept[at - 1]?.role !== "user") at--;
    const before = at > 0 ? at - 1 : kept.length;
    return [...kept.slice(0, before), layer, ...kept.slice(before)];
}

export function deliverMemory(
    pi: ExtensionAPI,
    invoke: InvokeHook,
    warn: (ctx: ExtensionContext, code: string) => void,
): void {
    let block = "";
    let recall = "";
    let opening: Promise<void> = Promise.resolve();
    const records = new Set<Promise<unknown>>();
    const finished = new Map<string, Finished>();

    const ask = async (
        ctx: ExtensionContext,
        event: PiHookRequest["event"],
        extra: Pick<PiHookRequest, "reason" | "prompt">,
        ms: number,
    ): Promise<PiHookReply> => {
        let reply: PiHookReply;
        try {
            const session = ctx.sessionManager;
            const sessionFile = session.getSessionFile() ?? null;
            reply = await invoke(
                {
                    event,
                    sessionId: session.getSessionId(),
                    sessionFile,
                    leafId: session.getLeafId() ?? null,
                    cwd: ctx.cwd,
                    private: sessionFile === null,
                    ...extra,
                },
                AbortSignal.timeout(ms),
            );
        } catch {
            // A context Pi has already torn down, say: never a rejection.
            reply = failed("pi_hook_failed");
        }
        if (reply.warning !== null) warn(ctx, reply.warning);
        return reply;
    };
    // The latest opening alone sets the block, however the replies race.
    let generation = 0;
    const open = (ctx: ExtensionContext, reason: Reason) => {
        const mine = ++generation;
        opening = ask(ctx, "start", { reason }, CONTEXT_MS).then((reply) => {
            if (mine === generation) block = reply.context;
        });
    };
    // After the opening, so the helper hears a session's events in order.
    const record = (ctx: ExtensionContext, event: "settled" | "end") => {
        const sent = opening.then(() => ask(ctx, event, {}, RECORD_MS));
        records.add(sent);
        void sent.finally(() => records.delete(sent));
        return sent;
    };

    // Each finished call whose saved entry has no saved result on this
    // branch gets its final; one whose entry is unsaved waits.
    const finalize = (ctx: ExtensionContext) => {
        const branch = ctx.sessionManager.getBranch();
        for (const [toolCallId, result] of finished) {
            const at = branch.findLastIndex(
                (entry) =>
                    isMessage(entry, "assistant") &&
                    Array.isArray(entry.message.content) &&
                    entry.message.content.some(
                        (block: { type?: unknown; id?: unknown }) =>
                            block?.type === "toolCall" &&
                            block.id === toolCallId,
                    ),
            );
            if (at < 0) continue;
            finished.delete(toolCallId);
            const answered = branch
                .slice(at + 1)
                .some(
                    (entry) =>
                        isMessage(entry, "toolResult") &&
                        entry.message.toolCallId === toolCallId,
                );
            if (answered) continue;
            pi.appendEntry(TOOL_FINAL, {
                entryId: (branch[at] as { id: string }).id,
                toolCallId,
                content: result.content,
                isError: result.isError,
            });
        }
    };

    pi.on("session_start", (event, ctx) => {
        open(ctx, startReason(event, ctx));
    });
    pi.on("session_compact", (_event, ctx) => {
        open(ctx, "compact");
    });
    pi.on("session_tree", (_event, ctx) => {
        open(ctx, "resume");
    });
    pi.on("before_agent_start", async (event, ctx) => {
        await opening;
        if (event.messageType !== "user") return;
        recall = (
            await ask(ctx, "prompt", { prompt: event.prompt }, CONTEXT_MS)
        ).context;
    });
    // A refresh under way (after compaction, say) is awaited, bounded.
    pi.on("context", async (event) => {
        await opening;
        const text = [block, recall].filter((part) => part.trim() !== "");
        const messages = layered(event.messages, text.join("\n\n"));
        return messages === undefined ? undefined : { messages };
    });
    pi.on("tool_execution_end", (event) => {
        if (event.parentToolCallId !== undefined) return;
        finished.set(event.toolCallId, {
            content: contentOf(event.result),
            isError: event.isError,
        });
    });
    pi.on("agent_settled", (_event, ctx) => {
        finalize(ctx);
        void record(ctx, "settled");
    });
    pi.on("session_shutdown", async (_event, ctx) => {
        finalize(ctx);
        finished.clear();
        await Promise.allSettled([...records]);
        await record(ctx, "end");
    });
}
