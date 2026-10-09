// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/memory/record.ts
//
//

// What a chat records of its sessions, as App did: each session once it
// is ready, each message as it is sent, each lookup, and each reply with
// its stats, or what was on screen of a reply cut short. A session that
// has been closed records nothing more, as App stopped hearing a session
// once it had moved on.

import type {
    ChatSession,
    ConversationEvent,
    Notice,
    NoticeSource,
} from "@dorothy/core";
import type { TranscriptEntry } from "../transcript.js";

export type TranscriptSink = {
    append(entry: TranscriptEntry): Promise<void>;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export function sessionRecorder({
    sink,
    phrase,
    promptHash,
    resumed,
    warn,
}: {
    sink: TranscriptSink;
    phrase: string;
    promptHash: string;
    // Whether the chat had turns before its first session.
    resumed: boolean;
    warn: (message: string) => void;
}): (session: ChatSession) => ChatSession {
    let wasResumed = resumed;
    const record = (entry: TranscriptEntry) => {
        sink.append(entry).catch((error: unknown) => {
            warn(`transcript not saved: ${describeError(error)}`);
        });
    };
    const recordEvent = (event: ConversationEvent) => {
        if (event.type === "ready") {
            record({
                kind: "session",
                phrase,
                sdkSessionId: event.sdkSessionId,
                model: event.model,
                promptHash,
                resumed: wasResumed,
            });
            wasResumed = true;
        } else if (event.type === "lookup") {
            record({
                kind: "recall",
                id: event.id,
                ok: event.ok,
                offset: event.offset,
                ...event.lookup,
            });
        } else if (event.type === "turn-end") {
            record({
                kind: "assistant",
                text: event.reply,
                interrupted: event.interrupted,
            });
            record({ kind: "stats", ...event.stats });
        } else if (event.type === "error" && event.partial) {
            record({
                kind: "assistant",
                text: event.partial,
                interrupted: true,
            });
        }
    };
    return (session) => {
        let open = true;
        const listeners = new Set<(event: ConversationEvent) => void>();
        session.subscribe((event) => {
            if (open) {
                recordEvent(event);
            }
            for (const listener of listeners) {
                listener(event);
            }
        });
        return {
            subscribe(listener) {
                listeners.add(listener);
                return () => {
                    listeners.delete(listener);
                };
            },
            send(text) {
                if (open) {
                    record({ kind: "user", text });
                }
                session.send(text);
            },
            interrupt: () => session.interrupt(),
            close: () => {
                open = false;
                return session.close();
            },
        };
    };
}

// Warnings raised outside the service and history, such as a transcript
// write that failed, told to the chat the same way.
export function noticeChannel(): NoticeSource & {
    warn(message: string): void;
} {
    const listeners = new Set<(notice: Notice) => void>();
    return {
        subscribe(listener) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        warn(message) {
            for (const listener of listeners) {
                listener({ type: "warning", message });
            }
        },
    };
}
