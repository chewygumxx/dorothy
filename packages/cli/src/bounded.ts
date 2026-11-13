// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/bounded.ts
//
//

// What the internal helpers `--pi-hook` and `--pi-steward` read: one
// request on stdin, never more than its contract's limit.

// The text of at most `cap` bytes, or null past them, read no further.
export async function readBounded(
    input: ReadableStream<Uint8Array>,
    cap: number,
): Promise<string | null> {
    const parts: Uint8Array[] = [];
    let size = 0;
    const reader = input.getReader();
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > cap) return null;
            parts.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return Buffer.concat(parts).toString("utf8");
}
