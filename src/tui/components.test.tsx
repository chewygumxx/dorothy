// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/components.test.tsx
//
//

import { describe, expect, it } from "bun:test";
import { Box } from "ink";
import { render } from "ink-testing-library";
import { DEFAULT_CONFIG } from "../config.js";
import type { TurnStats } from "../conversation.js";
import { Header, Statusline, shortId, Warnings } from "./Header.js";
import { cutToWidth, History, LineView } from "./History.js";
import { LiveReply, wrapRows } from "./LiveReply.js";
import { describeRaw, RawPane } from "./RawPane.js";

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

describe("Header", () => {
    it("shows phrase, model, short SDK id and status", () => {
        const { lastFrame } = render(
            <Header
                phrase="tumble-orchid-vapor-lantern"
                model="test-model"
                sdkSessionId="3f2a0000-0000-0000-0000-000000000c91"
                status="ready"
            />,
        );
        const frame = lastFrame() ?? "";
        expect(frame).toContain("tumble-orchid-vapor-lantern");
        expect(frame).toContain("test-model");
        expect(frame).toContain("sdk 3f2a…c91");
        expect(frame).toContain("ready");
    });

    it("keeps to one row however narrow the window", () => {
        const { lastFrame } = render(
            <Box width={40}>
                <Header
                    phrase="tumble-orchid-vapor-lantern"
                    model="claude-sonnet-5-5"
                    sdkSessionId="3f2a0000-0000-0000-0000-000000000c91"
                    status="disconnected"
                />
            </Box>,
        );
        expect((lastFrame() ?? "").split("\n")).toHaveLength(1);
    });
});

describe("Warnings and Statusline", () => {
    it("shows each warning on one row of its own", () => {
        const lines = (
            render(
                <Warnings warnings={["no transcript", long("skipped")]} />,
            ).lastFrame() ?? ""
        ).split("\n");
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe("! no transcript");
        expect(lines[1]).toStartWith("! skipped skipped");
    });

    it("draws the statusline's rows and nothing without them", () => {
        expect(render(<Statusline rows={["a · b", "c"]} />).lastFrame()).toBe(
            "a · b\nc",
        );
        expect(render(<Warnings warnings={[]} />).lastFrame()).toBe("");
        expect(render(<Statusline rows={[]} />).lastFrame()).toBe("");
    });

    it("shortens long ids only", () => {
        expect(shortId("abc")).toBe("abc");
    });
});

describe("History and LiveReply", () => {
    it("renders a reply's Markdown, not its markers", () => {
        const { lastFrame } = render(
            <History
                lines={[
                    { id: 0, role: "you", text: "is **this** bold?" },
                    { id: 1, role: "dorothy", text: "Yes, **this** is." },
                ]}
                replyStats={DEFAULT_CONFIG.replyStats}
            />,
        );
        expect(lastFrame()).toContain("is **this** bold?");
        expect(lastFrame()).toContain("Yes, this is.");
    });

    it("shows the label of an empty reply", () => {
        const { lastFrame } = render(
            <History
                lines={[
                    { id: 0, role: "dorothy", text: "", interrupted: true },
                ]}
                replyStats={DEFAULT_CONFIG.replyStats}
            />,
        );
        expect(lastFrame()).toContain("dorothy");
        expect(lastFrame()).toContain("[interrupted]");
    });

    it("renders finished lines with stats and interruption", () => {
        const { lastFrame } = render(
            <History
                replyStats={DEFAULT_CONFIG.replyStats}
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
                replyStats={DEFAULT_CONFIG.replyStats}
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
            <History
                replyStats={DEFAULT_CONFIG.replyStats}
                lines={[{ id: 0, role: "dorothy", text }]}
            />,
        );
        expect(lastFrame()?.split("\n")[1]).toBe(`${" ".repeat(9)}next`);
    });

    it("draws reply stats in the configured order", () => {
        const { lastFrame } = render(
            <History
                lines={[
                    {
                        id: 0,
                        role: "dorothy",
                        text: "Hi",
                        stats,
                        chatCostUsd: 0.5,
                    },
                ]}
                replyStats={{
                    modules: ["chat-cost", "out", "in"],
                    maxLines: 1,
                }}
            />,
        );
        expect(lastFrame()).toContain(
            `${" ".repeat(9)}chat $0.5000 · 40 out · 12 in`,
        );
    });

    it("draws no stats row when no modules are configured", () => {
        const { lastFrame } = render(
            <History
                lines={[{ id: 0, role: "dorothy", text: "Hi", stats }]}
                replyStats={{ modules: [], maxLines: 1 }}
            />,
        );
        // Static ends its output with a newline.
        expect((lastFrame() ?? "").trimEnd().split("\n")).toHaveLength(1);
    });

    it("drops or overflows reply stats that do not fit", () => {
        // 94 columns of stats beside a 91-column reply.
        const lines = [{ id: 0, role: "dorothy" as const, text: "Hi", stats }];
        const one =
            render(
                <History
                    lines={lines}
                    replyStats={{ ...DEFAULT_CONFIG.replyStats, maxLines: 1 }}
                />,
            ).lastFrame() ?? "";
        expect(one).toContain("· $0.0012");
        expect(one).not.toContain("chat $");
        const two =
            render(
                <History
                    lines={lines}
                    replyStats={{ ...DEFAULT_CONFIG.replyStats, maxLines: 2 }}
                />,
            ).lastFrame() ?? "";
        expect(two.trimEnd().split("\n").at(-1)).toBe(
            `${" ".repeat(9)}chat $0.0034`,
        );
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

describe("lookup lines", () => {
    it("cuts to the width without splitting a character", () => {
        expect(cutToWidth("⌕ searched", 20)).toBe("⌕ searched");
        expect(cutToWidth('⌕ searched "render"', 10)).toBe("⌕ searche…");
        expect(cutToWidth("⌕ 日本語のテキスト", 8)).toBe("⌕ 日本…");
    });

    it("shows a lookup dim, unlabelled, with its purpose below", () => {
        const { lastFrame } = render(
            <LineView
                line={{
                    id: 0,
                    role: "lookup",
                    text: "⌕ opened Terminal rendering chaos",
                    detail: "for: the render bug",
                }}
                replyStats={DEFAULT_CONFIG.replyStats}
            />,
        );
        const frame = lastFrame() ?? "";
        expect(frame).toContain("⌕ opened Terminal rendering chaos");
        expect(frame).toContain("  for: the render bug");
        expect(frame).not.toContain("dorothy");
    });

    it("leaves a continued reply unlabelled", () => {
        const { lastFrame } = render(
            <LineView
                line={{
                    id: 0,
                    role: "dorothy",
                    text: "More.",
                    continued: true,
                }}
                replyStats={DEFAULT_CONFIG.replyStats}
            />,
        );
        expect(lastFrame()).not.toContain("dorothy");
    });

    it("draws no blank row for a continued reply with no text left", () => {
        const { lastFrame } = render(
            <LineView
                line={{
                    id: 0,
                    role: "dorothy",
                    text: "",
                    continued: true,
                    stats,
                }}
                replyStats={DEFAULT_CONFIG.replyStats}
            />,
        );
        const frame = lastFrame() ?? "";
        expect(frame).toContain("12 in · 3000 cache read");
        expect(frame.split("\n")[0]).toContain("12 in");
    });

    it("still marks an interrupted reply with no text left", () => {
        const { lastFrame } = render(
            <LineView
                line={{
                    id: 0,
                    role: "dorothy",
                    text: "",
                    continued: true,
                    interrupted: true,
                }}
                replyStats={DEFAULT_CONFIG.replyStats}
            />,
        );
        expect(lastFrame()).toContain("[interrupted]");
        expect(lastFrame()).not.toContain("dorothy");
    });
});
