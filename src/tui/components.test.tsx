// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/components.test.tsx
//
//

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { useState } from "react";
import type { TurnStats } from "../conversation.js";
import { Header, shortId } from "./Header.js";
import { History } from "./History.js";
import { Input, inputRows, KEY_HINTS } from "./Input.js";
import { formatStats, LiveReply, wrapRows } from "./LiveReply.js";
import { describeRaw, RawPane } from "./RawPane.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
// ink-testing-library's stdout is this wide. A wider line wraps again in a
// real terminal, which Ink does not count when it erases the last frame.
const COLUMNS = 100;
const widest = (frame = "") =>
    Math.max(...frame.split("\n").map((line) => Array.from(line).length));
const long = (word: string) => `${word} `.repeat(40).trim();
const stats: TurnStats = {
    inputTokens: 12,
    cacheReadTokens: 3000,
    cacheWriteTokens: 400,
    outputTokens: 40,
    ttftMs: 900,
    durationMs: 2100,
    costUsd: 0.0012,
    sessionCostUsd: 0.0034,
};

describe("formatStats", () => {
    it("formats tokens, timings and the turn's and chat's cost", () => {
        expect(formatStats(stats, 0.005)).toBe(
            "12 in · 3000 cache read · 400 cache write · 40 out · ttft 0.9s · 2.1s · $0.0012 (chat $0.0050)",
        );
    });

    it("omits ttft and cache use when there is none", () => {
        const plain = { ...stats, ttftMs: null, cacheReadTokens: 0 };
        expect(formatStats({ ...plain, cacheWriteTokens: 0 }, 0)).toBe(
            "12 in · 40 out · 2.1s · $0.0012 (chat $0.0000)",
        );
    });
});

describe("Header", () => {
    it("shows phrase, model, short SDK id and status", () => {
        const { lastFrame } = render(
            <Header
                phrase="tumble-orchid-vapor-lantern"
                model="test-model"
                sdkSessionId="3f2a0000-0000-0000-0000-000000000c91"
                status="ready"
                warnings={[]}
            />,
        );
        const frame = lastFrame() ?? "";
        expect(frame).toContain("tumble-orchid-vapor-lantern");
        expect(frame).toContain("test-model");
        expect(frame).toContain("sdk 3f2a…c91");
        expect(frame).toContain("ready");
    });

    it("shows each warning on one row of its own", () => {
        const { lastFrame } = render(
            <Header
                phrase="p"
                model={null}
                sdkSessionId={null}
                status="starting"
                warnings={["no transcript", long("skipped")]}
            />,
        );
        const lines = (lastFrame() ?? "").split("\n");
        expect(lines).toHaveLength(3);
        expect(lines[1]).toBe("! no transcript");
        expect(lines[2]).toStartWith("! skipped skipped");
    });

    it("shortens long ids only", () => {
        expect(shortId("abc")).toBe("abc");
    });
});

describe("History and LiveReply", () => {
    it("renders finished lines with stats and interruption", () => {
        const { lastFrame } = render(
            <History
                lines={[
                    { id: 0, role: "you", text: "What is your name?" },
                    { id: 1, role: "dorothy", text: "I'm Dorothy!", stats },
                    { id: 2, role: "dorothy", text: "Well", interrupted: true },
                ]}
            />,
        );
        const frame = lastFrame() ?? "";
        expect(frame).toContain("What is your name?");
        expect(frame).toContain("I'm Dorothy!");
        expect(frame).toContain("12 in · 3000 cache read");
        expect(frame).toContain("Well [interrupted]");
    });

    it("wraps finished lines to the terminal width", () => {
        const { lastFrame } = render(
            <History
                lines={[{ id: 0, role: "dorothy", text: long("words") }]}
            />,
        );
        expect(lastFrame()).toContain("words");
        expect(widest(lastFrame())).toBeLessThanOrEqual(COLUMNS);
    });

    it("starts no wrapped row with the space it broke at", () => {
        // 9 columns of label, then 91 of text: the break falls on a space.
        const text = `${"x".repeat(91)} next`;
        const { lastFrame } = render(
            <History lines={[{ id: 0, role: "dorothy", text }]} />,
        );
        expect(lastFrame()?.split("\n")[1]).toBe(`${" ".repeat(9)}next`);
    });

    it("shows the live reply only while streaming", () => {
        expect(
            render(
                <LiveReply text="Hel" streaming width={80} maxRows={5} />,
            ).lastFrame(),
        ).toContain("Hel▍");
        expect(
            render(
                <LiveReply text="" streaming={false} width={80} maxRows={5} />,
            ).lastFrame(),
        ).toBe("");
    });
});

describe("wrapRows", () => {
    it("wraps at the last space that fits", () => {
        expect(wrapRows("hello world foo", 11)).toEqual(["hello world", "foo"]);
    });

    it("breaks words longer than the width", () => {
        expect(wrapRows("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    });

    it("keeps blank lines", () => {
        expect(wrapRows("a\n\nb", 10)).toEqual(["a", "", "b"]);
    });

    it("measures wide characters as two columns", () => {
        expect(wrapRows("你好世界", 5)).toEqual(["你好", "世界"]);
        expect(wrapRows("ab 你好", 5)).toEqual(["ab", "你好"]);
    });

    it("keeps a composite emoji whole", () => {
        expect(wrapRows("👩‍💻👩‍💻", 2)).toEqual(["👩‍💻", "👩‍💻"]);
    });

    it("expands tabs and drops control characters", () => {
        expect(wrapRows("a\tb\u0007\u001B[2J", 20)).toEqual(["a    b[2J"]);
    });
});

describe("LiveReply height", () => {
    it("shows only the last rows that fit, cursor included", () => {
        const text = Array.from({ length: 10 }, (_, i) => `line ${i}`).join(
            "\n",
        );
        const frame =
            render(
                <LiveReply text={text} streaming width={20} maxRows={3} />,
            ).lastFrame() ?? "";
        expect(frame.split("\n")).toHaveLength(3);
        expect(frame).toContain("line 9▍");
        expect(frame).toContain("line 7");
        expect(frame).not.toContain("line 6");
    });
});

describe("RawPane", () => {
    it("describes a text delta on one line", () => {
        const message = {
            type: "stream_event",
            event: {
                type: "content_block_delta",
                delta: { type: "text_delta", text: "whether" },
            },
        };
        expect(describeRaw(message)).toBe(
            'stream_event content_block_delta {"type":"text_delta","text":"whether"}',
        );
    });

    it("truncates long descriptions", () => {
        const message = {
            type: "system",
            subtype: "init",
            cwd: "x".repeat(300),
        };
        const line = describeRaw(message, 40);
        expect(line.startsWith("system init ")).toBe(true);
        expect(line).toHaveLength(40);
        expect(line.endsWith("…")).toBe(true);
    });

    it("renders its title and entries", () => {
        const message = {
            type: "system",
            subtype: "init",
        };
        const frame =
            render(<RawPane entries={[{ id: 0, message }]} />).lastFrame() ??
            "";
        expect(frame).toContain("raw (ctrl+r)");
        expect(frame).toContain("system init");
    });
});

function Harness({
    disabled = false,
    submitted,
}: {
    disabled?: boolean;
    submitted: string[];
}) {
    const [value, setValue] = useState("");
    return (
        <Input
            value={value}
            disabled={disabled}
            onChange={setValue}
            onSubmit={(text) => submitted.push(text)}
            maxRows={3}
        />
    );
}

describe("Input", () => {
    it("edits and submits the line", async () => {
        const submitted: string[] = [];
        const { stdin, lastFrame } = render(<Harness submitted={submitted} />);
        stdin.write("hi");
        await tick();
        expect(lastFrame()).toContain("› hi");
        stdin.write("\u007F");
        await tick();
        expect(lastFrame()).toContain("› h");
        stdin.write("\r");
        await tick();
        expect(submitted).toEqual(["h"]);
    });

    it("removes a whole emoji on backspace", async () => {
        const { stdin, lastFrame } = render(<Harness submitted={[]} />);
        stdin.write("a🐈");
        await tick();
        stdin.write("\u007F");
        await tick();
        expect(lastFrame()).toContain("› a");
        expect(lastFrame()).not.toContain("�");
    });

    it("applies every key of a single chunk, as a held Backspace sends", async () => {
        const { stdin, lastFrame } = render(<Harness submitted={[]} />);
        stdin.write("hello\u007F\u007F\u007F");
        await tick();
        expect(lastFrame()).toContain("› he▏");
    });

    it("keeps fast typing that shares a chunk with a Backspace", async () => {
        const { stdin, lastFrame } = render(<Harness submitted={[]} />);
        stdin.write("x");
        await tick();
        stdin.write("ab\u007F");
        await tick();
        expect(lastFrame()).toContain("› xa▏");
    });

    it("stays within the terminal width at every length", () => {
        const text = long("lorem");
        const props = {
            disabled: false,
            maxRows: 3,
            onChange() {},
            onSubmit() {},
        };
        const { rerender, lastFrame } = render(<Input value="" {...props} />);
        for (let length = 0; length <= text.length; length++) {
            rerender(<Input value={text.slice(0, length)} {...props} />);
            expect([length, widest(lastFrame())]).toEqual([
                length,
                Math.min(widest(lastFrame()), COLUMNS),
            ]);
        }
    });

    it("shows only the last rows of a tall draft, marking those hidden", () => {
        const props = { disabled: false, onChange() {}, onSubmit() {} };
        const value = "word ".repeat(200);
        const { lastFrame } = render(
            <Input value={value} maxRows={3} {...props} />,
        );
        const lines = (lastFrame() ?? "").split("\n");
        expect(lines).toHaveLength(3);
        expect(lines[0]).toStartWith("↑ word");
        expect(lines[1]).toStartWith("  word");
        expect(lines[2]).toContain("▏");
        expect(inputRows(value, COLUMNS)).toBe(11);
        expect(inputRows("", COLUMNS)).toBe(1);
    });

    it("shows the prompt on a draft's first row", () => {
        const props = { disabled: false, onChange() {}, onSubmit() {} };
        const { lastFrame } = render(
            <Input value="one" maxRows={3} {...props} />,
        );
        expect(lastFrame()).toBe("› one▏");
    });

    it("shows the key hints only while the line is empty", async () => {
        const { stdin, lastFrame } = render(<Harness submitted={[]} />);
        expect(lastFrame()).toContain(KEY_HINTS);
        stdin.write("hi");
        await tick();
        expect(lastFrame()).not.toContain(KEY_HINTS);
    });

    it("submits an Enter typed ahead in the same chunk", async () => {
        const submitted: string[] = [];
        const { stdin, lastFrame } = render(<Harness submitted={submitted} />);
        stdin.write("one\rtwo");
        await tick();
        expect(submitted).toEqual(["one"]);
        expect(lastFrame()).toContain("› two▏");
    });

    it("pastes on one line, without control characters", async () => {
        const submitted: string[] = [];
        const { stdin, lastFrame } = render(<Harness submitted={submitted} />);
        stdin.write("\u001B[200~one\r\ntwo\u0007\u001B[201~");
        await tick();
        expect(submitted).toEqual([]);
        expect(lastFrame()).toContain("› one two▏");
    });

    it("drops control characters from typed text", async () => {
        const { stdin, lastFrame } = render(<Harness submitted={[]} />);
        stdin.write("a\u0004\u0004b");
        await tick();
        expect(lastFrame()).toContain("› ab▏");
    });

    it("ignores typing and Enter while disabled", async () => {
        const submitted: string[] = [];
        const { stdin, lastFrame } = render(
            <Harness disabled submitted={submitted} />,
        );
        stdin.write("hi");
        await tick();
        stdin.write("\r");
        await tick();
        expect(lastFrame()).not.toContain("› hi");
        expect(submitted).toEqual([]);
    });
});
