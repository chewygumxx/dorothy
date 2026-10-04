// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/App.tsx
//
//

import { Box, Text, useApp, useInput, useWindowSize } from "ink";
import { useEffect, useReducer, useRef, useState } from "react";
import { type Config, DEFAULT_CONFIG } from "../config.js";
import type { ChatSession, ConversationEvent } from "../conversation.js";
import type { Turn } from "../persona.js";
import type { ResumedTurn, TranscriptEntry } from "../transcript.js";
import { type Draft, EMPTY_DRAFT, layoutDraft } from "./editor.js";
import { Header, Statusline, Warnings } from "./Header.js";
import { History } from "./History.js";
import { draftWidth, type EditorMemory, Input } from "./Input.js";
import { LiveReply, wrapRows } from "./LiveReply.js";
import {
    fitLayout,
    MIN_COLUMNS,
    minRows,
    tooSmallMessage,
    tooSmallShort,
} from "./layout.js";
import { RawPane } from "./RawPane.js";
import { initialState, reduce } from "./state.js";
import { moduleRows } from "./statusline.js";

export type TranscriptSink = {
    append(entry: TranscriptEntry): Promise<void>;
};

export type AppProps = {
    phrase: string;
    promptSha256: string;
    history: ResumedTurn[];
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
    const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
    // Kept here, not in Input, which is unmounted while the window is too
    // small.
    const memory = useRef<EditorMemory>({
        killed: "",
        goal: null,
        recall: null,
    });
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
        setDraft(EMPTY_DRAFT);
        turns.current.push({ role: "user", text });
        record({ kind: "user", text });
        dispatch({ type: "sent", text });
        session.current?.send(text);
    };

    // Below the minimum only the quit keys act; the draft waits in state.
    const statusLines =
        config.statusline.modules.length > 0 ? config.statusline.maxLines : 0;
    const neededRows = minRows(statusLines);
    const tooSmall = columns < MIN_COLUMNS || rows < neededRows;
    // <Static> prints a line once, at the width of the moment, so lines that
    // finish while the window is too small wait to print until it is not.
    const printable = useRef(state.lines.length);
    if (!tooSmall) {
        printable.current = state.lines.length;
    }
    const lines = state.lines.slice(0, printable.current);

    useInput((input, key) => {
        const quitKey = key.ctrl && (input === "c" || input === "d");
        if (tooSmall && !quitKey) {
            return;
        }
        if (key.escape) {
            if (state.streaming) {
                interrupt();
            }
        } else if (key.ctrl && input === "r") {
            dispatch({ type: "toggle-raw" });
        } else if (key.ctrl && input === "c") {
            if (state.streaming) {
                interrupt();
            } else if (draft.text !== "") {
                // Clearing is an edit, so it ends recall too.
                memory.current.recall = null;
                setDraft(EMPTY_DRAFT);
            } else {
                quit();
            }
        } else if (key.ctrl && input === "d") {
            // With a draft, Input deletes forward instead.
            if (draft.text === "") {
                quit();
            }
        }
    });

    // History stays mounted: <Static> prints each line once, and mounting it
    // again would print them all again. The message is cut short of the
    // window, which Ink would otherwise clear on every frame.
    if (tooSmall) {
        const room = Math.max(1, rows - 1);
        const full = wrapRows(
            tooSmallMessage(neededRows, rows, columns),
            columns,
        );
        const message = (
            full.length <= room
                ? full
                : wrapRows(tooSmallShort(neededRows, rows, columns), columns)
        ).slice(0, room);
        return (
            <Box flexDirection="column">
                <History lines={lines} replyStats={config.replyStats} />
                <Text>{message.join("\n")}</Text>
            </Box>
        );
    }

    const statusRows = moduleRows(
        config.statusline,
        state.lastStats,
        state.costUsd,
        columns,
    );
    const layout = fitLayout(rows, {
        showRaw: state.showRaw,
        rawCount: state.raw.length,
        warnings: state.warnings.length,
        statusRows: statusRows.length,
        inputRows: layoutDraft(draft, draftWidth(columns)).rows.length,
    });

    const messages = turns.current
        .filter((turn) => turn.role === "user")
        .map((turn) => turn.text);

    return (
        <Box flexDirection="column">
            <History lines={lines} replyStats={config.replyStats} />
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
                <Warnings warnings={state.warnings} />
                <Input
                    draft={draft}
                    messages={messages}
                    canSend={!state.streaming && !closing}
                    maxRows={layout.inputRows}
                    memory={memory.current}
                    onChange={setDraft}
                    onSubmit={submit}
                />
                <Statusline rows={statusRows} />
                <Header
                    phrase={phrase}
                    model={state.model}
                    sdkSessionId={state.sdkSessionId}
                    status={state.status}
                />
            </Box>
        </Box>
    );
}
