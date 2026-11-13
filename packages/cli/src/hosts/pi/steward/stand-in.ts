// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/src/hosts/pi/steward/stand-in.ts
//
//

// A stand-in for `dorothy --pi-steward` that Pi's extension can spawn: the
// real helper and engine over shell stubs of herdr, the sender and the
// interrupter, none of which can reach a pane. The stubs read their state
// and log their calls in one directory ($STEWARD_STUB), so a test or probe
// sets a worker's herdr state by writing a file and reads what was sent.

import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { agentInfoReply, herdrAgentOf } from "./fixtures.js";
import type { Worker } from "./types.js";

const HELPERS = join(import.meta.dir, "helper.ts");
const ENGINE = join(import.meta.dir, "engine.ts");
const HERDR = join(import.meta.dir, "herdr.ts");

// Shell stubs: a herdr serving `agent get` and `agent read` from files, a
// sender and an interrupter that log and write nowhere.
export const STUB_HERDR = `#!/bin/sh
printf '%s\\n' "$*" >>"$STEWARD_STUB/herdr.log"
case "$1 $2" in
"agent get")
    if [ -f "$STEWARD_STUB/agent.$3.json" ]; then
        cat "$STEWARD_STUB/agent.$3.json"
        exit 0
    fi
    echo '{"error":{"code":"agent_not_found","message":"absent"},"id":"cli:agent:get"}'
    exit 1 ;;
"agent read")
    cat "$STEWARD_STUB/screen.$3" 2>/dev/null
    exit 0 ;;
esac
exit 64
`;
export const STUB_SENDER = `#!/bin/sh
input=$(cat)
printf '%s|%s\\n' "$*" "$input" >>"$STEWARD_STUB/send.log"
[ -e "$STEWARD_STUB/send-hang" ] && exec sleep 3
exit 0
`;
export const STUB_INTERRUPTER = `#!/bin/sh
printf '%s\\n' "$*" >>"$STEWARD_STUB/interrupt.log"
exit 0
`;
// `dorothy` as her extension runs it: `--pi-steward` is the real helper
// entry over the real engine with the stubs; `--pi-hook` answers with no
// layer. With no STEWARD_STUB it runs nothing at all.
export const STAND_IN = `
import { appendFileSync } from "node:fs";
import { join } from "node:path";
const env = process.env;
const dir = env.STEWARD_STUB;
if (process.argv.includes("--pi-hook")) {
    await Bun.stdin.text();
    process.stdout.write(JSON.stringify({
        session: null, context: "", recording: "off", warning: null,
    }));
    process.exit(0);
}
if (!dir || !process.argv.includes("--pi-steward")) {
    await Bun.stdin.text();
    process.stdout.write(JSON.stringify({ ok: false, code: "STUB_MISSING" }));
    process.exit(0);
}
const { stewardHelper } = await import(${JSON.stringify(HELPERS)});
const { runSteward, processAlive } = await import(${JSON.stringify(ENGINE)});
const { createHerdrRun } = await import(${JSON.stringify(HERDR)});
const out = await stewardHelper(Bun.stdin.stream(), (request) => {
    appendFileSync(join(dir, "helper.jsonl"), JSON.stringify({
        kind: request?.operation?.kind ?? null,
        controller: request?.controller ?? null,
        registry: request?.registry ?? null,
        envNames: Object.keys(env).sort(),
        cwd: process.cwd(),
    }) + "\\n");
    return runSteward(request, {
        env,
        now: () => new Date(),
        run: createHerdrRun({ bin: join(dir, "herdr") }),
        sender: createHerdrRun({ bin: join(dir, "sender") }),
        interrupter: createHerdrRun({ bin: join(dir, "interrupter") }),
        controllerAlive: processAlive,
        pollMs: 50,
    });
});
process.stdout.write(out);
process.exit(0);
`;

// The stubs and the stand-in in `dir`, executable, as `herdr`, `sender`,
// `interrupter` and `standin.ts`.
export async function writeStubs(dir: string): Promise<void> {
    for (const [name, text] of [
        ["herdr", STUB_HERDR],
        ["sender", STUB_SENDER],
        ["interrupter", STUB_INTERRUPTER],
    ] as const) {
        await writeFile(join(dir, name), text);
        await chmod(join(dir, name), 0o755);
    }
    await writeFile(join(dir, "standin.ts"), STAND_IN);
}

// What herdr shows of a worker: its declared pane, in this status, or
// (with `terminalId`) occupied by another terminal.
export async function setAgent(
    dir: string,
    worker: Worker,
    status: string,
    over: { terminalId?: string } = {},
): Promise<void> {
    const agent = herdrAgentOf(worker, status);
    if (over.terminalId) {
        agent.terminal_id = over.terminalId;
    }
    agent.agent_session = {
        agent: worker.harness,
        kind: "id",
        source: `herdr:${worker.harness}`,
        value: `stub-${worker.id}`,
    };
    await writeFile(
        join(dir, `agent.${worker.name}.json`),
        agentInfoReply(agent).stdout,
    );
}
