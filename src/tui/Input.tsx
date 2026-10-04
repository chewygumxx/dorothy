// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/Input.tsx
//
//

import { Box, Text, useInput, usePaste, useWindowSize } from "ink";
import { useRef } from "react";
import { wrapRows } from "./LiveReply.js";

export type InputProps = {
    value: string;
    disabled: boolean;
    // The most rows the draft may take; the rows above them are hidden.
    maxRows: number;
    onChange(value: string): void;
    onSubmit(value: string): void;
};

export const KEY_HINTS = "enter send · esc stop · ctrl+r raw · ctrl+c quit";
const PROMPT_WIDTH = 2;

// Newlines are handled before this, so it leaves only printable text.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
const CONTROLS = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const clean = (text: string) =>
    text.replace(/\t/g, "    ").replace(CONTROLS, "");

const CURSOR = "▏";
const draftRows = (value: string, columns: number, cursor: string) =>
    wrapRows(`${value}${cursor}`, columns - PROMPT_WIDTH);

// The rows the input would take with no limit; fitLayout decides how many it
// gets.
export const inputRows = (value: string, columns: number): number =>
    value === "" ? 1 : draftRows(value, columns, CURSOR).length;

// Hand-rolled on useInput rather than ink-text-input: App owns Esc, Ctrl+R,
// Ctrl+C and Ctrl+D, so this only edits one line.
export function Input({
    value,
    disabled,
    maxRows,
    onChange,
    onSubmit,
}: InputProps) {
    const { columns } = useWindowSize();
    // Ink splits one stdin chunk (a held Backspace, fast typing) into several
    // events before React re-renders, so each edit builds on the last one
    // here rather than on the value prop.
    const latest = useRef(value);
    latest.current = value;
    const change = (next: string) => {
        latest.current = next;
        onChange(next);
    };
    useInput((input, key) => {
        if (disabled) {
            return;
        }
        if (key.return) {
            onSubmit(latest.current);
        } else if (key.backspace || key.delete) {
            // Array.from splits by code point, so an emoji goes in one press.
            change(Array.from(latest.current).slice(0, -1).join(""));
        } else if (!key.ctrl && !key.meta && !key.escape && !key.tab && input) {
            // Keys the terminal sends together (fast typing, or typing before
            // raw mode is on) reach here as one chunk, Enter included; Ink
            // leaves it in the text. Pastes come through usePaste instead.
            const [first = "", ...rest] = input.split(/\r\n?|\n/);
            change(latest.current + clean(first));
            for (const line of rest) {
                onSubmit(latest.current);
                change(clean(line));
            }
        }
    });
    // Bracketed paste, so a pasted newline is not taken for Enter. The input
    // is one line, so newlines become spaces.
    usePaste((text) => {
        if (!disabled) {
            change(latest.current + clean(text.replace(/[\r\n]+/g, " ")));
        }
    });
    // Every row must fit the terminal: one that wraps there takes a row Ink
    // does not count, so its next erase leaves a stale line behind. The draft
    // is wrapped here, beside the prompt, and only its last rows are shown;
    // the hints, right-aligned by padding, show only while it is empty and
    // are cut short rather than wrapped.
    const cursor = disabled ? "" : CURSOR;
    if (value === "") {
        const pad = Math.max(
            1,
            columns - PROMPT_WIDTH - cursor.length - KEY_HINTS.length,
        );
        return (
            <Box>
                <Box width={PROMPT_WIDTH} flexShrink={0}>
                    <Text>›</Text>
                </Box>
                <Text wrap="truncate">
                    {cursor}
                    {" ".repeat(pad)}
                    <Text dimColor>{KEY_HINTS}</Text>
                </Text>
            </Box>
        );
    }
    const rows = draftRows(value, columns, cursor);
    const shown = rows.slice(-Math.max(1, maxRows));
    const hidden = shown.length < rows.length;
    return (
        <Box flexDirection="column">
            {shown.map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
                <Box key={index}>
                    <Box width={PROMPT_WIDTH} flexShrink={0}>
                        {index > 0 ? null : hidden ? (
                            <Text dimColor>↑</Text>
                        ) : (
                            <Text>›</Text>
                        )}
                    </Box>
                    <Text wrap="truncate">{row || " "}</Text>
                </Box>
            ))}
        </Box>
    );
}
