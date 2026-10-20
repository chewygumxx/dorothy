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
import { acceptRecord, type Held, sessionKey } from "../contract/record.js";
import {
    blockRequestSchema,
    parseWith,
    recallRequestSchema,
    recordRequestSchema,
} from "../contract/schemas.js";
import { createContractServer } from "../contract/tools.js";
import { baselineEngine } from "../engine/baseline.js";
import { dataRoot, type FactStore, isProjectId } from "../facts/store.js";
import type { Profiles } from "../hosts/profiles.js";
import { type Entry, indexCatalogue } from "../memory/catalogue.js";
import { launchHistory } from "../memory/open.js";
import { Reviewer } from "../memory/reviewer.js";
import { vocabularyPath } from "../memory/vocabulary.js";
import { identify } from "../projects/identify.js";
import { indexPath, RecallIndex, SCHEMA_VERSION } from "../recall/store.js";
import { transcriptDir } from "../transcript.js";
import { claudeConfigDir, confineTranscript } from "./confine.js";
import { guarded, type Handler } from "./guard.js";
import { bodyOf, describeError, json, MAX_BODY } from "./http.js";
import { noteRecorded, startJobs } from "./jobs.js";
import { isLoopback } from "./loopback.js";
import { Recent } from "./recent.js";
import { sweepBinding } from "./recording.js";
import type { TokenStore } from "./tokens.js";

export { isLoopback, MAX_BODY };

const MAX_SESSIONS = 10_000;
const MAX_VERSIONS = 128;
const MAX_HELD = 200;

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
    // How often the hosts are swept; config.recording.sweepSeconds by
    // default, for tests.
    sweepMs?: number;
};

export type RunningService = {
    url: string;
    ports: number[];
    // Conversations recorded and not yet taken up after their idle time.
    waiting(): number;
    stop(): Promise<void>;
};

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
    // A newer Dorothy rebuilds the index for its own schema under a
    // service still running, whose writes then fail: the first failure
    // after says why, once.
    let saidNewer = false;
    const failed = (message: string) => {
        const newer = index.newerSchema();
        if (newer !== null && !saidNewer) {
            saidNewer = true;
            warn(
                `the recall index is schema ${newer}, newer than this service knows (${SCHEMA_VERSION}): a newer Dorothy is installed; stop this service and start it again (dorothy --serve)`,
            );
        }
        warn(message);
    };
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
    const servers = [first];
    try {
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
        const store: FactStore = {
            root,
            lock: launched?.history.lock ?? index.lock,
            recorder,
            now,
        };
        // Host sessions' conversations, found again through the index when
        // one has gone; a host chooses the keys, so only the latest are kept.
        const sessions = new Recent<string, string>(MAX_SESSIONS);
        // The source ids last read from each conversation's file.
        const held = new Recent<string, Held>(MAX_HELD);
        // Conversations recorded and not yet extracted, by their last record.
        const idle = new Map<string, number>();
        // Conversations a backfill recorded, which no review reads.
        const backfilled = new Set<string>();
        // Projects recorded since the last export.
        const touched = new Set<string>();
        const log = hookLog(env);
        if (reviewer === null) {
            // The service is detached, its stderr ignored: the log is read.
            log.warn(
                `reviews are off: ${options.noReviews ?? "no model is wired"}`,
            );
        }
        // An unknown host version is served, and said once, while recent.
        const versions = new Recent<string, true>(MAX_VERSIONS);
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
            versions.set(key, true);
            // The version is the client's text: quoted, it forges no line.
            warn(
                `${host} ${JSON.stringify(version)} is not a version its profile was checked against`,
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
            confineTranscript(
                transcript,
                claudeDirs,
                options.maxTranscript,
            ).catch((error: unknown) => {
                if (!refusedOnce) {
                    refusedOnce = true;
                    warn(
                        "refused a transcript outside Claude Code's projects directories: list another account's directory in [service] claude-dirs",
                    );
                }
                throw error;
            });
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
                    noteRecorded({ idle, backfilled }, found.phrase, false);
                    return {
                        accepted: found.appended,
                        duplicates: 0,
                        through: null,
                    };
                case "nothing":
                    return { accepted: 0, duplicates: 0, through: null };
                case "missing":
                    // Only a race now: the path was confined and found a file.
                    throw new ContractError(
                        403,
                        "that transcript cannot be read",
                    );
                default:
                    throw new ContractError(
                        503,
                        "the store could not be locked",
                    );
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
                            parseWith(
                                recallRequestSchema,
                                await bodyOf(request),
                            ),
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
                        warn: (message) => log.warn(message),
                        index,
                        recorder,
                        lock: store.lock,
                        loopback: local,
                        sync: () => engine.index(),
                        claudeTranscript,
                        sessions,
                        held,
                        now,
                    });
                    const phrase = sessions.get(
                        sessionKey(record.host, record.session),
                    );
                    if (phrase !== undefined && result.accepted > 0) {
                        noteRecorded({ idle, backfilled }, phrase, false);
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
                    // Read here, within the cap, as the other routes are.
                    const parsedBody = await bodyOf(request);
                    const project = url.searchParams.get("project");
                    const host = url.searchParams.get("host");
                    const server = createContractServer({
                        engine,
                        index,
                        store,
                        project:
                            project === null
                                ? null
                                : await resolveProject(project),
                        host: host !== null && HOST_ID.test(host) ? host : null,
                        profiles,
                        resolveProject,
                        warn,
                    });
                    const transport =
                        new WebStandardStreamableHTTPServerTransport({
                            sessionIdGenerator: undefined,
                            enableJsonResponse: true,
                        });
                    await server.connect(transport);
                    return transport.handleRequest(request, { parsedBody });
                }
                default:
                    return json(404, { error: `nothing at ${url.pathname}` });
            }
        };

        const { handle, allowedHosts } = guarded({
            route,
            tokens,
            loopback,
            warn: failed,
        });
        const port = first.port ?? 0;
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
                warn(
                    `could not listen on ${hostname}: ${describeError(error)}`,
                );
            }
        }
        open(handle);

        // Other harnesses' sessions, swept at the start and on an interval;
        // none unless `[recording] hosts` names some.
        const sweeping =
            config.recording.hosts.length === 0
                ? null
                : sweepBinding({
                      env,
                      hosts: config.recording.hosts,
                      claudeDirs,
                      store,
                      index,
                      versions: launched?.history.handle() ?? null,
                      sync: () => engine.index(),
                      sessions,
                      held,
                      idle,
                      backfilled,
                      touched,
                      log,
                      now,
                  });
        const jobs = startJobs({
            config,
            engine,
            store,
            idle,
            backfilled,
            touched,
            info: (message) => log.info(message),
            warn: failed,
            tickMs: options.tickMs,
            sweep:
                sweeping === null
                    ? null
                    : {
                          run: () => sweeping.run(),
                          everyMs:
                              options.sweepMs ??
                              config.recording.sweepSeconds * 1000,
                      },
            loadCatalogue:
                reviewer === null
                    ? null
                    : async () => {
                          entries = (
                              await indexCatalogue(
                                  index,
                                  dir,
                                  vocabulary,
                                  root,
                              ).load()
                          ).entries;
                      },
        });

        return {
            url: `http://127.0.0.1:${port}`,
            ports: servers.map((server) => server.port ?? 0),
            waiting: () => idle.size,
            async stop() {
                await jobs.stop();
                for (const server of servers) {
                    server.stop(true);
                }
                await launched?.close();
                index.close();
            },
        };
    } catch (error) {
        // A start that fails leaves nothing bound or open.
        for (const server of servers) {
            server.stop(true);
        }
        await launched?.close();
        index.close();
        throw error;
    }
}
