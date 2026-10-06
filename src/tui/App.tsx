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
import type { EditResult } from "./external-editor.js";
import { Header, Statusline, Warnings } from "./Header.js";
import { History } from "./History.js";
import { cleanPaste, draftWidth, type EditorMemory, Input } from "./Input.js";
import { LiveReply, wrapRows } from "./LiveReply.js";
import {
    fitLayout,
    MIN_COLUMNS,
    minRows,
    tooSmallMessage,
    tooSmallShort,
} from "./layout.js";
import { RawPane } from "./RawPane.js";
import { initialState, type Line, reduce } from "./state.js";
import { moduleRows } from "./statusline.js";

export type TranscriptSink = {
    append(entry: TranscriptEntry): Promise<void>;
};

// What the memory service tells the chat. The shapes are reducer actions, so
// a notice is dispatched as it comes.
export type Notice =
    | { type: "warning"; message: string }
    | { type: "memory-cost"; usd: number };
export type NoticeSource = {
    subscribe(listener: (notice: Notice) => void): () => void;
};

export type AppProps = {
    phrase: string;
    promptHash: string;
    history: ResumedTurn[];
    createSession(history: Turn[]): ChatSession;
    transcript: TranscriptSink | null;
    initialWarnings?: string[];
    // What the chat cost before this run, for --resume.
    initialCostUsd?: number;
    // The statusline and reply stats; the defaults when not given.
    config?: Config;
    // Memory's warnings and review costs; run.tsx supplies them.
    notices?: NoticeSource;
    // Opens the draft in $EDITOR; run.tsx supplies the real one.
    editDraft(text: string): Promise<EditResult>;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export function App({
    phrase,
    promptHash,
    history,
    createSession,
    transcript,
    initialWarnings = [],
    initialCostUsd = 0,
    config = DEFAULT_CONFIG,
    notices,
    editDraft,
}: AppProps) {
    const { exit, suspendTerminal } = useApp();
    const { columns, rows } = useWindowSize();
    const [state, dispatch] = useReducer(reduce, undefined, () =>
        initialState(history, initialWarnings, initialCostUsd),
    );
    const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
    // Ink discards renders while the editor has the terminal, which would
    // lose <Static> lines printed meanwhile; History keeps the lines it had
    // until the editor closes, then prints the rest.
    const [frozenLines, setFrozenLines] = useState<Line[] | null>(null);
    const editing = useRef(false);
    const latestDraft = useRef(draft);
    latestDraft.current = draft;
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
                promptHash,
                resumed: resumed.current,
            });
            resumed.current = true;
        } else if (event.type === "lookup") {
            record({
                kind: "recall",
                id: event.id,
                ok: event.ok,
                offset: event.offset,
                ...event.lookup,
            });
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

    useEffect(() => notices?.subscribe(dispatch), [notices]);

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
    const lines = frozenLines ?? state.lines.slice(0, printable.current);

    const openEditor = () => {
        // Nothing more is sent once closing, so an edit would be lost.
        if (editing.current || closing) {
            return;
        }
        editing.current = true;
        setFrozenLines(lines);
        let result: EditResult = { ok: false, message: "editor did not run" };
        suspendTerminal(async () => {
            result = await editDraft(latestDraft.current.text);
        })
            .catch((error: unknown) => {
                result = {
                    ok: false,
                    message: `editor failed: ${describeError(error)}`,
                };
            })
            .finally(() => {
                editing.current = false;
                setFrozenLines(null);
                if (result.ok) {
                    // A new draft, so recall ends as it does on any edit; its
                    // text is cleaned as a paste is, so offsets match rows.
                    const text = cleanPaste(result.text);
                    memory.current.recall = null;
                    memory.current.goal = null;
                    setDraft({ text, cursor: text.length });
                } else {
                    dispatch({ type: "warning", message: result.message });
                }
            });
    };

    // Ctrl keys that are not edits. Input passes them on, having seen any
    // typed in the same chunk as text and cleared or deleted with C or D.
    const control = (letter: string) => {
        if (letter === "c" && state.streaming) {
            interrupt();
        } else if (letter === "c" || letter === "d") {
            quit();
        } else if (letter === "g") {
            openEditor();
        } else if (letter === "r") {
            dispatch({ type: "toggle-raw" });
        }
    };

    useInput((input, key) => {
        if (tooSmall) {
            // Only the quit keys act, and the draft, unseen, is kept.
            if (key.ctrl && (input === "c" || input === "d")) {
                control(input);
            }
        } else if (key.escape && state.streaming) {
            interrupt();
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
        state.memoryCostUsd,
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
                    onChange={(next) => {
                        latestDraft.current = next;
                        setDraft(next);
                    }}
                    onCtrl={control}
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
