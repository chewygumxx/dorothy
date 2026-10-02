// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/Input.tsx
//
//

import { Box, Text, useInput } from "ink";

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
    useInput((input, key) => {
        if (disabled) {
            return;
        }
        if (key.return) {
            onSubmit(value);
        } else if (key.backspace || key.delete) {
            // Array.from splits by code point, so an emoji goes in one press.
            onChange(Array.from(value).slice(0, -1).join(""));
        } else if (!key.ctrl && !key.meta && !key.escape && !key.tab && input) {
            onChange(value + input.replace(/[\r\n]+/g, " "));
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
