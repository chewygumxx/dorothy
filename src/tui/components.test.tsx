// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/components.test.tsx
//
//

import { describe, expect, it } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { render } from "ink-testing-library";
import { useState } from "react";
import type { TurnStats } from "../conversation.js";
import { Header, shortId } from "./Header.js";
import { History } from "./History.js";
import { Input } from "./Input.js";
import { formatStats, LiveReply } from "./LiveReply.js";
import { describeRaw, RawPane } from "./RawPane.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const stats: TurnStats = {
    inputTokens: 12,
    outputTokens: 40,
    ttftMs: 900,
    durationMs: 2100,
    costUsd: 0.0012,
    sessionCostUsd: 0.0034,
};

describe("formatStats", () => {
    it("formats tokens, timings and cost", () => {
        expect(formatStats(stats)).toBe(
            "12 in · 40 out · ttft 0.9s · 2.1s · $0.0012 (session $0.0034)",
        );
    });

    it("omits ttft when unknown", () => {
        expect(formatStats({ ...stats, ttftMs: null })).not.toContain("ttft");
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
                warning={null}
            />,
        );
        const frame = lastFrame() ?? "";
        expect(frame).toContain("tumble-orchid-vapor-lantern");
        expect(frame).toContain("test-model");
        expect(frame).toContain("sdk 3f2a…c91");
        expect(frame).toContain("ready");
    });

    it("shows a warning when given one", () => {
        const { lastFrame } = render(
            <Header
                phrase="p"
                model={null}
                sdkSessionId={null}
                status="starting"
                warning="no transcript"
            />,
        );
        expect(lastFrame()).toContain("no transcript");
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
        expect(frame).toContain("12 in · 40 out");
        expect(frame).toContain("Well [interrupted]");
    });

    it("shows the live reply only while streaming", () => {
        expect(
            render(<LiveReply text="Hel" streaming />).lastFrame(),
        ).toContain("Hel▍");
        expect(
            render(<LiveReply text="" streaming={false} />).lastFrame(),
        ).toBe("");
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
        } as unknown as SDKMessage;
        expect(describeRaw(message)).toBe(
            'stream_event content_block_delta {"type":"text_delta","text":"whether"}',
        );
    });

    it("truncates long descriptions", () => {
        const message = {
            type: "system",
            subtype: "init",
            cwd: "x".repeat(300),
        } as unknown as SDKMessage;
        const line = describeRaw(message, 40);
        expect(line.startsWith("system init ")).toBe(true);
        expect(line).toHaveLength(40);
        expect(line.endsWith("…")).toBe(true);
    });

    it("renders its title and entries", () => {
        const message = {
            type: "system",
            subtype: "init",
        } as unknown as SDKMessage;
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
