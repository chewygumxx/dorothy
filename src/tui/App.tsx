// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/App.tsx
//
//

import { Box, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useReducer, useRef, useState } from "react";
import { type Config, DEFAULT_CONFIG } from "../config.js";
import type { ChatSession, ConversationEvent } from "../conversation.js";
import type { Turn } from "../persona.js";
import type { TranscriptEntry } from "../transcript.js";
import { Header } from "./Header.js";
import { History } from "./History.js";
import { Input, inputRows } from "./Input.js";
import { LiveReply } from "./LiveReply.js";
import { fitLayout } from "./layout.js";
import { RawPane } from "./RawPane.js";
import { initialState, reduce } from "./state.js";

export type TranscriptSink = {
    append(entry: TranscriptEntry): Promise<void>;
};

export type AppProps = {
    phrase: string;
    promptSha256: string;
    history: Turn[];
    createSession(history: Turn[]): ChatSession;
    transcript: TranscriptSink | null;
    initialWarnings?: string[];
    // What the chat cost before this run, for --resume.
    initialCostUsd?: number;
    // The statusline and reply stats; the defaults when not given.
    config?: Config;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export function App({
    phrase,
    promptSha256,
    history,
    createSession,
    transcript,
    initialWarnings = [],
    initialCostUsd = 0,
    config = DEFAULT_CONFIG,
}: AppProps) {
    const { exit } = useApp();
    const { columns, rows } = useWindowSize();
    const [state, dispatch] = useReducer(reduce, undefined, () =>
        initialState(history, initialWarnings, initialCostUsd),
    );
    const [draft, setDraft] = useState("");
    // Refs, not state: event listeners registered once must see current values.
    const turns = useRef<Turn[]>([...history]);
    const session = useRef<ChatSession | null>(null);
    const resumed = useRef(history.length > 0);

    const record = (entry: TranscriptEntry) => {
        transcript?.append(entry).catch((error: unknown) => {
            dispatch({
                type: "warning",
                message: `transcript not saved: ${describeError(error)}`,
            });
        });
    };

    const onEvent = (event: ConversationEvent) => {
        if (event.type === "ready") {
            record({
                kind: "session",
                phrase,
                sdkSessionId: event.sdkSessionId,
                model: event.model,
                promptSha256,
                resumed: resumed.current,
            });
            resumed.current = true;
        } else if (event.type === "turn-end") {
            turns.current.push({ role: "assistant", text: event.reply });
            record({
                kind: "assistant",
                text: event.reply,
                interrupted: event.interrupted,
            });
            record({ kind: "stats", ...event.stats });
        } else if (event.type === "error" && event.partial) {
            // Keep what was already on screen, so a reconnect or --resume
            // carries it too.
            turns.current.push({ role: "assistant", text: event.partial });
            record({
                kind: "assistant",
                text: event.partial,
                interrupted: true,
            });
        }
    };

    // A new session is seeded with every turn so far: the same path serves
    // first start, --resume and reconnecting after an error.
    const connect = () => {
        void session.current?.close();
        const next = createSession(turns.current);
        session.current = next;
        next.subscribe((event) => {
            if (session.current !== next) {
                return;
            }
            dispatch({ type: "event", event });
            onEvent(event);
        });
    };

    // A session that is dying can fail the interrupt request; say so rather
    // than let the rejection go unhandled.
    const interrupt = () => {
        session.current?.interrupt().catch((error: unknown) => {
            dispatch({
                type: "warning",
                message: `interrupt failed: ${describeError(error)}`,
            });
        });
    };

    // The session gets a grace period to exit, during which nothing more is
    // sent and a second quit key does not cut it short.
    const closing = state.status === "closing";
    const quit = () => {
        if (closing) {
            return;
        }
        dispatch({ type: "closing" });
        const current = session.current;
        session.current = null;
        void (current?.close() ?? Promise.resolve()).finally(exit);
    };

    // biome-ignore lint/correctness/useExhaustiveDependencies: connect once on mount; later sessions come from reconnecting.
    useEffect(() => {
        connect();
        return () => {
            void session.current?.close();
        };
    }, []);

    const submit = (value: string) => {
        const text = value.trim();
        if (closing) {
            return;
        }
        if (text === "/exit") {
            quit();
            return;
        }
        if (state.status === "disconnected") {
            dispatch({ type: "reconnecting" });
            connect();
        }
        if (text === "") {
            return;
        }
        setDraft("");
        turns.current.push({ role: "user", text });
        record({ kind: "user", text });
        dispatch({ type: "sent", text });
        session.current?.send(text);
    };

    useInput((input, key) => {
        if (key.escape) {
            if (state.streaming) {
                interrupt();
            }
        } else if (key.ctrl && input === "r") {
            dispatch({ type: "toggle-raw" });
        } else if (key.ctrl && input === "c") {
            if (state.streaming) {
                interrupt();
            } else {
                quit();
            }
        } else if (key.ctrl && input === "d") {
            quit();
        }
    });

    const layout = fitLayout(rows, {
        showRaw: state.showRaw,
        rawCount: state.raw.length,
        warnings: state.warnings.length,
        inputRows: inputRows(draft, columns),
    });

    return (
        <Box flexDirection="column">
            <History lines={state.lines} replyStats={config.replyStats} />
            <LiveReply
                text={state.live}
                streaming={state.streaming}
                width={columns}
                maxRows={layout.replyRows}
            />
            {state.showRaw ? (
                <RawPane entries={state.raw.slice(-layout.rawRows)} />
            ) : null}
            <Box
                flexDirection="column"
                borderStyle="single"
                borderLeft={false}
                borderRight={false}
                borderBottom={false}
            >
                <Header
                    phrase={phrase}
                    model={state.model}
                    sdkSessionId={state.sdkSessionId}
                    status={state.status}
                    warnings={state.warnings}
                />
                <Input
                    value={draft}
                    disabled={state.streaming || closing}
                    maxRows={layout.inputRows}
                    onChange={setDraft}
                    onSubmit={submit}
                />
            </Box>
        </Box>
    );
}
