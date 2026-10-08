// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/Header.tsx
//
//

import { Box, Text } from "ink";
import type { Status } from "./state.js";

export type HeaderProps = {
    phrase: string;
    model: string | null;
    sdkSessionId: string | null;
    status: Status;
};

const STATUS_COLORS: Record<Status, string> = {
    starting: "yellow",
    ready: "green",
    disconnected: "red",
    closing: "yellow",
};

export function shortId(id: string): string {
    return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-3)}` : id;
}

export function Header({ phrase, model, sdkSessionId, status }: HeaderProps) {
    const parts = [
        "dorothy",
        phrase,
        model ?? "…",
        `sdk ${sdkSessionId ? shortId(sdkSessionId) : "…"}`,
    ];
    return (
        <Text wrap="truncate">
            <Text bold>{parts.join(" · ")}</Text>
            {" · "}
            <Text color={STATUS_COLORS[status]}>{status}</Text>
        </Text>
    );
}

// Above the input, one row each, cut short rather than wrapped.
export function Warnings({ warnings }: { warnings: string[] }) {
    return (
        <Box flexDirection="column">
            {warnings.map((warning) => (
                <Text key={warning} color="yellow" wrap="truncate">
                    ! {warning}
                </Text>
            ))}
        </Box>
    );
}

// Under the input; fitModules has already fitted each row to the width.
export function Statusline({ rows }: { rows: string[] }) {
    return (
        <Box flexDirection="column">
            {rows.map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
                <Text key={index} dimColor wrap="truncate">
                    {row}
                </Text>
            ))}
        </Box>
    );
}
