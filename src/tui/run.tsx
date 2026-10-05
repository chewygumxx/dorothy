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
import { indexCatalogue } from "../memory/catalogue.js";
import { MemoryService } from "../memory/service.js";
import { trackMemory } from "../memory/track.js";
import { promptSha256 } from "../persona.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { newPhrase } from "../session-id.js";
import {
    type ResumedTurn,
    readTranscript,
    TranscriptWriter,
    transcriptDir,
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

    // The index is opened before the first session, whose prompt carries
    // the block; without it, the chat starts without memory.
    let index: RecallIndex | null = null;
    if (config.memory.enabled) {
        try {
            index = RecallIndex.open(indexPath());
        } catch (error) {
            warnings.push(
                `memory: the index can't be opened (${describeError(error)}); starting without memory`,
            );
        }
    }
    let memory: MemoryService | null = null;
    if (config.memory.enabled && index !== null) {
        const dir = transcriptDir();
        const loaded = await indexCatalogue(index, dir).load();
        warnings.push(...loaded.warnings);
        const transcript = writer;
        memory = new MemoryService({
            dir,
            phrase,
            history,
            config: config.memory,
            entries: loaded.entries,
            index,
            // Without a transcript the live chat is left alone.
            flushed: transcript === null ? null : () => transcript.flushed(),
        });
        warnings.push(...memory.warnings());
    }

    const app = render(
        <App
            phrase={phrase}
            promptSha256={promptSha256()}
            history={history}
            editDraft={(text) => editInEditor(text)}
            createSession={(turns) => {
                const conversation = new Conversation({
                    history: turns,
                    memory: memory?.block() ?? "",
                });
                conversation.start();
                return memory === null
                    ? conversation
                    : trackMemory(conversation, memory);
            }}
            notices={memory ?? undefined}
            transcript={writer}
            initialWarnings={warnings}
            initialCostUsd={costUsd}
            config={config}
        />,
        // Kitty-protocol terminals report Shift+Enter apart from Enter.
        { exitOnCtrlC: false, kittyKeyboard: { mode: "auto" } },
    );
    try {
        await app.waitUntilExit();
    } finally {
        // Quitting waits for no review: the running one is closed unsaved.
        memory?.stop();
        index?.close();
        await writer?.close();
    }
    return 0;
}
