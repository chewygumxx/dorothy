// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/tui/src/run-app.tsx
//
//

// The chat on the terminal: App rendered until it exits. The draft opens
// in $EDITOR unless another editor is given.

import { render } from "ink";
import type { ReactElement } from "react";
import { App, type AppProps } from "./App.js";
import { editInEditor } from "./external-editor.js";

export type RunAppOptions = Omit<AppProps, "editDraft"> & {
    editDraft?: AppProps["editDraft"];
};

type Rendered = { waitUntilExit(): Promise<unknown> };

export async function runApp(
    { editDraft = (text) => editInEditor(text), ...props }: RunAppOptions,
    {
        render: show = (tree: ReactElement): Rendered =>
            // Kitty-protocol terminals report Shift+Enter apart from
            // Enter.
            render(tree, {
                exitOnCtrlC: false,
                kittyKeyboard: { mode: "auto" },
            }),
    }: { render?: (tree: ReactElement) => Rendered } = {},
): Promise<void> {
    await show(<App {...props} editDraft={editDraft} />).waitUntilExit();
}
