// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/run-app.test.tsx
//
//

import { describe, expect, it } from "bun:test";
import type { ChatSession } from "@dorothy/core";
import type { ReactElement } from "react";
import { App } from "./App.js";
import { runApp } from "./run-app.js";

const session: ChatSession = {
    subscribe: () => () => {},
    send: () => {},
    interrupt: async () => {},
    close: async () => {},
};

// Renders nothing; keeps the tree, and counts the waits for an exit.
function recorder() {
    const shown: ReactElement[] = [];
    let waits = 0;
    const first = () => {
        const tree = shown[0];
        if (tree === undefined) {
            throw new Error("nothing was rendered");
        }
        return tree;
    };
    return {
        first,
        props: () => first().props as Props,
        waits: () => waits,
        render: (tree: ReactElement) => {
            shown.push(tree);
            return {
                waitUntilExit: async () => {
                    waits++;
                },
            };
        },
    };
}

type Props = { phrase: string; editDraft: unknown };

describe("runApp", () => {
    it("renders App with its props and waits for it to exit", async () => {
        const io = recorder();
        await runApp(
            {
                phrase: "tumble-orchid-vapor-lantern",
                history: [],
                createSession: () => session,
            },
            io,
        );
        expect(io.first().type).toBe(App);
        expect(io.props().phrase).toBe("tumble-orchid-vapor-lantern");
        expect(typeof io.props().editDraft).toBe("function");
        expect(io.waits()).toBe(1);
    });

    it("opens drafts in the editor it is given", async () => {
        const io = recorder();
        const editDraft = async (text: string) => ({ ok: true, text }) as const;
        await runApp(
            {
                phrase: "tumble-orchid-vapor-lantern",
                history: [],
                createSession: () => session,
                editDraft,
            },
            io,
        );
        expect(io.props().editDraft).toBe(editDraft);
    });
});
