// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/RawPane.tsx
//
//

import type { RawMessage } from "@dorothy/core";
import { Box, Text } from "ink";
import type { RawEntry } from "./state.js";

// One line per message: its type, its subtype or stream event type, and the
// most specific payload as JSON.
export function describeRaw(message: RawMessage, width = 100): string {
    const label = [message.type, message.subtype ?? message.event?.type]
        .filter(Boolean)
        .join(" ");
    const body = JSON.stringify(
        message.event?.delta ?? message.event ?? message,
    );
    const line = `${label} ${body}`;
    return line.length > width ? `${line.slice(0, width - 1)}…` : line;
}

export function RawPane({ entries }: { entries: RawEntry[] }) {
    return (
        <Box
            flexDirection="column"
            borderStyle="single"
            borderLeft={false}
            borderRight={false}
        >
            <Text dimColor>raw (ctrl+r)</Text>
            {entries.map((entry) => (
                <Text key={entry.id} dimColor wrap="truncate">
                    {describeRaw(entry.message)}
                </Text>
            ))}
        </Box>
    );
}
