// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/Markdown.tsx
//
//

import { Box, Text } from "ink";
import type { Row } from "./markdown/spans.js";

// One <Text> per row, already wrapped to the width; truncation is only a
// safety net. An empty row keeps its height with a space.
export function RowsView({ rows }: { rows: Row[] }) {
    return (
        <Box flexDirection="column">
            {(rows.length > 0 ? rows : [[]]).map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional.
                <Text key={index} wrap="truncate">
                    {row.length === 0
                        ? " "
                        : row.map((span, at) => (
                              <Text
                                  // biome-ignore lint/suspicious/noArrayIndexKey: spans are positional.
                                  key={at}
                                  bold={span.style.bold}
                                  italic={span.style.italic}
                                  underline={span.style.underline}
                                  strikethrough={span.style.strikethrough}
                                  dimColor={span.style.dim}
                                  color={span.style.color}
                              >
                                  {span.text}
                              </Text>
                          ))}
                </Text>
            ))}
        </Box>
    );
}
