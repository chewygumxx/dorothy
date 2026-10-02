// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/Input.tsx
//
//

import { Box, Text, useInput } from "ink";
import { useRef } from "react";

export type InputProps = {
    value: string;
    disabled: boolean;
    onChange(value: string): void;
    onSubmit(value: string): void;
};

export const KEY_HINTS = "enter send · esc stop · ctrl+r raw · ctrl+c quit";

// Hand-rolled on useInput rather than ink-text-input: App owns Esc, Ctrl+R,
// Ctrl+C and Ctrl+D, so this only edits one line.
export function Input({ value, disabled, onChange, onSubmit }: InputProps) {
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
            change(latest.current + input.replace(/[\r\n]+/g, " "));
        }
    });
    return (
        <Box justifyContent="space-between">
            <Text>
                › {value}
                {disabled ? "" : "▏"}
            </Text>
            <Text dimColor>{KEY_HINTS}</Text>
        </Box>
    );
}
