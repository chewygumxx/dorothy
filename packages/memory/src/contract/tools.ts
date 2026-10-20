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
// connection's, else none; open and remember keep to a connection's own.

import {
    CONTRACT_SERVER_NAME,
    type MemoryOpenInput,
    type MemoryScope,
    parseMemoryId,
} from "@dorothy/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { conversationProject } from "../engine/baseline.js";
import type { MemoryEngine, Within } from "../engine/engine.js";
import type { FactStore } from "../facts/store.js";
import type { Profiles } from "../hosts/profiles.js";
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
    // The host profiles, whose budget a named host's brief keeps to.
    profiles: Profiles;
    // A tool's project argument, an id or a path, as a project's id.
    resolveProject: (value: string) => Promise<string | null>;
    // Where a failure's detail goes, which a caller never sees.
    warn?: ((message: string) => void) | undefined;
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

// Only a failure the contract or recall raised on purpose shows its own
// words; any other may carry a path or the database's text.
const meant = (error: unknown): error is ContractError | RecallError =>
    error instanceof ContractError || error instanceof RecallError;
const messageOf = (error: unknown) =>
    meant(error) ? error.message : "Memory failed.";

const OUT_OF_SCOPE = "that id is outside this session's scope";
const OTHER_PROJECT = "that project is outside this session's scope";

// A request sees personal knowledge and its own project's; another
// project's is for search with scope all to find.
function checkScope(owner: string | null, project: string | null): void {
    if (owner !== null && owner !== project) {
        throw new ContractError(403, OUT_OF_SCOPE);
    }
}

async function openId(
    input: MemoryOpenInput,
    project: string | null,
    deps: ToolDeps,
): Promise<unknown> {
    const id = parseMemoryId(input.id);
    if (id === null) {
        throw new ContractError(
            400,
            `${input.id} is not a memory id: k:... or c:...`,
        );
    }
    if (
        input.from !== undefined &&
        input.through !== undefined &&
        input.from > input.through
    ) {
        throw new ContractError(400, "from is after through");
    }
    await deps.engine.index();
    if (id.kind === "knowledge") {
        // A project's id may hold slashes: projects/<id>/<name>.
        checkScope(
            id.path.startsWith("projects/")
                ? id.path.slice("projects/".length, id.path.lastIndexOf("/"))
                : null,
            project,
        );
        const fact = id.path.startsWith("personal/")
            ? id.path
            : id.path.slice("projects/".length);
        const opened = await deps.index.exclusive(() =>
            openFact(deps.index, { fact, purpose: PURPOSE }, deps.store.root),
        );
        // The contract's id, not recall's.
        return { ...opened, id: input.id };
    }
    return deps.index.exclusive(() => {
        checkScope(conversationProject(deps.index, id.phrase), project);
        return openConversation(
            deps.index,
            { conversation: id.phrase, purpose: PURPOSE },
            {
                exclude: null,
                range: { from: input.from, through: input.through },
            },
        );
    });
}

export function createContractServer(deps: ToolDeps): McpServer {
    const server = new McpServer(
        { name: CONTRACT_SERVER_NAME, version: "1.0.0" },
        { instructions: INSTRUCTIONS },
    );
    const projectOf = async (value: string | undefined) =>
        value === undefined ? deps.project : deps.resolveProject(value);
    // What brief, open and remember read and write keeps to a connection's
    // own project: the service enforces scope, not the model's argument. A
    // connection with none, as a host with no directory has, names one.
    const ownProjectOf = async (value: string | undefined) => {
        const project = await projectOf(value);
        if (deps.project !== null && project !== deps.project) {
            throw new ContractError(403, OTHER_PROJECT);
        }
        return project;
    };
    // The named host's own budget, which a brief never passes.
    const hostBudget =
        deps.host === null
            ? undefined
            : deps.profiles.get(deps.host)?.blockBudget;
    const answer = async (tool: string, work: () => Promise<unknown>) => {
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
            if (!meant(error)) {
                deps.warn?.(
                    `the ${tool} tool failed: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
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
            answer("brief", async () =>
                buildBlock(
                    {
                        project: await ownProjectOf(input.project),
                        budget: Math.min(
                            input.budget ?? BRIEF_BUDGET,
                            hostBudget ?? Number.POSITIVE_INFINITY,
                        ),
                    },
                    deps.engine,
                ),
            ),
    );
    server.registerTool(
        "search",
        { description: SEARCH_DESCRIPTION, inputSchema: searchShape },
        (input) =>
            answer("search", async () => {
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
        (input) =>
            answer("open", async () =>
                openId(input, await ownProjectOf(input.project), deps),
            ),
    );
    server.registerTool(
        "remember",
        { description: REMEMBER_DESCRIPTION, inputSchema: rememberShape },
        (input) =>
            answer("remember", async () =>
                contractRemember(input, {
                    store: deps.store,
                    project: await ownProjectOf(input.project),
                    host: deps.host,
                    from: null,
                    warn: deps.warn,
                }),
            ),
    );
    return server;
}
