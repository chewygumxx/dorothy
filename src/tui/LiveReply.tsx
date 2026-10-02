// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/LiveReply.tsx
//
//

import { Box, Text } from "ink";
import type { TurnStats } from "../conversation.js";

export const LABEL_WIDTH = 9;

export function formatStats(stats: TurnStats): string {
    const parts = [`${stats.inputTokens} in`, `${stats.outputTokens} out`];
    if (stats.ttftMs !== null) {
        parts.push(`ttft ${(stats.ttftMs / 1000).toFixed(1)}s`);
    }
    parts.push(
        `${(stats.durationMs / 1000).toFixed(1)}s`,
        `$${stats.costUsd.toFixed(4)} (session $${stats.sessionCostUsd.toFixed(4)})`,
    );
    return parts.join(" · ");
}

export function LiveReply({
    text,
    streaming,
}: {
    text: string;
    streaming: boolean;
}) {
    if (!streaming) {
        return null;
    }
    return (
        <Box>
            <Box width={LABEL_WIDTH} flexShrink={0}>
                <Text color="magenta" bold>
                    dorothy
                </Text>
            </Box>
            <Text>{text}▍</Text>
        </Box>
    );
}
