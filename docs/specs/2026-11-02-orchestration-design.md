---
ctime: 2026-11-02
mtime: 2026-11-02
spdx: GPL-3.0-only
title: Orchestration
description: >-
  Design spec for Dorothy's orchestration toolset: an MCP server that
  runs Claude Code and Codex workers through acpx under less permissive
  policies, answering their approvals by hard rules, then a judging
  model, then the user by elicitation; and Dorothy's chat as its first
  client.
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
  a worktree of its own and under a less permissive policy than today's.
  Every permission request a worker makes is answered by hard rules in
  code, then by a judging model on a new `approval` role, then by the
  user through MCP elicitation. It is served over MCP stdio by
  `dorothy --orchestra-server`, so any client that shows elicitations
  can use it.
- **Part B, Dorothy's chat.** Her chat connects to the server as a
  second MCP client beside recall, the elicitations become prompts in
  the TUI, and `[orchestra]` in `config.toml` turns it on.

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
- The toolset is an MCP server first, usable by any harness.
- A push is not always denied: a worker's own branch may be pushed.
- It is built now, while Claude Code's and Codex's weekly limits reset.

Assumed, and put to the user in the design's sections:

- Workers live as long as the server process, which is as long as its
  client's session; the unattended runner, whose workers outlive a chat,
  is later work.
- The leading approval model is
  `featherless:deepseek-ai/DeepSeek-V4.1-Flash-1017`, which held against
  every injection in the research's hostile probe; the route is the
  user's to set.

Success: a client asks the server for a worker, the worker's requests
are answered by rule, by the judge and by the user as the gate says,
with every decision logged and none of the hard denials ever allowed;
Dorothy's chat drives it, with escalations answered in the TUI; no test
reaches a real agent or provider.

## Decisions

Ruled with the user or by the coordinating agent, each with its cost if
wrong:

| Question | Ruling | Cost if wrong |
| --- | --- | --- |
| Who drives | Chat first; an engine an unattended runner can reuse | Long jobs still go through herdr for now |
| Where it lives | An MCP stdio server, `@dorothy/orchestra`, ahead of Dorothy's chat | A process boundary and elicitation to build first |
| The control layer | acpx's embedded runtime, ACP for both workers | A pre-1.0 dependency and two adapters |
| Claude's route | acpx's adapter on the Agent SDK, on the user's subscription | The terms' grey area, which the user accepts |
| Reaching the user | MCP elicitation, shown by the client; in Dorothy's chat, a TUI prompt | A client without elicitation can only be denied |
| Who decides approvals | Rules, then a judge on the `approval` role, then the user; never the chat model | A judge call per unsettled request |
| Failure | Every failure to decide is a denial | A worker blocked where it might have gone on |
| Approval kinds | `allow_once` and `reject_once` only, never `allow_always` | A judge call for every repeat of a request |
| Pushes | The worker's own branch to `origin` by rule; force-with-lease and tags to the user; the rest denied | A wrong branch match blocks or allows a push |
| Workers' lifetime | The server's process | A closed chat stops its workers |
| Adapters | Declared dependencies, never fetched at runtime | Updates are ours to take |
| Delivery | Two parts, two plans, two merges | The chat waits a merge |

## Architecture

```text
client (Dorothy's chat, Claude Code, Codex, ...)
  │ MCP stdio: tools, and elicitation back to the client
  ▼
dorothy --orchestra-server        (cli wires the judge and the routes)
  └── @dorothy/orchestra
        ├── engine: workers on acpx's embedded runtime
        ├── gate: rules → judge → elicitation
        └── log: $XDG_STATE_HOME/dorothy/orchestra/<server>.jsonl
              │ ACP stdio
              ▼
   claude-agent-acp → Claude Code        codex-acp → codex app-server
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
- The server loads Dorothy's secrets by path from the checkout, as the
  service and the hook do, for the judge's call alone (Workers).

## Tools

Each returns within 50 seconds, as a chat ends an attempt after 60
seconds with no stream activity, a tool's run included.

| Tool | What it does |
| --- | --- |
| `start_worker(agent, repo, branch, task)` | Makes a worktree for `branch` from `origin/main` of `repo` with `git worktree add`, starts a session of `agent` (`claude` or `codex`) in it, and sends `task` as its first prompt; returns its name, such as `codex-1`, and its worktree |
| `prompt_worker(worker, text)` | Queues a turn; a worker's turns run in order |
| `read_worker(worker)` | Its status (`working`, `idle`, `waiting-on-user`, `failed`, `stopped`) and what happened since the last read, condensed and capped: its replies, the tools it called, and each permission decision with its source |
| `wait_worker(worker?, seconds)` | Waits up to 45 seconds for the worker, or any, to go idle, fail or need the user |
| `list_workers()` | Every worker, its agent, branch, worktree and status |
| `stop_worker(worker)` | Cancels and closes its session; its worktree and branch stay |

There is no tool that answers a permission request, merges or pushes:
the gate decides permissions, and a worker's work leaves its branch only
through the gate.

`start_worker` refuses an `agent` outside `[orchestra] agents`, a
`repo` that is not a git checkout, a `branch` that exists and is not a
worker's of this server, and a start past `max-workers`.

## Workers

- Codex starts in codex-acp's `agent` mode (workspace-write, on
  request), never `agent-full-access`; Claude in its default Manual
  mode. Both therefore ask for what goes past reads and edits in their
  worktree.
- Each runs with its worktree as `cwd`.
- Their environment is the server's, less every key a provider names,
  every `*_API_KEY` and every `CLAUDE_CODE_OAUTH_TOKEN*` (acpx's
  `agentProcessEnvBlock`). They sign in as the user's own Claude Code
  and Codex do.
- A worker that fails to start or exits is `failed`, with its reason;
  the others go on. Closing the server stops every worker.

## The gate

Every `session/request_permission` from a worker passes three steps;
the first decision stands.

### 1. Rules

In code, in `orchestra`, over the request's tool, command and paths.
A shell command is split at `&&`, `||`, `;` and `|`, and each part is
judged; the strictest part decides. A git subcommand is first resolved
through the worktree's own `alias.*` config. A command the rules cannot
parse, such as one using `eval`, command substitution or a subshell, is
never allowed by a rule: it goes to the judge.

| Decision | Requests |
| --- | --- |
| Deny, always, with no override | A push to any remote but `origin`, or to a branch not the worker's own; `git push --force` without `-with-lease`, and any force push of tags; deleting a remote branch; any other git operation with a force flag; writing or deleting outside the worker's worktree; reading `~/.ssh`, the age key, `.env` files or other credential stores; `sops -d`, `sops edit` or any decryption of secrets; a download piped into a shell |
| Allow | Reads and searches inside the worktree; the repository's tests, linters, formatters and builds; `git add` and `git commit` in its own worktree; `git push` of its own branch to `origin`, with no refspec, `HEAD` or the branch's own name; `gh pr create` for its own branch; `bun install --frozen-lockfile` |
| Ask the user | `git push --force-with-lease` of its own branch; pushing tags; `gh pr merge`; adding or upgrading a dependency; changing a repository's settings |

A worker's own branch is the one `start_worker` named, matched against
the push's resolved refspec and the worktree's current branch.
`[orchestra]`'s `allow`, `ask` and `deny` add patterns; nothing removes
a built-in denial.

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
`ask-timeout-seconds`, or a client that does not support elicitation,
is a denial. While it waits, the worker is `waiting-on-user`.

### Invariants

- The gate answers with the agent's own `allow_once` or `reject_once`
  option, by kind, never `allow_always`; with no such option it
  cancels.
- Every request and decision, with its source (`rule`, `judge`, `user`
  or `timeout`) and reason, is appended to the server's log and shown
  by `read_worker`.

## Configuration

`[orchestra]` in `config.toml`, off by default:

```toml
[orchestra]
enabled = true
worktree-root = "~/dev/_worktree"   # default $XDG_DATA_HOME/dorothy/worktrees
agents = ["claude", "codex"]
max-workers = 4
ask-timeout-seconds = 600
judge-timeout-seconds = 30
allow = []
ask = []
deny = []

[models]
approval = ["featherless:deepseek-ai/DeepSeek-V4.1-Flash-1017"]
```

- A worktree is `<worktree-root>/<repo>/<branch>`, the branch's `/`
  written `-`; a leading `~` in `worktree-root` is the home directory.
- `approval` joins `ROLES`, its default `claude-haiku-5-5` on the
  provider named `anthropic`, as every role has one. Unlike the other
  roles, leaving it out where no such provider exists is no routing
  fault, so that a `config.toml` written before it keeps routing chat:
  the orchestra server, which alone needs it, refuses to start instead.
- A fault in `[orchestra]` is an error, unlike most tables, as a pattern
  dropped could loosen the gate: the server prints it and exits 1, and
  Dorothy's chat goes on without its tools, warning once.

## Dorothy's chat (Part B)

- With `[orchestra] enabled`, a session starts the server as it starts
  recall, `dorothy --orchestra-server` over MCP stdio with the same
  environment rules, and offers its tools to her model.
- `agent` registers the client's elicitation handler: each request
  becomes a `question` event (`id`, `title`, `body`, `options`), and
  `ChatSession` gains `answer(id, option)`, which completes it. Neither
  enters the model's messages.
- `core` carries the two contracts; memory's session wrappers pass them
  through; questions and answers are not written to the transcript.
- The TUI shows a pending question above the input: the worker, the
  request and why it came to the user, with `a` to allow once and `d` to
  deny, and its time left. Questions queue, one shown at a time.

## Errors

| Condition | Behaviour |
| --- | --- |
| acpx or an adapter missing or failing under Bun | The probe stops the build (Testing) |
| `[orchestra]` fault | The server prints it and exits 1 |
| A worker fails to start or exits | `failed`, with its reason; the others go on |
| `start_worker` refused | The tool's error says which rule |
| The judge's route fails throughout | Denial, logged |
| No answer from the user in time | Denial, logged as `timeout` |
| A client without elicitation | Every `ask` is a denial |
| The server dies under Dorothy's chat | One warning; its tools fail, as recall's do |

## Testing

No test reaches a real agent or provider, or reads `secrets.json`;
every root and key is passed in.

- **The probe, Part A's first task:** acpx's embedded runtime under Bun,
  driving a scripted fake ACP agent through a turn with a permission
  request, and both adapters starting far enough to answer
  `initialize`. If it fails under Bun, the build stops and returns to
  the user.
- **Rules:** table-driven, each case of the research's hostile probe
  among them: compound commands, aliases, a push of the worker's own
  branch and of another, `--force-with-lease`, tags, paths outside the
  worktree, secrets and credentials, unparseable commands.
- **The gate:** the order of rule, judge and user; denial on a broken
  answer, a failed route, a judge timeout and an ask timeout; `allow_once`
  chosen, never `allow_always`; the log's entries.
- **The engine:** a scripted fake ACP agent asking for permissions, its
  workers' lifecycle, `max-workers`, refusals and failures.
- **The server:** each tool end to end through an MCP client, the
  elicitation round trip included.
- **Part B:** an elicitation becoming a `question` event and its answer
  reaching the server; the TUI prompt, its keys and its queue.
- **The judge's evaluation:** the research's hostile probe kept as a
  script outside CI, rerun when the `approval` route changes.

## Verification

Each merge waits on a live run by the coordinating agent once Claude
Code's and Codex's limits allow, on a scratch repository and temporary
XDG roots, recorded in a report:

- **Part A**, from Claude Code as the client: one Claude and one Codex
  worker; at least one request allowed by rule, one push of a worker's
  own branch, one push to `main` denied, one judged request, and one
  escalation answered in Claude Code's elicitation dialog.
- **Part B**, from Dorothy's chat on featherless: the same, with the
  escalation answered in the TUI.

## Documentation

- `packages/orchestra/AGENTS.md`: the engine, the gate, the server.
- `packages/cli/AGENTS.md`: the new mode, within its budget.
- `packages/agent/AGENTS.md` and `packages/tui/AGENTS.md` (Part B).
- Root `AGENTS.md`: the package graph, within its 100 lines.
- `README.md`: a section on orchestration, its rules and its switch.
- `docs/reports/2026-11-02-orchestration.md`: the probe, the rulings
  and both verifications.
- `docs/roadmap.md`: an Orchestration phase ahead of Dorothy's Gateway.

## Later

- The unattended runner: workers that outlive a chat, driving a plan
  through the same engine.
- Answering approvals for repeated requests from a worker's own history.
- herdr's panes for workers the server starts, for the user to watch.
