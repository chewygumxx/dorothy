// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/packages/memory/src/service/service.ts
//
//

// The memory service: one long-running process a machine, speaking the
// contract over a hook API and MCP. Loopback by default; anything else
// carries a device token. Harnesses' writes all pass through it, under
// the store's lock, the recall index's, which her commands take too.

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
    type Config,
    type Env,
    HOST_ID,
    knowledgeId,
    type RecordRequest,
    type RecordResponse,
    SERVICE_PATHS,
    type StructuredCall,
} from "@dorothy/core";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { hookLog } from "../bodies/log.js";
import { recordSession } from "../bodies/record.js";
import { openingBlock } from "../contract/block.js";
import { ContractError } from "../contract/errors.js";
import { FrozenBlocks } from "../contract/frozen.js";
import { recallFor } from "../contract/recall.js";
import { acceptRecord, sessionKey } from "../contract/record.js";
import {
    blockRequestSchema,
    parseWith,
    recallRequestSchema,
    recordRequestSchema,
} from "../contract/schemas.js";
import { createContractServer } from "../contract/tools.js";
import { baselineEngine } from "../engine/baseline.js";
import { knowledgePath, type Proposal } from "../engine/engine.js";
import {
    dataRoot,
    type FactStore,
    isProjectId,
    PERSONAL,
    retireFact,
    type Scope,
    writeFact,
} from "../facts/store.js";
import type { Profiles } from "../hosts/profiles.js";
import { type Entry, indexCatalogue } from "../memory/catalogue.js";
import { launchHistory } from "../memory/open.js";
import { Reviewer } from "../memory/reviewer.js";
import { vocabularyPath } from "../memory/vocabulary.js";
import { identify } from "../projects/identify.js";
import { projectsPath, readRegistry } from "../projects/registry.js";
import { syncProject } from "../projects/sync.js";
import { guardFor } from "../recall/remember.js";
import { indexPath, RecallIndex } from "../recall/store.js";
import { transcriptDir } from "../transcript.js";
import { claudeConfigDir, confineTranscript } from "./confine.js";
import { isLoopback } from "./loopback.js";
import type { TokenStore } from "./tokens.js";

export { isLoopback };

export const MAX_BODY = 8 * 1024 * 1024;
const TICK_MS = 15_000;
const EXPORT_MS = 600_000;
export type ServiceOptions = {
    env: Env;
    config: Config;
    profiles: Profiles;
    tokens: TokenStore;
    // Reviews' model and persona; null leaves extraction off.
    review: { call: StructuredCall; persona: string } | null;
    // Why review is null, for the service's log.
    noReviews?: string;
    // config.service.port by default; 0 picks a free port.
    port?: number;
    // Addresses besides loopback; config.service.listen by default.
    listen?: readonly string[];
    // Whether an address counts as loopback; for tests.
    loopback?: (address: string) => boolean;
    warn?: (message: string) => void;
    now?: () => Date;
    // Claude Code's configuration directory, whose projects directory
    // holds transcripts a record may name, as do those of [service]
    // claude-dirs; found as dorothy --claude finds it by default.
    claudeDir?: string;
    // The largest transcript read, in bytes; for tests.
    maxTranscript?: number;
    // How often idle conversations are looked at; for tests.
    tickMs?: number;
};

type Handler = (request: Request, address: string) => Promise<Response>;

export type RunningService = {
    url: string;
    ports: number[];
    // Conversations recorded and not yet taken up after their idle time.
    waiting(): number;
    stop(): Promise<void>;
};

const describeError = (error: unknown) =>
    error instanceof Error ? error.message : String(error);

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });

async function bodyOf(request: Request): Promise<unknown> {
    const text = await request.text();
    // A chunked body declares no length; Bun's own cap is twice ours.
    if (Buffer.byteLength(text) > MAX_BODY) {
        throw new ContractError(413, "the body is over 8 MiB");
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new ContractError(400, "the body is not JSON");
    }
}

export async function startService(
    options: ServiceOptions,
): Promise<RunningService> {
    const { env, config, profiles, tokens } = options;
    const now = options.now ?? (() => new Date());
    const warn =
        options.warn ??
        ((message: string) => process.stderr.write(`dorothy: ${message}\n`));
    const loopback = options.loopback ?? isLoopback;
    // Loopback first, before any work: a second service that cannot bind
    // does none, and nothing else is left running. A request waits for
    // the rest to be ready.
    let open: (handler: Handler) => void = () => {};
    const ready = new Promise<Handler>((resolve) => {
        open = resolve;
    });
    const serve = (hostname: string, port: number) =>
        Bun.serve({
            hostname,
            port,
            maxRequestBodySize: MAX_BODY * 2,
            fetch: async (request, server) =>
                (await ready)(
                    request,
                    server.requestIP(request)?.address ?? "",
                ),
        });
    const first = serve("127.0.0.1", options.port ?? config.service.port);
    let index: RecallIndex;
    try {
        mkdirSync(dirname(indexPath(env)), { recursive: true, mode: 0o700 });
        index = RecallIndex.open(indexPath(env));
    } catch (error) {
        first.stop(true);
        throw error;
    }
    const warnings: string[] = [];
    let launched: Awaited<ReturnType<typeof launchHistory>>;
    try {
        launched = await launchHistory({ config, index, warnings, env });
    } catch (error) {
        first.stop(true);
        index.close();
        throw error;
    }
    for (const message of warnings) {
        warn(message);
    }
    const recorder = launched?.history.recorder ?? null;
    const root = dataRoot(env);
    const dir = transcriptDir(env);
    const vocabulary = vocabularyPath(env);
    let entries: Entry[] = [];
    const reviewer =
        options.review === null
            ? null
            : new Reviewer({
                  dir,
                  config: config.memory,
                  index,
                  vocabulary,
                  versions: launched?.history.handle() ?? null,
                  call: options.review.call,
                  persona: options.review.persona,
                  now,
                  entries: () => entries,
                  warn: (message) => warn(message),
                  cost: () => {},
              });
    const engine = baselineEngine({
        env,
        index,
        halfLifeDays: config.memory.halfLifeDays,
        reviewer,
        warn,
        now: () => now().getTime(),
    });
    const frozen = new FrozenBlocks();
    const store: FactStore = { root, lock: index.lock, recorder, now };
    const sessions = new Map<string, string>();
    // Conversations recorded and not yet extracted, by their last record.
    const idle = new Map<string, number>();
    // Projects recorded since the last export.
    const touched = new Set<string>();
    const log = hookLog(env);
    if (reviewer === null) {
        // The service is detached, its stderr ignored: the log is read.
        log.warn(
            `reviews are off: ${options.noReviews ?? "no model is wired"}`,
        );
    }
    // An unknown host version is served, and said once.
    const versions = new Set<string>();
    const noteVersion = (host: string, version: string | undefined) => {
        const checked = profiles.get(host)?.checked ?? [];
        const key = `${host} ${version}`;
        if (
            version === undefined ||
            checked.includes(version) ||
            versions.has(key)
        ) {
            return;
        }
        versions.add(key);
        warn(
            `${host} ${version} is not a version its profile was checked against`,
        );
    };
    const resolveProject = async (value: string) =>
        isProjectId(value)
            ? value
            : ((await identify(value).catch(() => null))?.id ?? null);
    const claudeDirs = [
        options.claudeDir ?? claudeConfigDir(env),
        ...config.service.claudeDirs,
    ];
    // A refusal says nothing to the caller; the service's log says once
    // where a transcript must be, as another account's directory is not
    // known until it is listed.
    let refusedOnce = false;
    const confined = (transcript: string) =>
        confineTranscript(transcript, claudeDirs, options.maxTranscript).catch(
            (error: unknown) => {
                if (!refusedOnce) {
                    refusedOnce = true;
                    warn(
                        "refused a transcript outside Claude Code's projects directories: list another account's directory in [service] claude-dirs",
                    );
                }
                throw error;
            },
        );
    const claudeTranscript = async (
        request: RecordRequest & { transcript: string },
    ): Promise<RecordResponse> => {
        const transcript = await confined(request.transcript);
        const found = await recordSession(
            {
                session: request.session,
                transcript,
                // The launch's directory, which a halt's note keeps, is not
                // in the contract's envelope; until adapters send it
                // (delivery), the transcript's own directory stands in.
                dir: dirname(transcript),
                since: null,
                ended: false,
            },
            {
                env,
                index,
                versions: launched?.history.handle() ?? null,
                log,
                project: request.project ?? null,
            },
        );
        switch (found.kind) {
            case "recorded":
                idle.set(found.phrase, Date.now());
                return {
                    accepted: found.appended,
                    duplicates: 0,
                    through: null,
                };
            case "nothing":
                return { accepted: 0, duplicates: 0, through: null };
            case "missing":
                // Only a race now: the path was confined and found a file.
                throw new ContractError(403, "that transcript cannot be read");
            default:
                throw new ContractError(503, "the store could not be locked");
        }
    };
    // An engine's proposal, validated as a write: one naming no project,
    // or refused, is dropped and said.
    const apply = async (proposal: Proposal) => {
        if (
            proposal.scope.kind === "project" &&
            !isProjectId(proposal.scope.id)
        ) {
            warn("a proposal named no project, and was dropped");
            return;
        }
        const id = knowledgeId(knowledgePath(proposal.scope, proposal.name));
        const result =
            proposal.action === "retire"
                ? await retireFact(
                      store,
                      { scope: proposal.scope, name: proposal.name },
                      {
                          by: "review",
                          why: proposal.why,
                          guard: guardFor(id, false, () => {}),
                      },
                  )
                : await writeFact(
                      store,
                      {
                          scope: proposal.scope,
                          name: proposal.name,
                          title: proposal.title,
                          description: proposal.description,
                          type: proposal.type,
                          body: proposal.body,
                          origin: "dorothy",
                          by: "review",
                          ...(proposal.from === undefined
                              ? {}
                              : { from: proposal.from }),
                      },
                      guardFor(id, true, () => {}),
                  );
        if (result.kind === "refused" || result.kind === "failed") {
            warn(`a proposal for ${id} was dropped: ${result.reason}`);
        }
    };

    const route = async (
        request: Request,
        url: URL,
        local: boolean,
    ): Promise<Response> => {
        switch (url.pathname) {
            case SERVICE_PATHS.health:
                return json(200, { ok: true });
            case SERVICE_PATHS.block: {
                const block = parseWith(
                    blockRequestSchema,
                    await bodyOf(request),
                );
                noteVersion(block.host, block.hostVersion);
                return json(
                    200,
                    await openingBlock(block, { engine, profiles, frozen }),
                );
            }
            case SERVICE_PATHS.recall:
                return json(
                    200,
                    await recallFor(
                        parseWith(recallRequestSchema, await bodyOf(request)),
                        { engine, profiles },
                    ),
                );
            case SERVICE_PATHS.record: {
                const record = parseWith(
                    recordRequestSchema,
                    await bodyOf(request),
                );
                if (!profiles.has(record.host)) {
                    throw new ContractError(
                        400,
                        `no profile for host ${record.host}`,
                    );
                }
                noteVersion(record.host, record.hostVersion);
                const result = await acceptRecord(record, {
                    env,
                    index,
                    recorder,
                    loopback: local,
                    sync: () => engine.index(),
                    claudeTranscript,
                    sessions,
                    now,
                });
                const phrase = sessions.get(
                    sessionKey(record.host, record.session),
                );
                if (phrase !== undefined && result.accepted > 0) {
                    idle.set(phrase, Date.now());
                }
                if (record.project !== undefined) {
                    touched.add(record.project);
                }
                return json(200, result);
            }
            case SERVICE_PATHS.mcp: {
                // Stateless: no stream for a GET to hold a server open.
                if (request.method !== "POST") {
                    return new Response(null, {
                        status: 405,
                        headers: { allow: "POST" },
                    });
                }
                const project = url.searchParams.get("project");
                const host = url.searchParams.get("host");
                const server = createContractServer({
                    engine,
                    index,
                    store,
                    project:
                        project === null ? null : await resolveProject(project),
                    host: host !== null && HOST_ID.test(host) ? host : null,
                    profiles,
                    resolveProject,
                    warn,
                });
                const transport = new WebStandardStreamableHTTPServerTransport({
                    sessionIdGenerator: undefined,
                    enableJsonResponse: true,
                });
                await server.connect(transport);
                return transport.handleRequest(request);
            }
            default:
                return json(404, { error: `nothing at ${url.pathname}` });
        }
    };

    // The names the service answers to, filled once it is listening: a
    // request to any other, as DNS rebinding sends, is refused.
    const allowedHosts = new Set<string>();
    // The names refused, each warned of once, up to a few: the header is
    // the sender's to fill.
    const misdirected = new Set<string>();
    const handle = async (
        request: Request,
        address: string,
    ): Promise<Response> => {
        const declared = Number(request.headers.get("content-length") ?? 0);
        if (declared > MAX_BODY) {
            return json(413, { error: "the body is over 8 MiB" });
        }
        // What a web page could send: no harness names an Origin, and a
        // page cannot send JSON without one's leave.
        if (request.headers.has("origin")) {
            return json(403, { error: "a request from a web page is refused" });
        }
        const named = request.headers.get("host") ?? "";
        if (!allowedHosts.has(named)) {
            // Not the client's fault for good: it may be reaching the
            // service by a name the listen list lacks, so its records wait.
            if (misdirected.size < 16 && !misdirected.has(named)) {
                misdirected.add(named);
                warn(
                    `refused a request to ${JSON.stringify(named.slice(0, 80))}: add its address to [service] listen`,
                );
            }
            return json(421, {
                error: "this service does not answer to that name",
            });
        }
        if (
            request.method === "POST" &&
            !(request.headers.get("content-type") ?? "").startsWith(
                "application/json",
            )
        ) {
            return json(415, { error: "the body must be JSON" });
        }
        const local = loopback(address);
        if (!local) {
            const header = request.headers.get("authorization") ?? "";
            const token = header.startsWith("Bearer ") ? header.slice(7) : "";
            if (token === "" || (await tokens.verify(token)) === null) {
                return json(401, {
                    error: "a device token is needed from beyond this machine",
                });
            }
        }
        try {
            return await route(request, new URL(request.url), local);
        } catch (error) {
            if (error instanceof ContractError) {
                return json(error.status, { error: error.message });
            }
            warn(`the memory service failed: ${describeError(error)}`);
            return json(500, { error: "the memory service failed" });
        }
    };

    const port = first.port ?? 0;
    const servers = [first];
    for (const name of ["127.0.0.1", "localhost", "[::1]"]) {
        allowedHosts.add(`${name}:${port}`);
    }
    // A further address that cannot be had, as before a private network is
    // up, is said and passed over.
    for (const hostname of options.listen ?? config.service.listen) {
        try {
            servers.push(serve(hostname, port));
            allowedHosts.add(
                `${hostname.includes(":") ? `[${hostname}]` : hostname}:${port}`,
            );
        } catch (error) {
            warn(`could not listen on ${hostname}: ${describeError(error)}`);
        }
    }
    open(handle);

    const extraction = new AbortController();
    let extracting = false;
    const tick = setInterval(async () => {
        if (extracting) {
            return;
        }
        extracting = true;
        try {
            const wait = config.memory.idleSeconds * 1000;
            const due = [...idle]
                .filter(([, at]) => Date.now() - at >= wait)
                .map(([phrase]) => phrase);
            // Without reviews the engine extracts nothing; only the
            // reviewer reads the catalogue.
            if (due.length > 0 && reviewer !== null) {
                entries = (
                    await indexCatalogue(index, dir, vocabulary, root).load()
                ).entries;
            }
            for (const phrase of due) {
                idle.delete(phrase);
                const proposals = await engine.extract(
                    phrase,
                    extraction.signal,
                );
                for (const proposal of proposals.slice(
                    0,
                    config.memory.extractCap,
                )) {
                    await apply(proposal);
                }
            }
        } catch (error) {
            warn(`extraction failed: ${describeError(error)}`);
        } finally {
            extracting = false;
        }
    }, options.tickMs ?? TICK_MS);
    // Periodically: consolidation, personal and of each project recorded,
    // then export of those projects to their repositories.
    const exporting = setInterval(async () => {
        const ids = [...touched];
        touched.clear();
        try {
            const scopes: Scope[] = [
                PERSONAL,
                ...ids.map((id) => ({ kind: "project" as const, id })),
            ];
            for (const scope of scopes) {
                for (const proposal of await engine.consolidate(scope)) {
                    await apply(proposal);
                }
            }
        } catch (error) {
            warn(`consolidation failed: ${describeError(error)}`);
        }
        if (ids.length === 0) {
            return;
        }
        const read = await readRegistry(projectsPath(root));
        for (const id of ids) {
            const roots =
                read.kind === "ok"
                    ? (read.registry.projects[id]?.roots ?? [])
                    : [];
            for (const at of roots) {
                const synced = await syncProject(at, {
                    root,
                    lock: index.lock,
                    recorder,
                }).catch((error: unknown) => ({
                    kind: "failed" as const,
                    reason: describeError(error),
                }));
                if (synced.kind === "failed") {
                    warn(`export of ${id} failed: ${synced.reason}`);
                }
            }
        }
    }, EXPORT_MS);

    return {
        url: `http://127.0.0.1:${port}`,
        ports: servers.map((server) => server.port ?? 0),
        waiting: () => idle.size,
        async stop() {
            clearInterval(tick);
            clearInterval(exporting);
            extraction.abort();
            for (const server of servers) {
                server.stop(true);
            }
            await launched?.close();
            index.close();
        },
    };
}
