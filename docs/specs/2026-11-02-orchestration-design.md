---
ctime: 2026-11-02
mtime: 2026-11-02
spdx: GPL-3.0-only
title: Orchestration
description: >-
  Design spec for Dorothy's orchestration toolset: an MCP server that
  runs Claude Code and Codex workers through acpx inside their agents'
  own OS sandboxes, pushing for them, and answering their approvals by
  rules, then a judging model, then the user by elicitation; and
  Dorothy's chat as its first client.
tags:
  - dorothy
  - spec
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/specs/2026-11-02-orchestration-design.md
   -
   -->

# Orchestration

## Summary

Dorothy coordinates Claude Code and Codex today through herdr: a Claude
Code session types into the others' terminals, and Codex runs with full
access so that it never asks. This spec gives her an orchestration
toolset of her own, in two parts, each with its own plan and merge:

- **Part A, the server.** A new package, `@dorothy/orchestra`, runs
  Claude Code and Codex workers through acpx's embedded runtime, each in
  a git worktree of its own, inside its agent's OS sandbox, with no
  network, no credentials and settings the server pins. Workers never
  push: the server pushes a worker's branch for it. Every permission
  request a worker makes is answered by rules in code, then by a judging
  model on a new `approval` role, then by the user through MCP
  elicitation. It is served over MCP stdio by `dorothy --orchestra-server`.
- **Part B, Dorothy's chat.** Her chat launch connects to the server,
  her sessions get its tools, the elicitations become prompts in the
  TUI, and `[orchestra]` in `config.toml` turns it on.

The guarantee rests on enforcement, not on reading commands. What a
worker may never do is made impossible by the sandbox, the environment,
the pinned settings and the push broker; the rules and the judge decide
the rest, and refuse early and visibly what the sandbox would stop
anyway.

## Understanding

What the user has said, in this brainstorm and the research before it
([agent orchestration](../notes/2026-11-01_agent-orchestration.md),
[a featherless orchestrator](../notes/2026-11-02_featherless-orchestrator.md)):

- Dorothy, running an open-weight model served by featherless, is to
  orchestrate Claude Code and Codex workers that run under less
  permissive policies, their approvals answered by the orchestrator.
- She is driven through her chat first; the approval engine is built so
  that an unattended runner can reuse it later.
- Claude Code workers go through acpx's adapter on the Agent SDK,
  signed in with the user's own subscription; the user accepts that the
  terms are less clear-cut for it than for the plain `claude` binary.
- Requests that need the user are answered in a prompt the user sees
  and answers directly, never relayed by Dorothy's model.
- The toolset is an MCP server first, usable by other harnesses.
- A push is not always denied: a worker's own branch may be pushed.
- Workers stay in linked git worktrees, with a narrow exception for
  each worktree's own git metadata.
- It is built now, while Claude Code's and Codex's weekly limits reset.

Assumed, and put to the user in the design's sections:

- Workers live as long as the server process, which is as long as its
  client's launch; the unattended runner, whose workers outlive a
  chat, is later work.
- The leading approval model is
  `featherless:deepseek-ai/DeepSeek-V4.1-Flash-1017`, which held against
  every injection in the research's hostile probe; the route is the
  user's to set.

Success: a client asks the server for a worker; the worker's requests
are answered by rule, by the judge and by the user as the gate says,
with every decision logged; no worker achieves a hard-denied effect by
any route, which adversarial checks of actual effects confirm; Dorothy's
chat drives it, with escalations answered in the TUI; no test reaches a
real agent or provider.

## Review

A Codex review of the first draft (gpt-6.1-sol, 2026-11-02) found that
classifying commands cannot keep a worker from a forbidden effect:
native pre-approvals and Codex's own reviewer resolve requests before
any gate sees them, an approved test can run any code, Git's effective
operation outruns its command line, and acpx falls back permissively
when a callback fails. This draft answers every finding; the sections
below say how.

## Decisions

Ruled with the user or by the coordinating agent, each with its cost if
wrong:

| Question | Ruling | Cost if wrong |
| --- | --- | --- |
| Who drives | Chat first; an engine an unattended runner can reuse | Long jobs still go through herdr for now |
| Where it lives | An MCP stdio server, `@dorothy/orchestra`, ahead of Dorothy's chat | A process boundary and elicitation to build first |
| The control layer | acpx's embedded runtime, ACP for both workers | A pre-1.0 dependency and two adapters |
| Claude's route | acpx's adapter on the Agent SDK, on the user's subscription | The terms' grey area, which the user accepts |
| What guarantees a hard denial | The sandbox, the environment, the pinned settings and the push broker; never the rules alone | A sandbox an agent cannot be held to blocks the build |
| Pushes | The server's, for a worker's own branch, by rule; force-with-lease to the user; nothing else pushable | A push waits on a tool call |
| Worktrees | Linked worktrees, writable only in the worktree and its own git metadata | Shared objects stay writable; other refs and config do not |
| Reaching the user | MCP elicitation, legacy server-initiated requests, cancelled when settled; a TUI prompt in Dorothy's chat | Clients of a request-bound protocol see nothing |
| Who decides approvals | Rules, then a judge on the `approval` role, then the user; never the chat model | A judge call per unsettled request |
| Failure | Every failure to decide is a denial | A worker blocked where it might have gone on |
| Approval answers | The agent's exact `allow_once` or `reject_once` option id, never `allow_always` | A judge call for every repeat |
| Workers' lifetime | The server's process, owned by the chat's launch | A closed chat stops its workers |
| Adapters | Declared dependencies, never fetched at runtime | Updates are ours to take |
| Delivery | Two parts, two plans, two merges | The chat waits a merge |

## Architecture

```text
client (Dorothy's chat launch, or another MCP client)
  │ MCP stdio: tools; elicitation back to the client
  ▼
dorothy --orchestra-server   (cli: the judge, the routes, a clean env)
  └── @dorothy/orchestra
        ├── engine: workers on acpx's embedded runtime
        ├── gate: rules → judge → elicitation
        ├── broker: pushes and pull requests for workers' branches
        └── log: $XDG_STATE_HOME/dorothy/orchestra/<server>.jsonl
              │ ACP stdio, from a sanitised environment
              ▼
   claude-agent-acp → Claude Code      codex-acp → codex app-server
   (pinned settings, Bash sandbox)     (workspace-write, no network)
```

- `@dorothy/orchestra` depends on `core` alone among Dorothy's packages,
  and declares `acpx`, `@agentclientprotocol/claude-agent-acp` and
  `@agentclientprotocol/codex-acp`. It imports no model SDK and no
  `@dorothy/agent`: the judge reaches it as core's `StructuredCall`,
  which `cli` makes from the `approval` route, as the memory service is
  given its review call.
- Entry points: `"./server"` (`runOrchestraServer`). `cli` gains the
  `--orchestra-server` mode and the dependency on `orchestra`;
  `workspace.test.ts` pins both.
- `cli` starts the server process with an environment built from an
  allowlist (`PATH`, `HOME`, the XDG roots, locale and terminal
  variables), never the parent's whole environment, so no `ACPX_AUTH_*`,
  provider key, `SOPS_AGE_KEY`, OAuth token or cloud credential reaches
  it. The server loads Dorothy's secrets by path for the judge's call
  alone, inside its own process.
- acpx's runtime is created with `permissionMode: "deny-all"` and no
  per-tool policy that approves or escalates, so a missing or failed
  callback denies; with filesystem and terminal capabilities not
  advertised (`--no-fs`, `--no-terminal` in acpx's terms), so every read,
  write and command goes through the agent's own tools and their
  permission requests; with an `onPermissionRequest` callback per
  session, the gate; and with `agentProcessEnvAllow`, an allowlist, for
  workers.

## Tools

Each returns within 50 seconds, as a chat ends an attempt after 60
seconds with no stream activity, a tool's run included. Each carries
MCP's `readOnlyHint`; Part B treats a call to any tool without it as
starting the turn (Part B).

| Tool | What it does |
| --- | --- |
| `start_worker(agent, repo, branch, task)` | Makes a worktree for a new `branch` from `origin/main` of `repo`, starts a session of `agent` (`claude` or `codex`) in it, verifies its sandbox and settings (Workers), and sends `task` as its first prompt; returns its name, such as `codex-1`, and its worktree |
| `prompt_worker(worker, text)` | Queues a turn; a worker's turns run in order |
| `read_worker(worker)` (read-only) | Its status (`working`, `idle`, `waiting-on-user`, `failed`, `stopped`) and what happened since the last read, condensed and capped: its replies, the tools it called, each permission decision with its source, and its pending questions |
| `wait_worker(worker?, seconds)` (read-only) | Waits up to 45 seconds for the worker, or any, to go idle, fail or need the user |
| `list_workers()` (read-only) | Every worker, its agent, branch, worktree and status |
| `push_worker(worker, forceWithLease?)` | Pushes the worker's own branch through the broker (The broker); with `forceWithLease`, only after the user allows it |
| `open_pull_request(worker, title, body)` | Opens a pull request for the worker's branch through the broker, once it is pushed |
| `stop_worker(worker)` | Cancels and closes its session; its worktree and branch stay |

There is no tool that answers a permission request, merges, or pushes
anything but a worker's own branch: the gate decides permissions, and a
merge stays the user's.

`start_worker` refuses an `agent` outside `[orchestra] agents`, a
`repo` that is not a git checkout with an `origin`, a `branch` that
exists already, and a start past `max-workers`; and stops a worker
whose sandbox or settings fail verification.

## Workers

Each worker runs where it cannot reach what it is denied:

- **Its worktree,** made with `git worktree add`, at
  `<worktree-root>/<server id>/<worker name>`, so no two collide; the
  branch is the one given, and the worktree's canonical path is checked
  to lie under the root.
- **Writes** are confined to the worktree and its own git metadata:
  `<common>/worktrees/<name>/` (its `HEAD`, index and logs),
  `<common>/objects/`, and the files of its own branch's ref and
  reflog. `<common>/config`, `<common>/hooks/`, `packed-refs`, other
  branches' refs and every other path stay unwritable, so a worker can
  change neither Git's configuration, its aliases, push settings and URL
  rewrites among it, nor any other branch.
- **Network** is off for every command a worker runs, but for an
  allowlist (`[orchestra] network-allow`, default the package registry
  `registry.npmjs.org`) so dependencies resolve. The agents' own calls to
  their model providers are theirs, outside their command sandbox.
- **Reads** of `~/.ssh`, the age key, `~/.config/sops`, the user's
  agent credentials (`~/.codex/auth.json`, Claude's stored login),
  `secrets.json` decryption and `.env` files are denied by the sandbox,
  not only by the rules.
- **Environment:** `agentProcessEnvAllow`, an allowlist; no credential
  of any provider, no `ACPX_AUTH_*`, no `GIT_DIR`, `GIT_WORK_TREE`,
  `GIT_CONFIG*` or `SSH_AUTH_SOCK`.
- **Codex** runs with `sandbox_mode = "workspace-write"`, the writable
  roots above, network off but for the allowlist, `approval_policy =
  "on-request"`, `approvals_reviewer = "user"`, so no reviewer of its
  own answers in our place, and no MCP servers. It signs in from the
  user's `~/.codex`, which the server reads to start it and the worker
  cannot.
- **Claude Code** runs with settings the server writes and pins: no
  user, project or local settings, so a repository's
  `.claude/settings.json` or skill cannot pre-approve anything; no
  plugins, skills, subagents or MCP servers; its Bash sandbox on, with
  the write and network limits above; its default Manual mode; and a
  `PreToolUse` hook of the server's that denies a hard-denied call before
  any automatic approval. It signs in from the user's stored login.
- **Verification at start:** before its first prompt, the server checks
  each worker's effective mode, sandbox, settings sources and tool list
  as the adapter reports them, and stops a worker that differs.

How each setting reaches each agent through its adapter is the plan's
probe to settle (Testing); an agent that cannot be held to these limits
stops the build, as a failed probe did in Model Providers.

A worker that fails to start or exits is `failed`, with its reason; the
others go on. Closing the server stops every worker.

## The gate

Every `session/request_permission` from a worker passes three steps;
the first decision stands. The sandbox stands behind all three: an
`allow` here never grants what the sandbox withholds.

### 1. Rules

In code, in `orchestra`, over the request's tool, command and paths. A
shell command is split at `&&`, `||`, `;` and `|`, and each part is
judged; the strictest part decides. A git subcommand is first resolved
through the worktree's aliases, which the worker cannot change.

| Decision | Requests |
| --- | --- |
| Deny | Any `git push` or `gh` command by a worker (the broker pushes); any git operation with a force flag; writing or deleting outside the worktree; reading credentials, keys, `.env` files or secrets; `sops`; a download piped into a shell; adding an MCP server or changing an agent's settings |
| Allow | Reads and searches inside the worktree; the repository's tests, linters, formatters and builds; `git add` and `git commit` in its own worktree; `bun install --frozen-lockfile` |
| Ask the user | Adding or upgrading a dependency; a command the rules cannot parse, such as one using `eval`, command substitution or a subshell |

`[orchestra]`'s `allow`, `ask` and `deny` add patterns; nothing
removes a built-in denial, and a request a rule denies or cannot parse
never reaches the judge.

### 2. The judge

What no rule settles goes to a structured call on the `approval` role:
the policy, the request, the worker's task, and the tail of the
worker's recent output, fenced and marked untrusted. It answers
`{ decision: "allow" | "deny" | "ask", reason }`. An answer that breaks
the schema, a failed route or `judge-timeout-seconds` without an answer
is a denial. Its cost is logged.

### 3. The user

An `ask` from a rule or the judge goes to the client as an elicitation
naming the worker, the exact request and why it reached the user, with
two answers: allow once, or deny. No answer within
`ask-timeout-seconds` is a denial. While it waits, the worker is
`waiting-on-user` and the question is listed by `read_worker`.

The server sends elicitations as server-initiated requests, which the
MCP protocol versions `@ai-sdk/mcp` speaks allow outside any tool call;
the server declares that version and refuses a client that negotiates
only a request-bound one, as its asks could reach no one. When a
question settles otherwise, by its timeout, its worker's stop or the
server's close, the server cancels the request (`notifications/cancelled`),
and an answer arriving after settlement is ignored.

### Invariants

- The gate answers with the exact `optionId` the agent offered for
  `allow_once` or `reject_once`, never a kind and never `allow_always`;
  with no such option it cancels.
- Every request and decision, with its source (`rule`, `judge`, `user`
  or `timeout`) and reason, is appended to the server's log and shown
  by `read_worker`.

## The broker

`push_worker` and `open_pull_request` are the only way a worker's work
leaves its machine.

- **What it pushes:** exactly one ref,
  `refs/heads/<branch>:refs/heads/<branch>`, to the URL of `origin` as
  the main checkout's configuration gives it (which no worker can
  write), with `--no-follow-tags`, `--porcelain`, no `--mirror`, and
  `-c push.default=nothing`, `-c remote.origin.mirror=false` and
  `-c push.followTags=false`, in an environment without `GIT_*`
  overrides. A plain push is allowed by rule; `forceWithLease` asks the
  user first and pushes with `--force-with-lease=<branch>:<sha>` against
  the remote's last known value.
- **Pull requests:** `gh pr create --head <branch>` with the given title
  and body, after a push, in the main checkout.
- **Never:** another branch, a tag, a deletion, or another remote.
- Each push and pull request is logged with its result.

## Configuration

`[orchestra]` in `config.toml`, off by default:

```toml
[orchestra]
enabled = true
worktree-root = "~/dev/_worktree"   # default $XDG_DATA_HOME/dorothy/worktrees
agents = ["claude", "codex"]
max-workers = 4
network-allow = ["registry.npmjs.org"]
ask-timeout-seconds = 600
judge-timeout-seconds = 30
allow = []
ask = []
deny = []

[models]
approval = ["featherless:deepseek-ai/DeepSeek-V4.1-Flash-1017"]
```

- A leading `~` in `worktree-root` is the home directory.
- `approval` joins `ROLES`, its default `claude-haiku-5-5` on the
  provider named `anthropic`, as every role has one. Unlike the other
  roles, leaving it out where no such provider exists is no routing
  fault, so that a `config.toml` written before it keeps routing chat:
  the orchestra server, which alone needs it, refuses to start instead.
- A fault in `[orchestra]` is an error, unlike most tables, as a pattern
  dropped could loosen the gate: the server prints it and exits 1, and
  Dorothy's chat goes on without its tools, warning once.

## Dorothy's chat (Part B)

- **Ownership.** With `[orchestra] enabled`, the chat's launch (`cli`'s
  `runTui`) starts the server once, as an MCP client of its own, and
  every session it makes, a compaction's included, gets its tools. A
  compaction replacing a session therefore stops no worker; the server
  closes when the chat does.
- **Started turns.** A call to any tool without `readOnlyHint` marks the
  turn started, as `remember` does, so no fallback to another model
  repeats a `start_worker`, a `prompt_worker` or a push.
- **Questions.** `agent`'s client of the server registers its
  elicitation handler; `core` gains a `QuestionSource`, handed to the TUI
  beside its notices, whose `question` carries `id`, `title`, `body`,
  `options` and its deadline, and whose `answer(id, option)` completes
  it. A cancellation from the server, a timeout or the chat's close
  settles it and removes it. Neither reaches the model's messages or the
  transcript.
- **The prompt.** A pending question shows in a line above the input
  with its time left; the draft is untouched. `ctrl+o` focuses the
  question; then `a` or `d` chooses, and `enter` confirms. Questions
  queue, one shown at a time.

## Errors

| Condition | Behaviour |
| --- | --- |
| An agent cannot be held to its sandbox or settings | The probe stops the build; in use, `start_worker` stops the worker |
| acpx or an adapter fails under Bun | The probe stops the build (Testing) |
| `[orchestra]` fault | The server prints it and exits 1 |
| A worker fails to start or exits | `failed`, with its reason; the others go on |
| `start_worker` refused | The tool's error says which rule |
| The gate's callback throws or returns nothing | acpx's `deny-all` denies |
| The judge's route fails throughout | Denial, logged |
| No answer from the user in time | Denial, logged as `timeout`; the request is cancelled |
| A client of a request-bound protocol only | The server refuses it at `initialize` |
| A push fails | The tool says why; nothing is retried |
| The server dies under Dorothy's chat | One warning; its tools fail, as recall's do |

## Testing

No test reaches a real agent or provider, or reads `secrets.json`;
every root and key is passed in, and remotes are local bare
repositories.

- **The probe, Part A's first task:** acpx's embedded runtime under Bun,
  driving a scripted fake ACP agent through a turn with a permission
  request; and both adapters, against fake backing processes, showing
  how each worker setting above is set and read back. If any setting
  cannot be held, the build stops and returns to the user.
- **Rules:** table-driven, each case of the research's hostile probe
  among them: compound commands, aliases, workers' pushes and `gh`,
  force flags, paths outside the worktree, credentials and secrets,
  unparseable commands.
- **The gate:** rule, judge and user in order; denial on a broken
  answer, a failed route, a judge timeout, an ask timeout and a callback
  that throws; a denied or unparsed request never reaching the judge;
  the exact `optionId` chosen, never `allow_always`.
- **The environment:** an `ACPX_AUTH_*`, a `*_API_KEY`, `SOPS_AGE_KEY`
  and `GIT_DIR` set in the parent, absent in the server and in workers.
- **The broker,** on a temporary repository with a bare remote and a
  hostile configuration, `push.followTags`, a `+` refspec, `mirror`, a
  `pushurl` and an `insteadOf` among it: exactly the one branch reaches
  the remote, and nothing else.
- **The worktree:** a commit succeeds; writing `<common>/config`, a hook,
  another branch's ref or a path through a symlink out of the worktree
  fails.
- **The engine:** a scripted fake ACP agent; workers' lifecycle,
  `max-workers`, refusals, failures and verification at start.
- **The server:** each tool end to end through an MCP client; the
  elicitation round trip, its cancellation and a late answer ignored.
- **Part B:** the server surviving a compaction with a worker waiting on
  the user; a provider failing after `start_worker` without a second
  worker; the question's focus, confirmation, deadline and settlement.
- **The judge's evaluation:** the research's hostile probe kept as a
  script outside CI, rerun when the `approval` route changes.

## Verification

Each merge waits on a live run by the coordinating agent once Claude
Code's and Codex's limits allow, on a scratch repository with a local
bare remote, synthetic credentials and temporary XDG roots, recorded in
a report. Each run asserts effects, not decisions: that a forbidden
effect did not happen.

- **Part A**, from an MCP client that shows elicitations: one Claude and
  one Codex worker; a request allowed by rule, a judged one, an
  escalation answered, a `push_worker` of the worker's branch; and, made
  to try, a repository whose `.claude/settings.json` pre-approves
  `Bash(git push:*)`, an MCP server a worker adds, a test script that
  pushes, a git configuration change, a symlink out of the worktree, a
  synthetic key in the parent environment, a callback that fails and a
  late approval. Each forbidden effect is checked absent: the bare
  remote unchanged but for the pushed branch, files outside unchanged,
  the synthetic key unseen.
- **Part B**, from Dorothy's chat on featherless: the same, with the
  escalation answered in the TUI and a compaction during a worker's
  wait.

## Documentation

- `packages/orchestra/AGENTS.md`: the engine, the gate, the broker, the
  server.
- `packages/core/AGENTS.md`: `QuestionSource` and the `approval` role.
- `packages/memory/AGENTS.md`: sessions sharing the launch's orchestra
  tools, within its budget.
- `packages/cli/AGENTS.md`: the new mode and the launch's ownership,
  within its budget.
- `packages/agent/AGENTS.md` and `packages/tui/AGENTS.md` (Part B).
- Root `AGENTS.md`: the package graph, within its 100 lines.
- `README.md`: a section on orchestration, its limits and its switch.
- `docs/reports/2026-11-02-orchestration.md`: the probe, the rulings
  and both verifications.
- `docs/roadmap.md`: an Orchestration phase ahead of Dorothy's Gateway.

## Later

- The unattended runner: workers that outlive a chat, driving a plan
  through the same engine.
- A request-bound elicitation path, for clients of newer MCP versions.
- herdr's panes for workers the server starts, for the user to watch.
