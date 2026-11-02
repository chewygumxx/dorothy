---
ctime: 2026-11-02
mtime: 2026-11-02
spdx: GPL-3.0-only
title: packages/orchestra/AGENTS.md
description: >-
  The orchestra package's guide: an MCP server that runs Claude Code and
  Codex workers boxed, answers their permission requests and pushes
  their work through a sealed broker.
tags:
  - agents
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/packages/orchestra/AGENTS.md
   -
   -->

# packages/orchestra/AGENTS.md

`@dorothy/orchestra` runs Claude Code and Codex workers through acpx,
each in a bubblewrap box, answers their permission requests by rules,
a judge and the user, and pushes their work through a sealed broker.
Its design is the
[orchestration spec](../../docs/specs/2026-11-02-orchestration-design.md).

## Entry points and imports

None yet. It depends on `core` alone among Dorothy's packages, and
never on a model provider's SDK: the judge reaches a model as core's
`StructuredCall`.

## Files

- `config.ts`: `[orchestra]` in `config.toml` (`parseOrchestra`,
  `readOrchestra`), every fault an error; `hostName` and
  `isPlainWords`, which the proxy and the rules share.
- `environment.ts`: `reexecClean`, the server running again with the
  allowlist of `serverEnvironment` alone, whoever started it.
- `box/box.ts`: `boxArgs`, bubblewrap's arguments for a box from an
  empty root (`systemLayout` the host's `/usr` links and `/etc`
  entries), its clone the one read-write mount, or none; and
  `boxAvailable`. `box/bridge.ts` runs inside a box, never imported:
  loopback ports forwarded to the box's sockets.
- `box/worker-box.ts`: `workerBox`, async, a worker's `BoxSpec`: its adapter
  (`adapterFor`) behind the bridge, the proxy's variables, and its
  login (`WorkerLogin`) alone: a subscription's files read-only, an API
  key's agent pointed at the gateway with the placeholder; admitted keys
  enter through a private file removed with the sockets directory;
  `providerHosts`, what the proxy admits for each login; `MODES`.
- `net/proxy.ts`: `startProxy`, a box's egress on its own socket: one
  `CONNECT` to an exact host on port 443, resolved here, every address
  public (`net/addresses.ts`), bounded in size, time and number.
- `net/key-gateway.ts`: `startKeyGateway`, for a box signed in by API
  key: the provider's model paths alone, the box's placeholder replaced
  by the real key, sent to the fixed upstream, usage logged, never a
  key or a body. Not `@dorothy/gateway`, which serves Dorothy's chat.
- `broker/git.ts`: `sealedGit`, the one runner of host git: `git`
  resolved once (`resolveGit`), the broker's own global config and no
  system one, hooks, maintenance, gc and submodules off, no `GIT_*`
  variable of the caller's (`sealedEnvironment`); `runGroup`, each
  process in a session of its own, its group killed at the deadline
  (`Timers`, which `openBroker` takes) or on its operation's abort;
  `drainGroups` waits for its scope's killed groups.
- `broker/identity.ts`: `readIdentity`, `<owner>/<name>` from the
  checkout's origin URL as written, in GitHub's forms alone
  (`repoIdentity`; `localRemotes` admits a bare path, in tests alone).
- `broker/repository.ts`: `openBroker`, a `Broker` per identity: its
  bare clone of the checkout under the state root, made once, no
  remote, gc and maintenance off; its global config beside it, and the
  sealed environment gh shares.
- `broker/base.ts`: `fetchBase`, the remote's default branch into
  `refs/orchestra/<server>/<worker>/base`. `broker/reservation.ts`:
  `reserveBranch`, a file made exclusively per branch, refused if taken
  or on the remote. `broker/clone.ts`: `makeClone`, a shared clone
  under the worktree root on the new branch, the last host git in it.
- `broker/fetch.ts`: `fetchWork`, a worker's branch into
  `refs/orchestra/<server>/<worker>/work/<branch>`, its upload-pack boxed:
  the clone and the broker's objects read-only, nothing writable.
- `broker/push.ts`: `recordPush`, a push's values fixed before it is
  sent; `pushWork`, that OID to that ref under the lease, a plain push
  a fast-forward of the last, asking the user (`Ask`) for a forced
  lease or a change to `DEPENDENCY_FILES`, its diff capped (`capDiff`);
  `reconcilePush`, a lost push's `Outcome` read from the remote.
- `broker/pull-request.ts`: `openPullRequest`, `gh pr create` for the
  branch (`resolveGh`), and `reconcilePullRequest` by `gh pr list`.
- `broker/branches.ts`: `Branches`, each branch's last pushed OID, the
  `last` its next push expects, and an unknown push, which that next
  push asks the user about; `push` and `pullRequest` the operations'
  works, a pull request refused before a successful push.
- `operations.ts`: `Operations`, every changing tool's operation by its
  `operationId` and digest, recorded before it runs and returned, never
  run again, on a repeat; a queue's run in order, `cancel` dropping a
  worker's pending; `close` stopping every worker, then the grace,
  `GRACE_MS`, the kill and reconciliation, the rest `unknown`;
  `Run.signal` covers preparation, `reconcileSignal` the second grace;
  `closeOn`, the client's EOF or a signal. `log.ts`: `openLog`, the
  server's log at `logPath`, one JSON object a line.
- `engine/`: workers, their sessions, turns and waits:
  [guide](./src/engine/AGENTS.md)
- `fixtures/repos.ts`: a bare remote, a checkout one commit ahead and
  a user's home, for the broker's tests.
- `fixtures/timers.ts`: `FakeTimers`, a grace or deadline advanced by
  the test.
- `fixtures/fake-agent.ts`: an ACP agent of no dependency, in place of
  an adapter in tests: Claude's or Codex's modes, permission options
  and key variables (`--as`), and misbehaviour on cue
  (`--ignore-answers`, `--pin-mode`, `--exit-after-prompt`).
- The package's `scripts/real-agent-gate.ts`: the real-agent gate, run
  live outside CI, every root under a temporary one: a signed-in agent
  boxed and driven through acpx with fixed prompts, each check judged
  by its effects (the proxy's and gateway's logs, files in the clone,
  the process table), one line each; mandatory permission evidence
  absent is FAIL; `runGate`. Its header gives the
  flags. `box/processes.ts`: `processTree` and `survivors`, a box's
  processes from /proc, for the gate and the engine's tests.
- `shell.ts`: `parseShell`, a conservative grammar for literal shell lists,
  pipelines and redirections; unsupported constructs stay unparsed.
- `rules.ts`: `ruleRequest`, ACP tool inputs and clone paths under the
  built-in and configured rules. Explicit denials outrank unparsed
  commands; unparsed commands ask, and unmatched requests need a judge.
- `gate.ts`: `createGate`, raw ACP requests through rules, a judge and
  an injected `Ask`, logged and answered with the first exact once-only
  option. `judge.ts`: `judgeRequest`, core's `StructuredCall` with fenced
  untrusted input and a checked result. `deadline.ts`: `beforeDeadline`,
  injected timeouts and cancellation even when a callback ignores abort.
- `questions.ts`: `createQuestions`, an MCP server's injected `Ask`,
  a worker's `pending` ids, worker stop and close. Connect through its
  `transport` wrapper to add JSON-RPC ids to question metadata and
  cancel before closing. It uses the same MCP SDK version as memory,
  with the 2025-06-18 form shape.

## Invariants

- Every root, environment and clock is passed in; tests use temporary
  ones and never reach a real agent or provider. Only the real-agent
  gate does, run by hand, and it never reads `secrets.json`.
- A box mounts nothing of the host but what `BoxSpec` names; tests of
  real boxes skip where bubblewrap cannot make a user namespace.
- Every host git process runs through `sealedGit`, in the broker
  repository but for the steps that make a clone; none runs in a
  worker's clone after `makeClone`, which only a boxed upload-pack
  reads.
- The broker pushes one recorded OID to one branch of the remote's
  URL: never another branch, a tag, a deletion or a submodule.
- An operation acts once per `operationId`, and nothing is retried: an
  outcome lost is reconciled against the remote or stays `unknown`.
