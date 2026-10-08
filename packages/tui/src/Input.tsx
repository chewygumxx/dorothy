// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/Input.tsx
//
//

import { Box, Text, useInput, usePaste, useWindowSize } from "ink";
import { type ReactNode, useRef } from "react";
import {
    backspace,
    type Draft,
    type DraftRow,
    deleteForward,
    down,
    draftWindow,
    EMPTY_DRAFT,
    insert,
    type Kill,
    killLineEnd,
    killLineStart,
    killWordBack,
    layoutDraft,
    left,
    lineEnd,
    lineStart,
    right,
    up,
    wordLeft,
    wordRight,
} from "./editor.js";
import { graphemes } from "./markdown/spans.js";
import { newer, older, type Recall, startRecall } from "./recall.js";

// What the editor remembers between keys: the last kill, the column kept
// across vertical moves and the place in recall. App owns it, so a window
// too small to draw the input does not reset it.
export type EditorMemory = {
    killed: string;
    goal: number | null;
    recall: Recall | null;
};

export type InputProps = {
    draft: Draft;
    messages: readonly string[];
    canSend: boolean;
    maxRows: number;
    memory: EditorMemory;
    onChange(draft: Draft): void;
    onSubmit(text: string): void;
    // Ctrl keys that are not edits: C and D on an empty draft (or C while
    // a reply streams), G, R and the rest. Only Input sees those typed in
    // the same chunk as text.
    onCtrl(letter: string): void;
};

export const KEY_HINTS =
    "enter send · shift+enter newline · ctrl+g editor · esc stop · ctrl+r raw · ctrl+c quit";
export const PROMPT_WIDTH = 2;

// Every row must fit the terminal (a row that wraps there takes a row Ink
// does not count), so the draft wraps one column short of the space beside
// the gutter, leaving room for a cursor drawn after a full row.
export const draftWidth = (columns: number): number =>
    Math.max(1, columns - PROMPT_WIDTH - 1);

// Whole sequences, so none leaves its printable tail behind: CSI (7- or
// 8-bit), then strings such as OSC ended by BEL or ST, then SS3, then any
// other escape. An unended string loses only its introducer.
const ESCAPES =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
    /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]|\u001B[\]PX^_][^\u0007\u001B]*(?:\u0007|\u001B\\)|\u001B[NO][ -~]|\u001B[ -/]*[0-~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;

// A chunk splits into text, Enters and Ctrl keys (Ctrl+A to Ctrl+Z, less
// Tab and Enter, and the rest of C0, which do nothing).
const TYPED_KEYS =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
    /(\r\n?|\n|[\u0000-\u0008\u000B\u000C\u000E-\u001F])/;

export const cleanPaste = (text: string): string =>
    text
        .replace(ESCAPES, "")
        .replace(/\r\n?/g, "\n")
        .replace(/\t/g, "    ")
        .replace(CONTROLS, "");

function withCursor(row: DraftRow, cursor: number): ReactNode {
    const offset = Math.min(Math.max(cursor - row.start, 0), row.text.length);
    const [at, ...after] = graphemes(row.text.slice(offset));
    return (
        <>
            {row.text.slice(0, offset)}
            {at === undefined ? "▏" : <Text inverse>{at}</Text>}
            {after.join("")}
        </>
    );
}

export function Input({
    draft,
    messages,
    canSend,
    maxRows,
    memory,
    onChange,
    onSubmit,
    onCtrl,
}: InputProps) {
    const { columns } = useWindowSize();
    const width = draftWidth(columns);
    // Ink splits one stdin chunk into several events before React re-renders,
    // so each edit builds on the last one here rather than on the prop.
    const latest = useRef(draft);
    latest.current = draft;

    const change = (next: Draft, keepRecall = false) => {
        memory.goal = null;
        if (!keepRecall) {
            memory.recall = null;
        }
        latest.current = next;
        onChange(next);
    };
    const kill = ({ draft: next, killed: text }: Kill) => {
        if (text !== "") {
            memory.killed = text;
        }
        change(next);
    };

    // Rows first; past the first or last row, the message history.
    const vertical = (direction: "up" | "down") => {
        const current = latest.current;
        const column = memory.goal ?? layoutDraft(current, width).cursorColumn;
        const moved = (direction === "up" ? up : down)(current, width, column);
        if (moved) {
            latest.current = moved;
            onChange(moved);
            memory.goal = column;
            return;
        }
        memory.recall ??= startRecall(messages);
        const step =
            direction === "up"
                ? older(memory.recall, current.text)
                : newer(memory.recall);
        if (step) {
            memory.recall = step.recall;
            change({ text: step.text, cursor: step.text.length }, true);
        }
    };

    const ctrl: Record<string, (current: Draft) => void> = {
        a: (current) => change(lineStart(current)),
        e: (current) => change(lineEnd(current)),
        b: (current) => change(left(current)),
        f: (current) => change(right(current)),
        w: (current) => kill(killWordBack(current)),
        u: (current) => kill(killLineStart(current)),
        k: (current) => kill(killLineEnd(current)),
        y: (current) => change(insert(current, memory.killed)),
        // Clearing is an edit, so it ends recall too; while a reply streams
        // App stops it instead, and on an empty draft quits.
        c: (current) => {
            if (canSend && current.text !== "") {
                change(EMPTY_DRAFT);
            } else {
                onCtrl("c");
            }
        },
        d: (current) => {
            if (current.text !== "") {
                change(deleteForward(current));
            } else {
                onCtrl("d");
            }
        },
    };
    const control = (letter: string) => {
        const edit = ctrl[letter];
        if (edit) {
            edit(latest.current);
        } else {
            onCtrl(letter);
        }
    };

    useInput((input, key) => {
        const current = latest.current;
        if (key.return) {
            if (key.shift) {
                change(insert(current, "\n"));
            } else if (canSend) {
                memory.recall = null;
                onSubmit(current.text);
            }
        } else if (key.upArrow) {
            vertical("up");
        } else if (key.downArrow) {
            vertical("down");
        } else if (key.leftArrow) {
            change(key.ctrl || key.meta ? wordLeft(current) : left(current));
        } else if (key.rightArrow) {
            change(key.ctrl || key.meta ? wordRight(current) : right(current));
        } else if (key.home) {
            change(lineStart(current));
        } else if (key.end) {
            change(lineEnd(current));
        } else if (key.backspace) {
            if (key.meta) {
                kill(killWordBack(current));
            } else {
                change(backspace(current));
            }
        } else if (key.delete) {
            change(deleteForward(current));
        } else if (key.ctrl) {
            control(input);
        } else if (key.meta) {
            if (input === "b") {
                change(wordLeft(current));
            } else if (input === "f") {
                change(wordRight(current));
            }
        } else if (!key.escape && !key.tab && input) {
            // Keys the terminal sends together (fast typing, or typing before
            // raw mode is on) reach here as one chunk, Enter and Ctrl keys
            // included; Ink leaves them in the text. Each acts as if typed
            // alone, but only the first Enter sends: App cannot stop sending
            // until it renders again, so later ones start new lines, as does
            // one that cannot send. Pastes come through usePaste instead.
            let sent = false;
            for (const part of input.split(TYPED_KEYS)) {
                if (/^[\r\n]/.test(part)) {
                    const text = latest.current.text;
                    if (canSend && !sent) {
                        memory.recall = null;
                        onSubmit(text);
                        sent = text.trim() !== "";
                        latest.current = EMPTY_DRAFT;
                    } else {
                        change(insert(latest.current, "\n"));
                    }
                } else if (TYPED_KEYS.test(part)) {
                    const code = part.charCodeAt(0);
                    if (code >= 1 && code <= 26) {
                        control(String.fromCharCode(code + 96));
                    }
                } else if (part !== "") {
                    change(insert(latest.current, cleanPaste(part)));
                }
            }
        }
    });

    usePaste((text) => {
        change(insert(latest.current, cleanPaste(text)));
    });

    if (draft.text === "") {
        // The hints, right-aligned by padding, are cut short rather than
        // wrapped.
        const pad = Math.max(1, width - KEY_HINTS.length);
        return (
            <Box>
                <Box width={PROMPT_WIDTH} flexShrink={0}>
                    <Text>›</Text>
                </Box>
                <Text wrap="truncate">
                    ▏{" ".repeat(pad)}
                    <Text dimColor>{KEY_HINTS}</Text>
                </Text>
            </Box>
        );
    }

    const layout = layoutDraft(draft, width);
    const { first, last } = draftWindow(layout, maxRows);
    return (
        <Box flexDirection="column">
            {layout.rows.slice(first, last).map((row, offset) => {
                const index = first + offset;
                const gutter =
                    index === first && first > 0
                        ? "↑"
                        : index === last - 1 && last < layout.rows.length
                          ? "↓"
                          : index === 0
                            ? "›"
                            : "";
                return (
                    <Box key={row.start}>
                        <Box width={PROMPT_WIDTH} flexShrink={0}>
                            <Text dimColor={gutter !== "›"}>{gutter}</Text>
                        </Box>
                        <Text wrap="truncate">
                            {index === layout.cursorRow
                                ? withCursor(row, draft.cursor)
                                : row.text || " "}
                        </Text>
                    </Box>
                );
            })}
        </Box>
    );
}
