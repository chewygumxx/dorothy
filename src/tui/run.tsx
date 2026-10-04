// vim:set expandtab shiftwidth=4 filetype=typescriptreact:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/src/tui/run.tsx
//
//

import { render } from "ink";
import { readConfig } from "../config.js";
import { Conversation } from "../conversation.js";
import { promptSha256 } from "../persona.js";
import { newPhrase } from "../session-id.js";
import {
    type ResumedTurn,
    readTranscript,
    TranscriptWriter,
    transcriptPath,
} from "../transcript.js";
import { App } from "./App.js";
import { editInEditor } from "./external-editor.js";

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

export async function runTui(resume: string | null): Promise<number> {
    const phrase = resume ?? newPhrase();
    const path = transcriptPath(phrase);
    let history: ResumedTurn[] = [];
    let costUsd = 0;
    const warnings: string[] = [];
    const { config, warnings: configWarnings } = await readConfig();
    warnings.push(...configWarnings);

    if (resume !== null) {
        try {
            const read = await readTranscript(path);
            history = read.turns;
            costUsd = read.costUsd;
            if (read.skipped > 0) {
                warnings.push(
                    `skipped ${read.skipped} malformed line(s) in ${path}`,
                );
            }
        } catch (error) {
            process.stderr.write(
                `dorothy: cannot resume ${resume}: ${path}: ${describeError(error)}\n`,
            );
            return 1;
        }
    }

    let writer: TranscriptWriter | null = null;
    try {
        writer = await TranscriptWriter.open(path);
    } catch (error) {
        warnings.push(`transcript not saved: ${describeError(error)}`);
    }

    const app = render(
        <App
            phrase={phrase}
            promptSha256={promptSha256()}
            history={history}
            editDraft={(text) => editInEditor(text)}
            createSession={(turns) => {
                const conversation = new Conversation({ history: turns });
                conversation.start();
                return conversation;
            }}
            transcript={writer}
            initialWarnings={warnings}
            initialCostUsd={costUsd}
            config={config}
        />,
        // Kitty-protocol terminals report Shift+Enter apart from Enter.
        { exitOnCtrlC: false, kittyKeyboard: { mode: "auto" } },
    );
    await app.waitUntilExit();
    await writer?.close();
    return 0;
}
