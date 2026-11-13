// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~xxdorothy/dorothy.git
// ::: :/packages/cli/assets/pi/stewardship/fixture/owner/acceptance.ts
//
//

// The owner's acceptance test of the fixture library, held outside every
// worker's clone and run by the trial's runner on an export of the exact
// submitted revision: `bun acceptance.ts <export directory>`. The submitted
// code never runs in this process. It runs in a child (`child.ts`) that is
// given the inputs on stdin and may only answer with their outputs; this
// process holds the expected outputs and compares them. A child that exits
// early, hangs, says nothing or says the wrong thing fails, whatever its
// exit code. Prints one line per case and exits nonzero if any fails. The
// child guards against accident and in-band forgery; it is no sandbox, and
// hostile code in it runs as this user (see steward/owner.ts).

import { dirname, join, resolve } from "node:path";

if (!process.argv[2]) {
    console.log("usage: acceptance.ts <export directory>");
    process.exit(2);
}
const dir = resolve(process.argv[2]);

const TIMEOUT_MS = 10_000;
const MAX_REPLY_BYTES = 64 * 1024;

const cases: [string, string][] = [
    ["Hello, World!", "hello-world"],
    ["  spaced   out  ", "spaced-out"],
    ["already-a-slug", "already-a-slug"],
    ["Crème Brûlée", "creme-brulee"],
    ["Ünïcödé Tëst", "unicode-test"],
    ["a --- b", "a-b"],
    ["!!!", ""],
    ["", ""],
    ["日本語 text", "text"],
    ["v2.0 (final)", "v2-0-final"],
];

// The child's whole stdout, read at most to the bound; past it, killed.
async function boundedText(
    stream: ReadableStream<Uint8Array>,
    over: () => void,
): Promise<string> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of stream) {
        size += chunk.byteLength;
        if (size > MAX_REPLY_BYTES) {
            over();
            break;
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf8");
}

// The submitted slugify's outputs for the inputs, or why there are none.
async function ask(inputs: string[]): Promise<(string | null)[] | string> {
    const nonce = crypto.randomUUID();
    const config = join(dirname(import.meta.path), "..", "bunfig.toml");
    const child = Bun.spawn(
        [
            process.execPath,
            "--no-env-file",
            ...((await Bun.file(config).exists())
                ? [`--config=${config}`]
                : []),
            join(import.meta.dir, "child.ts"),
        ],
        {
            cwd: dir,
            env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
            stdin: "pipe",
            stdout: "pipe",
            stderr: "ignore",
            timeout: TIMEOUT_MS,
            killSignal: "SIGKILL",
        },
    );
    child.stdin.write(JSON.stringify({ nonce, dir, inputs }));
    child.stdin.end();
    const out = await boundedText(child.stdout, () => child.kill("SIGKILL"));
    const code = await child.exited;
    // Only a line starting with the nonce is the child's reply; exactly one
    // is needed. This rejects a reply printed ahead of the child's own, not
    // code that learns the nonce (it can wrap process.stdout.write).
    const replies = out
        .split("\n")
        .filter((line) => line.startsWith(`${nonce} `));
    if (replies.length !== 1) {
        return `no reply from the submitted module (exit ${code})`;
    }
    try {
        const parsed: unknown = JSON.parse(
            (replies[0] as string).slice(nonce.length + 1),
        );
        if (
            Array.isArray(parsed) &&
            parsed.length === inputs.length &&
            parsed.every((item) => item === null || typeof item === "string")
        ) {
            return code === 0 ? parsed : `exit ${code} after replying`;
        }
    } catch {}
    return "a reply that is not one output per input";
}

const answered = await ask(cases.map(([input]) => input));
if (typeof answered === "string") {
    console.log(`FAIL ${answered}`);
    console.log(`0/${cases.length} cases pass`);
    process.exit(1);
}

let failed = 0;
cases.forEach(([input, expected], index) => {
    const got = answered[index];
    const ok = got === expected;
    failed += ok ? 0 : 1;
    console.log(
        `${ok ? "ok" : "FAIL"} ${JSON.stringify(input)} -> ${JSON.stringify(got)}` +
            (ok ? "" : ` (want ${JSON.stringify(expected)})`),
    );
});
console.log(`${cases.length - failed}/${cases.length} cases pass`);
process.exit(failed === 0 ? 0 : 1);
