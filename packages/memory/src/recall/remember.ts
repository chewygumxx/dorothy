// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/recall/remember.ts
//
//

// remember: Dorothy's own way to write, correct and retire a fact. She
// writes as dorothy, with dorothy as origin, never higher; a fact the
// user or a repository wrote is refused, as is reviving one by writing,
// and she says why. The checks are made under the store's lock.

import type { RememberInput, RememberResult } from "@dorothy/core";
import { FACT_NAME, FACT_TYPES, type FactType } from "../facts/file.js";
import {
    type FactResult,
    type FactStore,
    type Guard,
    PERSONAL,
    retireFact,
    type Scope,
    scopeLabel,
    writeFact,
} from "../facts/store.js";
import { normalise } from "../memory/sidecar.js";
import { RecallError } from "./query.js";

export type RememberOptions = {
    // The server's project id, for scope "project"; null outside one.
    project: string | null;
    // The conversation she remembers in, where the server knows it.
    from: string | null;
};

const WRITTEN_BY = { user: "the user's", repo: "the repository's" } as const;

function scopeOf(scope: string, project: string | null): Scope {
    if (scope === "personal") {
        return PERSONAL;
    }
    if (scope !== "project") {
        throw new RecallError("scope must be personal or project.");
    }
    if (project === null) {
        throw new RecallError(
            "There is no project here: this session is not in a git repository. Use personal.",
        );
    }
    return { kind: "project", id: project };
}

const refused = (result: FactResult, id: string): never => {
    if (result.kind === "missing") {
        throw new RecallError(`There is no fact ${id}.`);
    }
    throw new RecallError(
        result.kind === "refused" || result.kind === "failed"
            ? result.reason
            : `${id} was not written.`,
    );
};

export async function remember(
    store: FactStore,
    input: RememberInput,
    { project, from }: RememberOptions,
): Promise<RememberResult> {
    const scope = scopeOf(input.scope, project);
    if (!FACT_NAME.test(input.name)) {
        throw new RecallError(
            `${input.name} is not a fact's name: lower case words joined by hyphens, like tea-at-four.`,
        );
    }
    const id = `${scopeLabel(scope)}/${input.name}`;
    const writing = input.action === "write";
    let existed = false;
    const guard: Guard = (current) => {
        existed = current !== null;
        if (current === null) {
            return null;
        }
        const origin = current.provenance.origin;
        if (origin === "user" || origin === "repo") {
            return `${id} is ${WRITTEN_BY[origin]}: you cannot change it. Tell the user what you would change instead.`;
        }
        if (writing && current.retired !== null) {
            return `${id} is retired: writing does not revive it. Ask the user to revive it, or use another name.`;
        }
        return null;
    };
    if (input.action === "retire") {
        const why = normalise(input.why ?? "");
        if (why === "") {
            throw new RecallError("Say in why the fact no longer serves.");
        }
        const result = await retireFact(
            store,
            { scope, name: input.name },
            { by: "dorothy", why, guard },
        );
        if (result.kind === "written") {
            return { action: "retired", id };
        }
        if (result.kind === "unchanged") {
            return { action: "unchanged", id };
        }
        return refused(result, id);
    }
    if (input.action !== "write") {
        throw new RecallError("action must be write or retire.");
    }
    if (!(FACT_TYPES as readonly string[]).includes(input.type ?? "")) {
        throw new RecallError(`type must be one of ${FACT_TYPES.join(", ")}.`);
    }
    const [title, description, body] = [
        input.title,
        input.description,
        input.body,
    ].map((text) => (text ?? "").trim());
    if (title === "" || description === "" || body === "") {
        throw new RecallError("Give the fact's title, description and body.");
    }
    const result = await writeFact(
        store,
        {
            scope,
            name: input.name,
            title: title as string,
            description: description as string,
            type: input.type as FactType,
            body: body as string,
            origin: "dorothy",
            by: "dorothy",
            ...(from === null ? {} : { from }),
        },
        guard,
    );
    if (result.kind === "written") {
        return { action: existed ? "corrected" : "written", id };
    }
    return refused(result, id);
}
