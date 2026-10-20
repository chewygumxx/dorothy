// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/remember.ts
//
//

// remember through the contract: add, revise or retire one piece of
// knowledge by its id. A model writes as dorothy, its host named in the
// provenance; what the user or a repository wrote is refused, as
// remember refuses it today.

import {
    HOST_ID,
    knowledgeId,
    type MemoryRememberInput,
    type MemoryRememberResult,
    parseMemoryId,
} from "@dorothy/core";
import { knowledgePath } from "../engine/engine.js";
import { FACT_LIMITS, FACT_NAME } from "../facts/file.js";
import {
    type FactResult,
    type FactStore,
    type Guard,
    isProjectId,
    PERSONAL,
    retireFact,
    type Scope,
    writeFact,
} from "../facts/store.js";
import { normalise } from "../memory/sidecar.js";
import { guardFor } from "../recall/remember.js";
import { ContractError } from "./errors.js";

export type RememberDeps = {
    store: FactStore;
    project: string | null;
    host: string | null;
    from: string | null;
    // Where a store failure's reason goes, which may name a path and so
    // never reaches the caller.
    warn?: ((message: string) => void) | undefined;
};

type Target = { scope: Scope; name: string; id: string };

const trimmed = (slug: string) =>
    slug.slice(0, FACT_LIMITS.name).replace(/-+$/, "");

export function nameOf(title: string): string {
    const slug = trimmed(
        title
            .normalize("NFKD")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, ""),
    );
    const named = /^[a-z]/.test(slug) ? slug : trimmed(`note-${slug}`);
    return FACT_NAME.test(named) ? named : "note";
}

export function descriptionOf(text: string): string {
    const flat = normalise(text);
    const sentence = /^.*?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat;
    if ([...sentence].length <= FACT_LIMITS.description) {
        return sentence;
    }
    const cut = [...sentence].slice(0, FACT_LIMITS.description - 4).join("");
    const space = cut.lastIndexOf(" ");
    return `${space > 0 ? cut.slice(0, space) : cut} ...`;
}

function targetOf(id: string | undefined, project: string | null): Target {
    const parsed = id === undefined ? null : parseMemoryId(id);
    if (parsed === null || parsed.kind !== "knowledge") {
        throw new ContractError(400, "give the knowledge's id, k:...");
    }
    const name = parsed.path.split("/").at(-1) as string;
    if (parsed.path.startsWith("personal/")) {
        return { scope: PERSONAL, name, id: id as string };
    }
    const owner = parsed.path.slice("projects/".length, -(name.length + 1));
    if (!isProjectId(owner)) {
        throw new ContractError(400, `${id} names no project`);
    }
    if (owner !== project) {
        throw new ContractError(403, `${id} is another project's knowledge`);
    }
    return { scope: { kind: "project", id: owner }, name, id: id as string };
}

function newTarget(
    scope: "personal" | "project" | undefined,
    title: string,
    project: string | null,
): Target {
    if (scope === undefined) {
        throw new ContractError(400, "give its scope: personal or project");
    }
    if (scope === "project" && project === null) {
        throw new ContractError(
            400,
            "there is no project here: this session is in no repository; use personal",
        );
    }
    const where: Scope =
        scope === "personal"
            ? PERSONAL
            : { kind: "project", id: project as string };
    const name = nameOf(title);
    return { scope: where, name, id: knowledgeId(knowledgePath(where, name)) };
}

function settle(
    result: FactResult,
    id: string,
    done: MemoryRememberResult["status"],
    warn: RememberDeps["warn"],
): MemoryRememberResult {
    switch (result.kind) {
        case "written":
            return { id, status: done };
        case "unchanged":
            return { id, status: "unchanged" };
        case "missing":
            throw new ContractError(404, `there is no ${id}`);
        case "refused":
            throw new ContractError(409, result.reason);
        default:
            warn?.(`remember of ${id} failed: ${result.reason}`);
            throw new ContractError(500, "Memory failed.");
    }
}

export async function contractRemember(
    input: MemoryRememberInput,
    deps: RememberDeps,
): Promise<MemoryRememberResult> {
    if (input.action === "retire") {
        const target = targetOf(input.id, deps.project);
        const why = normalise(input.why ?? "");
        if (why === "") {
            throw new ContractError(400, "say in why it no longer serves");
        }
        if ([...why].length > FACT_LIMITS.why) {
            throw new ContractError(
                400,
                `the reason is over ${FACT_LIMITS.why} characters`,
            );
        }
        const result = await retireFact(
            deps.store,
            { scope: target.scope, name: target.name },
            { by: "dorothy", why, guard: guardFor(target.id, false, () => {}) },
        );
        return settle(result, target.id, "retired", deps.warn);
    }
    // The host lands in the fact's provenance, which parsing accepts
    // only in this form; a retire writes none.
    if (deps.host !== null && !HOST_ID.test(deps.host)) {
        throw new ContractError(400, "host is not a profile's name");
    }
    const title = normalise(input.title ?? "");
    const text = (input.text ?? "").trim();
    if (title === "" || text === "") {
        throw new ContractError(400, "give the knowledge's title and text");
    }
    if ([...title].length > FACT_LIMITS.title) {
        throw new ContractError(
            400,
            `the title is over ${FACT_LIMITS.title} characters`,
        );
    }
    if ([...text].length > FACT_LIMITS.body) {
        throw new ContractError(
            400,
            `the text is over ${FACT_LIMITS.body} characters`,
        );
    }
    if (input.type === undefined) {
        throw new ContractError(
            400,
            "give its type: user, feedback, project or reference",
        );
    }
    const adding = input.action === "add";
    const target = adding
        ? newTarget(input.scope, title, deps.project)
        : targetOf(input.id, deps.project);
    const guard: Guard = adding
        ? (current) =>
              current === null ? null : `${target.id} exists: revise it`
        : (current) =>
              current === null
                  ? `there is no ${target.id}`
                  : guardFor(target.id, true, () => {})(current);
    const result = await writeFact(
        deps.store,
        {
            scope: target.scope,
            name: target.name,
            title,
            description: descriptionOf(text),
            type: input.type,
            body: text,
            origin: "dorothy",
            by: "dorothy",
            ...(deps.host === null ? {} : { host: deps.host }),
            ...(deps.from === null ? {} : { from: deps.from }),
        },
        guard,
    );
    return settle(result, target.id, adding ? "added" : "revised", deps.warn);
}
