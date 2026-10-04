// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/Input.tsx
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
};

export const KEY_HINTS =
    "enter send · shift+enter newline · ctrl+g editor · esc stop · ctrl+r raw · ctrl+c quit";
export const PROMPT_WIDTH = 2;

// Every row must fit the terminal (a row that wraps there takes a row Ink
// does not count), so the draft wraps one column short of the space beside
// the gutter, leaving room for a cursor drawn after a full row.
export const draftWidth = (columns: number): number =>
    Math.max(1, columns - PROMPT_WIDTH - 1);

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

export const cleanPaste = (text: string): string =>
    text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").replace(CONTROLS, "");

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
        // On an empty draft App quits instead.
        d: (current) => {
            if (current.text !== "") {
                change(deleteForward(current));
            }
        },
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
            ctrl[input]?.(current);
        } else if (key.meta) {
            if (input === "b") {
                change(wordLeft(current));
            } else if (input === "f") {
                change(wordRight(current));
            }
        } else if (!key.escape && !key.tab && input) {
            // Keys the terminal sends together (fast typing, or typing before
            // raw mode is on) reach here as one chunk, Enter included; Ink
            // leaves it in the text. Pastes come through usePaste instead.
            const [first = "", ...rest] = input.split(/\r\n?|\n/);
            change(insert(current, cleanPaste(first)));
            for (const line of rest) {
                if (canSend) {
                    memory.recall = null;
                    onSubmit(latest.current.text);
                    latest.current = EMPTY_DRAFT;
                }
                change(insert(latest.current, cleanPaste(line)));
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
