// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/RawPane.tsx
//
//

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { Box, Text } from "ink";
import type { RawEntry } from "./state.js";

type Described = {
    type: string;
    subtype?: string;
    event?: { type?: string; delta?: unknown };
};

// One line per message: its type, its subtype or stream event type, and the
// most specific payload as JSON.
export function describeRaw(message: SDKMessage, width = 100): string {
    const record = message as unknown as Described;
    const label = [record.type, record.subtype ?? record.event?.type]
        .filter(Boolean)
        .join(" ");
    const body = JSON.stringify(record.event?.delta ?? record.event ?? message);
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
