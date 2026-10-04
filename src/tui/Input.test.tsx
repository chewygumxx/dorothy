// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/Input.test.tsx
//
//

import { describe, expect, it } from "bun:test";
import { render } from "ink-testing-library";
import { useState } from "react";
import { type Draft, EMPTY_DRAFT } from "./editor.js";
import { cleanPaste, type EditorMemory, Input, KEY_HINTS } from "./Input.js";

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const COLUMNS = 100;
const freshMemory = (): EditorMemory => ({
    killed: "",
    goal: null,
    recall: null,
});
const widest = (frame = "") =>
    Math.max(...frame.split("\n").map((line) => Array.from(line).length));

function Harness({
    canSend = true,
    messages = [],
    maxRows = 5,
    submitted,
    ctrls = [],
}: {
    canSend?: boolean;
    messages?: string[];
    maxRows?: number;
    submitted: string[];
    ctrls?: string[];
}) {
    const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
    const [memory] = useState(freshMemory);
    return (
        <Input
            draft={draft}
            messages={messages}
            canSend={canSend}
            maxRows={maxRows}
            memory={memory}
            onChange={setDraft}
            onCtrl={(letter) => ctrls.push(letter)}
            onSubmit={(text) => {
                submitted.push(text);
                setDraft(EMPTY_DRAFT);
            }}
        />
    );
}

function setup(props: Partial<Parameters<typeof Harness>[0]> = {}) {
    const submitted: string[] = [];
    const ctrls: string[] = [];
    const app = render(
        <Harness submitted={submitted} ctrls={ctrls} {...props} />,
    );
    const keys = async (...chunks: string[]) => {
        for (const chunk of chunks) {
            app.stdin.write(chunk);
            await tick();
        }
    };
    return {
        app,
        submitted,
        ctrls,
        keys,
        frame: () => app.lastFrame() ?? "",
    };
}

const LEFT = "\u001B[D";
const UP = "\u001B[A";
const DOWN = "\u001B[B";
const SHIFT_ENTER = "\u001B[13;2u";

describe("Input", () => {
    it("edits and submits", async () => {
        const { keys, frame, submitted } = setup();
        await keys("hi");
        expect(frame()).toContain("› hi▏");
        await keys("\u007F", "\r");
        expect(submitted).toEqual(["h"]);
    });

    it("shows the key hints only while empty", async () => {
        const { keys, frame } = setup();
        expect(frame()).toContain(KEY_HINTS.slice(0, 40));
        await keys("x");
        expect(frame()).not.toContain("enter send");
    });

    it("inserts a newline on Shift+Enter and sends on Enter", async () => {
        const { keys, frame, submitted } = setup();
        await keys("a", SHIFT_ENTER, "b");
        expect(frame()).toContain("› a\n  b▏");
        await keys("\r");
        expect(submitted).toEqual(["a\nb"]);
    });

    it("keeps the draft when it cannot send", async () => {
        const { keys, frame, submitted } = setup({ canSend: false });
        await keys("hi", "\r");
        expect(submitted).toEqual([]);
        expect(frame()).toContain("› hi▏");
    });

    it("moves the cursor and inserts there", async () => {
        const { keys, frame } = setup();
        await keys("abc", LEFT, LEFT, "X");
        expect(frame()).toContain("› aXbc");
        await keys("\u001B[H", "<", "\u001B[F", ">");
        expect(frame()).toContain("› <aXbc>▏");
    });

    it("moves by words and to line ends with readline keys", async () => {
        const { keys, frame } = setup();
        await keys("one two", "\u0001", "[", "\u0005", "]");
        expect(frame()).toContain("› [one two]▏");
        await keys("\u001Bb", "_");
        expect(frame()).toContain("› [one _two]");
        await keys("\u001B[1;5D", "^", "\u0002", "\u0006", "\u0006");
        expect(frame()).toContain("› [one ^_two]");
    });

    it("kills and yanks", async () => {
        const { keys, frame } = setup();
        await keys("one two", "\u0017");
        expect(frame()).toContain("› one ▏");
        await keys("\u0019");
        expect(frame()).toContain("› one two▏");
        await keys("\u001B\u007F");
        expect(frame()).toContain("› one ▏");
        await keys("\u0001", "\u000B");
        expect(frame()).toContain(KEY_HINTS.slice(0, 20));
        await keys("ab", LEFT, "\u0015");
        expect(frame()).toContain("› b");
    });

    it("deletes forward with Delete and Ctrl+D", async () => {
        const { keys, frame } = setup();
        await keys("abc", LEFT, LEFT, "\u001B[3~");
        expect(frame()).toContain("› ac");
        await keys("\u0004");
        expect(frame()).toContain("› a▏");
    });

    it("submits an Enter typed ahead in the same chunk", async () => {
        const { keys, frame, submitted } = setup();
        await keys("one\rtwo");
        expect(submitted).toEqual(["one"]);
        expect(frame()).toContain("› two▏");
    });

    it("sends only a chunk's first Enter, starting new lines after", async () => {
        const { keys, frame, submitted } = setup();
        await keys("one\rtwo\rthree");
        expect(submitted).toEqual(["one"]);
        expect(frame()).toContain("› two\n  three▏");
    });

    it("starts a new line for an Enter typed ahead while it cannot send", async () => {
        const { keys, frame, submitted } = setup({ canSend: false });
        await keys("one\rtwo");
        expect(submitted).toEqual([]);
        expect(frame()).toContain("› one\n  two▏");
    });

    it("acts on Ctrl keys typed in the same chunk as text", async () => {
        const { keys, submitted } = setup();
        await keys("hello\u0001X\u0005!\r");
        expect(submitted).toEqual(["Xhello!"]);
    });

    it("clears on Ctrl+C, leaving the rest of Ctrl+C and D to App", async () => {
        const { keys, frame, ctrls } = setup();
        await keys("abc\u0003");
        expect(frame()).toContain(KEY_HINTS);
        await keys("\u0003", "\u0004", "ab\u0007\u0012");
        expect(ctrls).toEqual(["c", "d", "g", "r"]);
        expect(frame()).toContain("› ab▏");
    });

    it("leaves Ctrl+C to App while it cannot send", async () => {
        const { keys, frame, ctrls } = setup({ canSend: false });
        await keys("abc", "\u0003");
        expect(ctrls).toEqual(["c"]);
        expect(frame()).toContain("› abc▏");
    });

    it("applies every key of a single chunk", async () => {
        const { keys, frame } = setup();
        await keys("hello\u007F\u007F\u007F");
        expect(frame()).toContain("› he▏");
    });

    it("removes a whole composite emoji on backspace", async () => {
        const { keys, frame } = setup();
        await keys("a👩‍💻", "\u007F");
        expect(frame()).toContain("› a▏");
    });

    it("pastes as one edit, with newlines and without control characters", async () => {
        const { keys, frame, submitted } = setup();
        await keys("\u001B[200~one\r\ntwo\tthree\u001B[2J\u001B[201~");
        expect(frame()).toContain("› one\n  two    three▏");
        expect(submitted).toEqual([]);
        expect(cleanPaste("a\rb\u0007")).toBe("a\nb");
    });

    it("drops whole escape sequences and C1 controls from a paste", () => {
        expect(cleanPaste("a\u001B[1;31mb\u001B[0m")).toBe("ab");
        expect(cleanPaste("a\u001B]0;title\u0007b")).toBe("ab");
        expect(cleanPaste("a\u001B]8;;url\u001B\\b")).toBe("ab");
        expect(cleanPaste("a\u009B2Jb\u0085c")).toBe("abc");
        expect(cleanPaste("a\u001BOPb\u001B7c")).toBe("abc");
        expect(cleanPaste("é ü 日本")).toBe("é ü 日本");
    });

    it("recalls earlier messages past the first row, restoring the draft", async () => {
        const { keys, frame } = setup({ messages: ["first", "second"] });
        await keys("wip", UP);
        expect(frame()).toContain("› second▏");
        await keys(UP);
        expect(frame()).toContain("› first▏");
        await keys(DOWN, DOWN);
        expect(frame()).toContain("› wip▏");
    });

    it("moves between rows of a draft before recalling", async () => {
        const { keys, submitted } = setup({ messages: ["old"] });
        await keys("ab", SHIFT_ENTER, "c", UP, "X", "\r");
        expect(submitted).toEqual(["aXb\nc"]);
    });

    it("moves between rows of a recalled message before recalling on", async () => {
        const { keys, frame } = setup({ messages: ["first", "one\ntwo"] });
        await keys(UP);
        expect(frame()).toContain("› one\n  two▏");
        await keys(UP);
        expect(frame()).toContain("› one▏\n  two");
        await keys(DOWN);
        expect(frame()).toContain("› one\n  two▏");
        await keys(UP, UP);
        expect(frame()).toContain("› first▏");
        await keys(DOWN);
        expect(frame()).toContain("› one\n  two▏");
    });

    it("scrolls a tall draft, marking hidden rows", async () => {
        const { keys, frame } = setup({ maxRows: 3 });
        const lines = Array.from({ length: 6 }, (_, index) => `l${index}`);
        await keys(lines.join(SHIFT_ENTER));
        expect(frame()).toContain("↑ l3\n  l4\n  l5▏");
        await keys(UP, UP, UP, UP, UP);
        expect(frame()).toContain("› l0▏\n  l1\n↓ l2");
    });

    it("wraps a draft within the terminal at every width, length and cursor", async () => {
        const text = "lorem ipsum dolor ".repeat(12);
        const props = {
            messages: [],
            canSend: true,
            maxRows: 50,
            memory: freshMemory(),
            onChange() {},
            onSubmit() {},
            onCtrl() {},
        };
        for (const columns of [40, COLUMNS]) {
            const { rerender, lastFrame, stdout } = render(
                <Input draft={EMPTY_DRAFT} {...props} />,
            );
            Object.defineProperty(stdout, "columns", {
                value: columns,
                configurable: true,
            });
            stdout.emit("resize");
            await tick();
            // Ink cuts a row too wide for the terminal short with an
            // ellipsis, so a draft row that does not fit shows one.
            for (let length = 1; length <= text.length; length += 7) {
                for (const cursor of [0, Math.floor(length / 2), length]) {
                    rerender(
                        <Input
                            draft={{ text: text.slice(0, length), cursor }}
                            {...props}
                        />,
                    );
                    const frame = lastFrame() ?? "";
                    expect([
                        columns,
                        length,
                        cursor,
                        frame.includes("…"),
                    ]).toEqual([columns, length, cursor, false]);
                    expect(widest(frame)).toBeLessThanOrEqual(columns);
                }
            }
            // A cursor after a full row takes the column kept for it.
            for (let length = 1; length <= 2 * columns; length++) {
                const full = "x".repeat(length);
                rerender(
                    <Input draft={{ text: full, cursor: length }} {...props} />,
                );
                expect([columns, length, lastFrame()?.includes("…")]).toEqual([
                    columns,
                    length,
                    false,
                ]);
            }
        }
    });
});
