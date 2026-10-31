// vim:set expandtab shiftwidth=4 filetype=typescript:
// SPDX-License-Identifier: GPL-3.0-only

//
//
// ~chewygumxx/dorothy.git
// ::: :/scripts/agent-stewardship.test.ts
//
//

// The agent-stewardship skill's scripts, run against stand-ins for herdr
// and systemd-run on a temporary PATH. The skill lives in a hidden
// directory, which Bun's test discovery skips, so its tests live here.

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
    chmod,
    copyFile,
    mkdir,
    mkdtemp,
    readdir,
    readFile,
    realpath,
    rm,
    stat,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scripts = join(
    import.meta.dir,
    "..",
    ".agents",
    "skills",
    "agent-stewardship",
    "scripts",
);
const send = join(scripts, "send-prompt.sh");
const compact = join(scripts, "compact-self.sh");
const job = join(scripts, "job.sh");
const stopped = join(scripts, "job-stopped.sh");

// Every call to a stand-in is logged as its arguments, each ended by a
// NUL, and the call by \001, so a message with newlines survives intact.
const logging = `
log() { printf '%s\\0' "$@" >>"$STUB/calls.log"; printf '\\001' >>"$STUB/calls.log"; }
log "$(basename "$0")" "$@"
`;
const herdr = `#!/bin/sh
${logging}
case "$1 $2" in
"agent get")
    if [ -e "$STUB/absent" ]; then
        echo '{"error":{"code":"agent_not_found"}}'
        exit 1
    fi
    name=$(cat "$STUB/name.$3" 2>/dev/null || printf %s "$3")
    printf '{"result":{"agent":{"name":"%s","pane_id":"w1:p2","agent_status":"%s"}}}\\n' \\
        "$name" "$(cat "$STUB/status")"
    ;;
"pane send-text") [ -e "$STUB/fail-text" ] && exit 1 ;;
"pane send-keys") [ -e "$STUB/fail-keys" ] && exit 1 ;;
esac
exit 0
`;
const systemdRun = `#!/bin/sh
${logging}
[ -e "$STUB/fail-run" ] && exit 1
exit 0
`;

let root: string;
let env: Record<string, string>;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "dorothy-stewardship-"));
    await mkdir(join(root, "bin"));
    await mkdir(join(root, "run"));
    for (const [name, body] of [
        ["herdr", herdr],
        ["systemd-run", systemdRun],
    ]) {
        const path = join(root, "bin", name as string);
        await writeFile(path, body as string);
        await chmod(path, 0o755);
    }
    await writeFile(join(root, "status"), "idle");
    // Not the ambient environment: no HERDR_PANE_ID, nor the user's XDG.
    env = {
        PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
        HOME: root,
        XDG_RUNTIME_DIR: join(root, "run"),
        XDG_STATE_HOME: join(root, "state"),
        STUB: root,
        TZ: "UTC",
    };
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

const sendsDir = () => join(root, "state", "dorothy-agents", "sends");
const lockFile = () => join(root, "run", "dorothy-agents", "w1_p2.lock");
const setStatus = (status: string) => writeFile(join(root, "status"), status);
const touch = (name: string) => writeFile(join(root, name), "");

async function calls(): Promise<string[][]> {
    const raw = await readFile(join(root, "calls.log"), "utf8").catch(() => "");
    return raw
        .split("\x01")
        .filter(Boolean)
        .map((call) => call.split("\0").slice(0, -1));
}

// The calls that wrote to a pane, without their `herdr` prefix.
async function writes(): Promise<string[][]> {
    return (await calls())
        .filter((call) => call[0] === "herdr" && call[1] === "pane")
        .map((call) => call.slice(2));
}

const start = (
    script: string,
    args: string[],
    stdin = "",
    extra: Record<string, string> = {},
) =>
    Bun.spawn([script, ...args], {
        env: { ...env, ...extra },
        stdin: new Blob([stdin]),
        stdout: "pipe",
        stderr: "pipe",
    });

async function finish(child: ReturnType<typeof start>) {
    const [out, err, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
    ]);
    return { out, err, code };
}

const run = (
    script: string,
    args: string[],
    stdin = "",
    extra: Record<string, string> = {},
) => finish(start(script, args, stdin, extra));

async function until(done: () => Promise<boolean>) {
    for (let waited = 0; waited < 5000; waited += 20) {
        if (await done()) return;
        await Bun.sleep(20);
    }
    throw new Error("timed out waiting");
}

describe("send-prompt.sh, now", () => {
    it("labels the text and sends it, then Enter, apart", async () => {
        const { code } = await run(send, ["--from", "alice", "bob"], "hello\n");
        expect(code).toBe(0);
        expect(await writes()).toEqual([
            ["send-text", "w1:p2", "[from alice] hello"],
            ["send-keys", "w1:p2", "enter"],
        ]);
    });

    it("sends quotes, newlines, $, backticks and a leading - verbatim", async () => {
        const text =
            'it\'s "quoted" $HOME `date` $(id) \\n\n  - second line\n--help';
        await run(send, ["--from", "alice", "bob"], text);
        const [first] = await writes();
        expect(first).toEqual(["send-text", "w1:p2", `[from alice] ${text}`]);

        await run(send, ["--from", "alice", "bob"], "-rf --force");
        expect((await writes())[2]).toEqual([
            "send-text",
            "w1:p2",
            "[from alice] -rf --force",
        ]);
    });

    it("names the sender after the agent on HERDR_PANE_ID", async () => {
        await writeFile(join(root, "name.w9:p9"), "carol");
        const { code } = await run(send, ["bob"], "hi", {
            HERDR_PANE_ID: "w9:p9",
        });
        expect(code).toBe(0);
        expect((await writes())[0]?.[2]).toBe("[from carol] hi");
    });

    it("refuses an agent blocked on a dialog, sending nothing", async () => {
        await setStatus("blocked");
        const { code, err } = await run(send, ["--from", "a", "bob"], "hi");
        expect(code).toBe(3);
        expect(err).toContain("blocked");
        expect(await writes()).toEqual([]);
    });

    it("refuses an absent agent", async () => {
        await touch("absent");
        const { code } = await run(send, ["--from", "a", "bob"], "hi");
        expect(code).toBe(4);
        expect(await writes()).toEqual([]);
    });

    it("refuses an empty message", async () => {
        const { code } = await run(send, ["--from", "a", "bob"], " \n");
        expect(code).toBe(2);
        expect(await calls()).toEqual([]);
    });

    it("reports a failed Enter after the text was written", async () => {
        await touch("fail-keys");
        const { code, err } = await run(send, ["--from", "a", "bob"], "hi");
        expect(code).toBe(1);
        expect(err).toContain("enter failed");
    });

    it("reads the status after taking the pane's lock", async () => {
        await mkdir(join(root, "run", "dorothy-agents"));
        const holder = Bun.spawn(
            ["flock", lockFile(), "sh", "-c", "read -r _"],
            { stdin: "pipe", stdout: "ignore", stderr: "ignore" },
        );
        await until(async () => {
            const probe = Bun.spawn(["flock", "-n", lockFile(), "true"]);
            return (await probe.exited) !== 0;
        });
        const waiting = start(send, ["--from", "a", "bob"], "hi");
        await Bun.sleep(300);
        expect(await writes()).toEqual([]);
        await setStatus("blocked");
        holder.stdin.write("\n");
        holder.stdin.end();
        const { code } = await finish(waiting);
        await holder.exited;
        expect(code).toBe(3);
        expect(await writes()).toEqual([]);
    });
});

describe("send-prompt.sh, scheduled", () => {
    it("refuses a time without a date, as it would recur daily", async () => {
        const { code, err } = await run(
            send,
            ["--from", "a", "--at", "02:31", "bob"],
            "hi",
        );
        expect(code).toBe(2);
        expect(err).toContain("date");
        expect((await calls()).length).toBe(0);
    });

    it("refuses a time that is not in the future", async () => {
        const { code, err } = await run(
            send,
            ["--from", "a", "--at", "2020-01-01 00:00", "bob"],
            "hi",
        );
        expect(code).toBe(2);
        expect(err).toContain("future");
        expect((await calls()).length).toBe(0);
    });

    it("refuses --at with --in", async () => {
        const { code } = await run(
            send,
            ["--from", "a", "--at", "2099-01-01", "--in", "2min", "bob"],
            "hi",
        );
        expect(code).toBe(2);
    });

    it("sets a calendar timer, keeping the message out of argv", async () => {
        const message = "secret-ish words";
        const { code, out } = await run(
            send,
            ["--from", "alice", "--at", "2099-01-01 00:00", "bob"],
            message,
        );
        expect(code).toBe(0);
        const [call] = await calls();
        expect(call?.[0]).toBe("systemd-run");
        const unit = call?.find((arg) => arg.startsWith("--unit=")) ?? "";
        expect(unit).toMatch(/^--unit=dorothy-send-bob-\d+$/);
        const id = unit.slice("--unit=dorothy-send-".length);
        expect(call).toEqual(
            expect.arrayContaining([
                "--user",
                "--collect",
                "--timer-property=AccuracySec=1s",
                "--setenv=PATH",
                "--setenv=XDG_RUNTIME_DIR",
                "--setenv=XDG_STATE_HOME",
                "--on-calendar=2099-01-01 00:00:00 UTC",
            ]),
        );
        expect(call?.slice(-4)).toEqual(["--", send, "--deliver", id]);
        expect(call?.join(" ")).not.toContain("secret");
        expect(out).toContain(`dorothy-send-${id}`);
        expect(out).toContain("2099-01-01 00:00:00 UTC");

        const file = join(sendsDir(), `${id}.msg`);
        expect(await readFile(file, "utf8")).toBe(
            `[from alice, scheduled] ${message}`,
        );
        expect((await stat(file)).mode & 0o777).toBe(0o600);
    });

    it("reads a time in the local zone and sets it in UTC", async () => {
        const { code, out } = await run(
            send,
            ["--from", "a", "--at", "2099-01-01 00:00", "bob"],
            "hi",
            { TZ: "Australia/Sydney" },
        );
        expect(code).toBe(0);
        const [call] = await calls();
        expect(call).toContain("--on-calendar=2098-12-31 13:00:00 UTC");
        expect(out).toContain("when: 2098-12-31 13:00:00 UTC");
    });

    it("takes an epoch for a date", async () => {
        const { code } = await run(
            send,
            ["--from", "a", "--at", "@4070908800", "bob"],
            "hi",
        );
        expect(code).toBe(0);
        const [call] = await calls();
        expect(call).toContain("--on-calendar=2099-01-01 00:00:00 UTC");
    });

    it("sets a relative timer", async () => {
        const { code } = await run(
            send,
            ["--from", "a", "--in", "2min", "bob"],
            "hi",
        );
        expect(code).toBe(0);
        const [call] = await calls();
        expect(call).toContain("--on-active=2min");
        expect(call?.some((arg) => arg.startsWith("--on-calendar"))).toBe(
            false,
        );
    });

    it("leaves no message behind when the timer is refused", async () => {
        await touch("fail-run");
        const { code } = await run(
            send,
            ["--from", "a", "--in", "2min", "bob"],
            "hi",
        );
        expect(code).not.toBe(0);
        expect(await readdir(sendsDir())).toEqual([]);
    });
});

describe("send-prompt.sh --deliver", () => {
    const id = "bob-1";
    const msg = () => join(sendsDir(), `${id}.msg`);
    const tries = () => join(sendsDir(), `${id}.tries`);
    const log = () => readFile(join(sendsDir(), `${id}.log`), "utf8");
    const stamp = "\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ";

    beforeEach(async () => {
        await mkdir(sendsDir(), { recursive: true });
        await writeFile(msg(), "[from alice, scheduled] hi\nthere");
    });

    it("delivers, logs it and removes the message", async () => {
        const { code } = await run(send, ["--deliver", id]);
        expect(code).toBe(0);
        expect(await writes()).toEqual([
            ["send-text", "w1:p2", "[from alice, scheduled] hi\nthere"],
            ["send-keys", "w1:p2", "enter"],
        ]);
        expect(await log()).toMatch(new RegExp(`^${stamp} delivered\n$`));
        expect(await readdir(sendsDir())).not.toContain(`${id}.msg`);
    });

    it("re-arms in five minutes when blocked, counting the tries", async () => {
        await setStatus("blocked");
        for (const count of [1, 2]) {
            const { code } = await run(send, ["--deliver", id]);
            expect(code).toBe(0);
            expect(await readFile(tries(), "utf8")).toBe(`${count}\n`);
        }
        expect(await writes()).toEqual([]);
        const armed = (await calls()).filter((c) => c[0] === "systemd-run");
        expect(armed).toHaveLength(2);
        expect(armed[1]).toEqual(
            expect.arrayContaining([
                "--user",
                "--collect",
                "--on-active=5min",
                "--timer-property=AccuracySec=1s",
            ]),
        );
        expect(armed[1]?.slice(-3)).toEqual([send, "--deliver", id]);
        expect(armed[0]?.find((a) => a.startsWith("--unit="))).not.toBe(
            armed[1]?.find((a) => a.startsWith("--unit=")),
        );
        expect(await log()).toMatch(
            new RegExp(`^(${stamp} refused blocked, re-armed\n){2}$`),
        );
        expect(await readFile(msg(), "utf8")).toContain("hi");
    });

    it("re-arms when the agent is absent", async () => {
        await touch("absent");
        const { code } = await run(send, ["--deliver", id]);
        expect(code).toBe(0);
        expect(await log()).toMatch(/ refused absent, re-armed\n$/);
    });

    it("gives up at 12 tries", async () => {
        await setStatus("blocked");
        await writeFile(tries(), "12\n");
        const { code } = await run(send, ["--deliver", id]);
        expect(code).not.toBe(0);
        expect(await log()).toMatch(new RegExp(`^${stamp} gave up\n$`));
        expect(
            (await calls()).filter((call) => call[0] === "systemd-run"),
        ).toEqual([]);
    });

    it("re-arms at 11 tries, the last one", async () => {
        await setStatus("blocked");
        await writeFile(tries(), "11\n");
        await run(send, ["--deliver", id]);
        expect(await readFile(tries(), "utf8")).toBe("12\n");
        expect(await log()).toContain("re-armed");
    });

    it("does not resend after a failed send-text, which may have written", async () => {
        await touch("fail-text");
        const { code } = await run(send, ["--deliver", id]);
        expect(code).toBe(1);
        expect(await log()).toMatch(
            new RegExp(`^${stamp} partial: send-text failed, not resent\n$`),
        );
        expect(
            (await calls()).filter((call) => call[0] === "systemd-run"),
        ).toEqual([]);
        expect((await writes()).map((call) => call[0])).toEqual(["send-text"]);
    });

    it("records a partial send, and does not re-arm it", async () => {
        await touch("fail-keys");
        const { code } = await run(send, ["--deliver", id]);
        expect(code).not.toBe(0);
        expect(await log()).toMatch(
            new RegExp(`^${stamp} partial: text written, enter failed\n$`),
        );
        expect(
            (await calls()).filter((call) => call[0] === "systemd-run"),
        ).toEqual([]);
        expect((await writes())[0]?.[0]).toBe("send-text");
    });
});

describe("send-prompt.sh outside herdr", () => {
    it("says its usage without --from, touching nothing", async () => {
        const { code, err } = await run(send, ["bob"], "hi");
        expect(code).toBe(2);
        expect(err).toContain("usage");
        expect(await calls()).toEqual([]);
        expect(await readdir(root)).not.toContain("state");
    });
});

describe("compact-self.sh", () => {
    const pane = "w7:p3";
    const quick = { HERDR_PANE_ID: pane, DOROTHY_COMPACT_PAUSE: "0" };

    async function instructions(text: string) {
        const file = join(root, "instructions.md");
        await writeFile(file, text);
        return file;
    }

    it("waits, rechecks, then writes /compact and the file, then Enter", async () => {
        const text = "Resume the plan at task 5.\nKeep `this`.\n";
        const file = await instructions(text);
        const { code } = await run(compact, [file], "", quick);
        expect(code).toBe(0);
        expect(await calls()).toEqual([
            ["herdr", "agent", "wait", pane, "--until", "idle"],
            ["herdr", "agent", "get", pane],
            ["herdr", "pane", "send-text", pane, "/compact "],
            ["herdr", "pane", "send-text", pane, text.trimEnd()],
            ["herdr", "pane", "send-keys", pane, "enter"],
        ]);
    });

    it("spaces instructions that begin with a dash", async () => {
        const file = await instructions("- Resume at task 5\n- Then task 6");
        const { code } = await run(compact, [file], "", quick);
        expect(code).toBe(0);
        expect((await writes())[1]).toEqual([
            "send-text",
            pane,
            " - Resume at task 5\n- Then task 6",
        ]);
    });

    it("sends nothing when the agent is no longer idle", async () => {
        await setStatus("working");
        const file = await instructions("go on");
        const { code } = await run(compact, [file], "", quick);
        expect(code).toBe(5);
        expect(await writes()).toEqual([]);
    });

    it("holds the pane's lock until its Enter is sent", async () => {
        const file = await instructions("go on");
        const compacting = start(compact, [file], "", {
            HERDR_PANE_ID: "w1:p2",
            DOROTHY_COMPACT_PAUSE: "1",
        });
        await until(async () => (await writes()).length > 0);
        const sending = start(send, ["--from", "a", "bob"], "ping");
        await Promise.all([finish(compacting), finish(sending)]);
        expect((await writes()).map((call) => call[2])).toEqual([
            "/compact ",
            "go on",
            "enter",
            "[from a] ping",
            "enter",
        ]);
    });

    it("says its usage outside herdr, touching nothing", async () => {
        const file = await instructions("go on");
        const { code, err } = await run(compact, [file]);
        expect(code).toBe(2);
        expect(err).toContain("usage");
        expect(await calls()).toEqual([]);
    });
});

describe("job.sh", () => {
    const spawnIn = (args: string[], cwd: string, extra = {}) =>
        Bun.spawn([job, ...args], {
            cwd,
            env: { ...env, ...extra },
            stdin: new Blob([""]),
            stdout: "pipe",
            stderr: "pipe",
        });
    const submitted = async () =>
        (await calls()).find((call) => call[0] === "systemd-run") ?? [];
    const setenvs = (call: string[]) =>
        call
            .filter((arg) => arg.startsWith("--setenv="))
            .map((arg) => arg.slice("--setenv=".length))
            .sort();

    it("submits a user unit that logs, notifies and runs the command", async () => {
        const dir = await mkdtemp(join(root, "cwd-"));
        const command = ["printf", "two words", "$HOME", "--env", "--"];
        const child = spawnIn(
            ["eval-run", "--notify", "bob", "--", ...command],
            dir,
        );
        const { out, code } = await finish(child);
        expect(code).toBe(0);
        const call = await submitted();
        const unit = call.find((arg) => arg.startsWith("--unit=")) ?? "";
        expect(unit).toMatch(/^--unit=dorothy-job-eval-run-\d+$/);
        const name = unit.slice("--unit=".length);
        const log = join(
            root,
            "state",
            "dorothy-agents",
            "jobs",
            `${name}.log`,
        );
        expect(call.slice(0, 3)).toEqual([
            "systemd-run",
            "--user",
            "--collect",
        ]);
        expect(call).toEqual(
            expect.arrayContaining([
                "--expand-environment=no",
                "-p",
                `StandardOutput=append:${log}`,
                `StandardError=append:${log}`,
                `ExecStopPost=${stopped} ${name} bob`,
            ]),
        );
        // Everything after the first "--" is the command, as written.
        expect(call.slice(call.indexOf("--") + 1)).toEqual(command);
        expect(out).toBe(`unit: ${name}\nlog: ${log}\n`);
    });

    it("passes no agent as a dash, and runs in the caller's directory", async () => {
        const dir = await mkdtemp(join(root, "cwd-"));
        const { code } = await finish(spawnIn(["x", "--", "true"], dir));
        expect(code).toBe(0);
        const call = await submitted();
        expect(call).toContain(`--working-directory=${await realpath(dir)}`);
        const post = call.find((arg) => arg.startsWith("ExecStopPost=")) ?? "";
        expect(post).toMatch(/ dorothy-job-x-\d+ -$/);
    });

    it("sets by name only the allowlist that is set, and --env names", async () => {
        const dir = await mkdtemp(join(root, "cwd-"));
        const child = spawnIn(
            [
                "x",
                "--env",
                "FOO",
                "--env",
                "PATH",
                "--env",
                "UNSET_ONE",
                "--",
                "true",
            ],
            dir,
            {
                FOO: "foo-value-1",
                DOROTHY_CLAUDE_PRIMARY: "claude-9",
                DOROTHY_CLAUDE_PRIMARY_TOKEN_VAR: "TOKEN_X",
                DOROTHY_OTHER: "no",
                SECRET_TOKEN: "hunter2",
                HERDR_SOCKET_PATH: "/tmp/herdr.sock",
            },
        );
        const { code } = await finish(child);
        expect(code).toBe(0);
        const call = await submitted();
        expect(setenvs(call)).toEqual([
            "DOROTHY_CLAUDE_PRIMARY",
            "DOROTHY_CLAUDE_PRIMARY_TOKEN_VAR",
            "FOO",
            "HERDR_SOCKET_PATH",
            "HOME",
            "PATH",
            "UNSET_ONE",
            "XDG_RUNTIME_DIR",
            "XDG_STATE_HOME",
        ]);
        const joined = call.join("\n");
        for (const value of [
            "foo-value-1",
            "claude-9",
            "hunter2",
            "herdr.sock",
        ]) {
            expect(joined).not.toContain(value);
        }
    });

    it("refuses a checkout path that systemd would split", async () => {
        const spaced = join(root, "a b");
        await mkdir(spaced);
        for (const file of ["job.sh", "job-stopped.sh", "pane-lock.sh"]) {
            await copyFile(join(scripts, file), join(spaced, file));
            await chmod(join(spaced, file), 0o755);
        }
        const { code, err } = await run(join(spaced, "job.sh"), [
            "x",
            "--",
            "true",
        ]);
        expect(code).toBe(1);
        expect(err).toContain("systemd would read");
        expect(await calls()).toEqual([]);
    });

    it("says its usage for a bad name, env name, agent or no command", async () => {
        for (const args of [
            [],
            ["x"],
            ["x", "--"],
            ["bad name", "--", "true"],
            ["-x", "--", "true"],
            ["x", "--env", "A=b", "--", "true"],
            ["x", "--env", "1A", "--", "true"],
            ["x", "--notify", "a b", "--", "true"],
            ["x", "--notify", "-", "--", "true"],
            ["x", "--bogus", "--", "true"],
            ["x", "true"],
        ]) {
            const { code, err } = await run(job, args);
            expect([args, code]).toEqual([args, 2]);
            expect(err).toContain("usage");
        }
        expect(await calls()).toEqual([]);
    });

    it("prints nothing of its own directory when CDPATH is set", async () => {
        const { out, code } = await run(job, ["x", "--", "true"], "", {
            CDPATH: scripts,
        });
        expect(code).toBe(0);
        expect(out.split("\n")).toHaveLength(3);
        expect(out).toMatch(/^unit: dorothy-job-x-\d+\nlog: /);
    });

    it("fails, printing no unit, when systemd-run refuses", async () => {
        await touch("fail-run");
        const { out, code } = await run(job, ["x", "--", "true"]);
        expect(code).toBe(1);
        expect(out).toBe("");
    });
});

describe("job-stopped.sh", () => {
    const unit = "dorothy-job-eval-run-1761900000000000000";
    const jobs = () => join(root, "state", "dorothy-agents", "jobs");
    const result = () => readFile(join(jobs(), `${unit}.result`), "utf8");
    const at = "at=\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ\n$";

    // The helper beside a send-prompt.sh that logs, and fails on demand.
    async function stubSend() {
        const dir = join(root, "stubbed");
        await mkdir(dir);
        for (const file of ["job-stopped.sh", "pane-lock.sh"]) {
            await copyFile(join(scripts, file), join(dir, file));
        }
        const body = `#!/bin/sh
${logging}
cat >"$STUB/send.stdin"
[ -e "$STUB/fail-send" ] || exit 0
echo "send-prompt.sh: boom" >&2
echo "second line" >&2
exit 3
`;
        await writeFile(join(dir, "send-prompt.sh"), body);
        for (const file of ["job-stopped.sh", "send-prompt.sh"]) {
            await chmod(join(dir, file), 0o755);
        }
        return join(dir, "job-stopped.sh");
    }

    it("records an exit, then tells the agent through a timed send", async () => {
        const helper = await stubSend();
        const { code } = await run(helper, [unit, "bob"], "", {
            SERVICE_RESULT: "exit-code",
            EXIT_CODE: "exited",
            EXIT_STATUS: "1",
        });
        expect(code).toBe(0);
        expect(await result()).toMatch(
            new RegExp(
                `^result=exit-code\nexit_code=exited\nexit_status=1\n${at}`,
            ),
        );
        expect(await calls()).toEqual([
            ["send-prompt.sh", "--from", "job:eval-run", "--in", "1s", "bob"],
        ]);
        expect(await readFile(join(root, "send.stdin"), "utf8")).toBe(
            `job ${unit} stopped: exit-code (exited 1); log ${join(jobs(), `${unit}.log`)}\n`,
        );
    });

    it("records a signal", async () => {
        const helper = await stubSend();
        await run(helper, [unit, "bob"], "", {
            SERVICE_RESULT: "signal",
            EXIT_CODE: "killed",
            EXIT_STATUS: "9",
        });
        expect(await result()).toMatch(
            new RegExp(
                `^result=signal\nexit_code=killed\nexit_status=9\n${at}`,
            ),
        );
        expect(await readFile(join(root, "send.stdin"), "utf8")).toContain(
            "stopped: signal (killed 9); log",
        );
    });

    it("records a failed start, which has no exit code or status", async () => {
        const helper = await stubSend();
        await run(helper, [unit, "bob"], "", { SERVICE_RESULT: "resources" });
        expect(await result()).toMatch(
            new RegExp(`^result=resources\nexit_code=\nexit_status=\n${at}`),
        );
        expect(await readFile(join(root, "send.stdin"), "utf8")).toBe(
            `job ${unit} stopped: resources; log ${join(jobs(), `${unit}.log`)}\n`,
        );
    });

    it("keeps the result and exits 0 when the send fails", async () => {
        const helper = await stubSend();
        await touch("fail-send");
        const { code } = await run(helper, [unit, "bob"], "", {
            SERVICE_RESULT: "exit-code",
            EXIT_CODE: "exited",
            EXIT_STATUS: "1",
        });
        expect(code).toBe(0);
        expect(await result()).toMatch(/^result=exit-code\nexit_code=exited\n/);
        expect(
            await readFile(join(jobs(), `${unit}.notify.log`), "utf8"),
        ).toMatch(
            /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ send to bob failed \(3\): send-prompt.sh: boom second line\n$/,
        );
    });

    it("tells no one for a dash, and still records the result", async () => {
        const helper = await stubSend();
        const { code } = await run(helper, [unit, "-"], "", {
            SERVICE_RESULT: "success",
            EXIT_CODE: "exited",
            EXIT_STATUS: "0",
        });
        expect(code).toBe(0);
        expect(await result()).toContain("result=success\n");
        expect(await calls()).toEqual([]);
        expect(await readdir(jobs())).toEqual([`${unit}.result`]);
    });

    it("sends through the real send-prompt.sh as a retried timer", async () => {
        const { code } = await run(stopped, [unit, "bob"], "", {
            SERVICE_RESULT: "success",
            EXIT_CODE: "exited",
            EXIT_STATUS: "0",
        });
        expect(code).toBe(0);
        const [call] = await calls();
        expect(call).toContain("--on-active=1s");
        const id = (call?.find((arg) => arg.startsWith("--unit=")) ?? "").slice(
            "--unit=dorothy-send-".length,
        );
        expect(await readFile(join(sendsDir(), `${id}.msg`), "utf8")).toBe(
            `[from job:eval-run, scheduled] job ${unit} stopped: success (exited 0); log ${join(jobs(), `${unit}.log`)}`,
        );
    });

    it("says its usage for a unit or agent it cannot use", async () => {
        for (const args of [
            [],
            [unit],
            ["../x-1", "-"],
            ["other-1", "-"],
            [unit, "a b"],
        ]) {
            const { code } = await run(stopped, args);
            expect([args, code]).toEqual([args, 2]);
        }
        expect(await readdir(root)).not.toContain("state");
    });
});
