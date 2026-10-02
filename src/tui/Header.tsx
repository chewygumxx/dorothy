// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/Header.tsx
//
//

import { Box, Text } from "ink";
import type { Status } from "./state.js";

export type HeaderProps = {
    phrase: string;
    model: string | null;
    sdkSessionId: string | null;
    status: Status;
    warning: string | null;
};

const STATUS_COLORS: Record<Status, string> = {
    starting: "yellow",
    ready: "green",
    disconnected: "red",
};

export function shortId(id: string): string {
    return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-3)}` : id;
}

export function Header({
    phrase,
    model,
    sdkSessionId,
    status,
    warning,
}: HeaderProps) {
    const parts = [
        "dorothy",
        phrase,
        model ?? "…",
        `sdk ${sdkSessionId ? shortId(sdkSessionId) : "…"}`,
    ];
    return (
        <Box flexDirection="column">
            <Text>
                <Text bold>{parts.join(" · ")}</Text>
                {" · "}
                <Text color={STATUS_COLORS[status]}>{status}</Text>
            </Text>
            {warning ? <Text color="yellow">! {warning}</Text> : null}
        </Box>
    );
}
