// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/contract/tools.ts
//
//

// The contract's four MCP tools, the same in every host: brief, search,
// open and remember. A call's project is its own argument, else the
// connection's, else none.

import {
    CONTRACT_SERVER_NAME,
    type MemoryOpenInput,
    type MemoryScope,
    parseMemoryId,
} from "@dorothy/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { MemoryEngine, Within } from "../engine/engine.js";
import type { FactStore } from "../facts/store.js";
import { openConversation, openFact, RecallError } from "../recall/query.js";
import type { RecallIndex } from "../recall/store.js";
import { buildBlock } from "./block.js";
import { ContractError } from "./errors.js";
import { contractRemember } from "./remember.js";
import {
    briefShape,
    openShape,
    rememberShape,
    searchShape,
} from "./schemas.js";

export const INSTRUCTIONS = [
    "Dorothy's memory. If no memory block opened this session, call brief",
    "first. search finds what she knows and past conversations; open reads",
    "one whole; remember adds, revises or retires a piece of knowledge.",
].join(" ");
export const BRIEF_BUDGET = 8000;
const SEARCH_DEFAULT = 10;
const PURPOSE = "read through the memory contract";

const BRIEF_DESCRIPTION =
    "What Dorothy remembers of the user and this project, then notes on earlier conversations, within budget characters (8000 by default). Call it first where no memory block opened the session.";
const SEARCH_DESCRIPTION =
    "Search her knowledge and past conversations by their words. scope is project, personal or all (by default personal and this project); kind is knowledge, episodes or all; after and before are dates; limit is 1 to 20.";
const OPEN_DESCRIPTION =
    "Open a piece of knowledge (k:...) whole, or a conversation (c:...) from turn from as far as through, word for word.";
const REMEMBER_DESCRIPTION =
    "Keep a piece of knowledge: add with title, text, type (user, feedback, project or reference) and scope (personal or project); revise one by id with title, text and type; retire one by id with why. What the user or a repository wrote cannot be changed.";

export type ToolDeps = {
    engine: MemoryEngine;
    index: RecallIndex;
    store: FactStore;
    // The connection's project and host; null when none is known.
    project: string | null;
    host: string | null;
    // A tool's project argument, an id or a path, as a project's id.
    resolveProject: (value: string) => Promise<string | null>;
};

export function withinOf(
    scope: MemoryScope | undefined,
    project: string | null,
): Within {
    if (scope === "all") {
        return "all";
    }
    if (scope === "personal") {
        return ["personal"];
    }
    if (scope === "project") {
        if (project === null) {
            throw new ContractError(
                400,
                "there is no project here: use personal or all",
            );
        }
        return [project];
    }
    return project === null ? ["personal"] : ["personal", project];
}

const messageOf = (error: unknown) =>
    error instanceof ContractError || error instanceof RecallError
        ? error.message
        : `Memory failed: ${error instanceof Error ? error.message : String(error)}`;

async function openId(
    input: MemoryOpenInput,
    deps: ToolDeps,
): Promise<unknown> {
    const id = parseMemoryId(input.id);
    if (id === null) {
        throw new ContractError(
            400,
            `${input.id} is not a memory id: k:... or c:...`,
        );
    }
    await deps.engine.index();
    if (id.kind === "knowledge") {
        const fact = id.path.startsWith("personal/")
            ? id.path
            : id.path.slice("projects/".length);
        const opened = await deps.index.exclusive(() =>
            openFact(deps.index, { fact, purpose: PURPOSE }, deps.store.root),
        );
        // The contract's id, not recall's.
        return { ...opened, id: input.id };
    }
    const opened = await deps.index.exclusive(() =>
        openConversation(
            deps.index,
            { conversation: id.phrase, purpose: PURPOSE, turn: input.from },
            { exclude: null },
        ),
    );
    const { through } = input;
    return through === undefined
        ? opened
        : {
              ...opened,
              window: opened.window.filter((turn) => turn.turn <= through),
          };
}

export function createContractServer(deps: ToolDeps): McpServer {
    const server = new McpServer(
        { name: CONTRACT_SERVER_NAME, version: "1.0.0" },
        { instructions: INSTRUCTIONS },
    );
    const projectOf = async (value: string | undefined) =>
        value === undefined ? deps.project : deps.resolveProject(value);
    const answer = async (work: () => Promise<unknown>) => {
        try {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(await work()),
                    },
                ],
            };
        } catch (error) {
            return {
                isError: true,
                content: [{ type: "text" as const, text: messageOf(error) }],
            };
        }
    };
    server.registerTool(
        "brief",
        { description: BRIEF_DESCRIPTION, inputSchema: briefShape },
        (input) =>
            answer(async () =>
                buildBlock(
                    {
                        project: await projectOf(input.project),
                        budget: input.budget ?? BRIEF_BUDGET,
                    },
                    deps.engine,
                ),
            ),
    );
    server.registerTool(
        "search",
        { description: SEARCH_DESCRIPTION, inputSchema: searchShape },
        (input) =>
            answer(async () => {
                const project = await projectOf(input.project);
                return deps.engine.search({
                    query: input.query,
                    within: withinOf(input.scope, project),
                    kind: input.kind ?? "all",
                    after: input.after,
                    before: input.before,
                    limit: input.limit ?? SEARCH_DEFAULT,
                    project,
                });
            }),
    );
    server.registerTool(
        "open",
        { description: OPEN_DESCRIPTION, inputSchema: openShape },
        (input) => answer(() => openId(input, deps)),
    );
    server.registerTool(
        "remember",
        { description: REMEMBER_DESCRIPTION, inputSchema: rememberShape },
        (input) =>
            answer(async () =>
                contractRemember(input, {
                    store: deps.store,
                    project: await projectOf(input.project),
                    host: deps.host,
                    from: null,
                }),
            ),
    );
    return server;
}
