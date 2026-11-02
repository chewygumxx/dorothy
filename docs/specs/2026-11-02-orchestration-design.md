---
ctime: 2026-11-02
mtime: 2026-11-02
spdx: GPL-3.0-only
title: Orchestration
description: >-
  Design spec for Dorothy's orchestration toolset: an MCP server that
  runs Claude Code and Codex workers through acpx, each confined in a
  bubblewrap box with its own reference clone, pushing for them through
  a sealed broker, and answering their approvals by rules, then a
  judging model, then the user by elicitation; and Dorothy's chat as its
  first client.
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
  Claude Code and Codex workers through acpx's embedded runtime. Each
  worker, adapter and agent together, runs in a bubblewrap box: a clone
  of its repository of its own, no file of the user's beyond what its
  agent needs to run, and no network but an allowlist through the
  server's proxy. Workers never push: a sealed broker brings a worker's
  branch into the main checkout and pushes it. Every permission request
  a worker makes is answered by rules, then a judging model on a new
  `approval` role, then the user by MCP elicitation. It is served over
  MCP stdio by `dorothy --orchestra-server`.
- **Part B, Dorothy's chat.** Her chat's launch connects to the server,
  her sessions get its tools, the elicitations become prompts in the
  TUI, and `[orchestra]` in `config.toml` turns it on.

The guarantee rests on the box and the broker. What a worker may never
do, it cannot do: it holds no credential of the user's but its agent's
own login, reaches no host but the allowlist, writes nothing but its
clone. The rules, the judge and the user decide everything inside that,
the work's own course: which commands run, which dependencies join,
which branches are pushed.

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
- Each worker gets a reference clone of its repository, borrowing the
  main checkout's objects read-only, as a linked worktree inside a box
  would expose the shared object store.
- It is built now, while Claude Code's and Codex's weekly limits reset.

Assumed, and put to the user in the design's sections:

- Workers live as long as the server process, which is as long as its
  client's launch; the unattended runner is later work.
- The leading approval model is
  `featherless:deepseek-ai/DeepSeek-V4.1-Flash-1017`, which held against
  every injection in the research's hostile probe; the route is the
  user's to set.

Success: a client asks the server for a worker; the worker's requests
are answered by rule, judge and user as the gate says, every decision
logged; no worker achieves a forbidden effect by any route, which
adversarial checks of actual effects confirm; Dorothy's chat drives it,
with escalations answered in the TUI; no test reaches a real agent or
provider.

## Review and probe

Two Codex reviews (gpt-6.1-sol, 2026-11-02) found that the agents' own
sandboxes, reached through acpx's adapters, cannot hold the hard limits:
an approval can lift Codex's sandbox, Claude's Bash sandbox covers shell
commands only, acpx cannot pass Claude's sandbox, hooks or settings
sources, a worktree's shared object store cannot be writable and safe,
host git runs repository hooks, and `@ai-sdk/mcp` cannot deliver an
elicitation's cancellation. A feasibility probe the same day
([log](../notes/2026-11-02_featherless-orchestrator.md)) then showed
acpx's embedded runtime under Bun failing closed, both adapters starting
in a bubblewrap box with no home, no network and one writable path, a
proxy admitting an allowlist into the box, and a transport wrapper
delivering elicitation and its cancellation. This spec stands on those
results.

## Decisions

Ruled with the user or by the coordinating agent, each with its cost if
wrong:

| Question | Ruling | Cost if wrong |
| --- | --- | --- |
| Who drives | Chat first; an engine an unattended runner can reuse | Long jobs still go through herdr for now |
| Where it lives | An MCP stdio server, `@dorothy/orchestra`, ahead of Dorothy's chat | A process boundary and elicitation to build first |
| The control layer | acpx's embedded runtime, ACP for both workers | A pre-1.0 dependency and two adapters |
| Claude's route | acpx's adapter on the Agent SDK, on the user's subscription | The terms' grey area, which the user accepts |
| The boundary | A bubblewrap box around each worker and its agent, and a sealed broker | Linux and bubblewrap required; an agent that cannot run boxed blocks the build |
| Worker repositories | A reference clone each, the main checkout's objects read-only | A fetch to bring work back, which the broker does |
| Pushes | The broker's, from the main checkout, of a worker's own branch, by rule; force-with-lease to the user | A push is a tool call, asynchronous |
| The agents' logins | Admitted into their own box only, useful only through the allowlist | A hostile worker can read its own agent's login |
| Reaching the user | Elicitation through Dorothy's own transport wrapper, cancelled when settled | Other clients see only what their MCP version allows |
| Who decides approvals | Rules, then a judge on the `approval` role, then the user; never the chat model | A judge call per unsettled request |
| Failure | Every failure to decide is a denial | A worker blocked where it might have gone on |
| Approval answers | The agent's exact `allow_once` or `reject_once` option id | A judge call for every repeat |
| Workers' lifetime | The server's process, owned by the chat's launch | A closed chat stops its workers |
| Adapters | Declared dependencies at fixed versions, never fetched at runtime | Updates are ours to take |
| Delivery | Two parts, two plans, two merges | The chat waits a merge |

## Architecture

```text
client (Dorothy's chat launch, or another MCP client)
  │ MCP stdio: tools; elicitation back to the client
  ▼
dorothy --orchestra-server      (re-execs itself with a clean environment)
  └── @dorothy/orchestra
        ├── engine: workers on acpx's embedded runtime
        ├── box: bubblewrap around each worker
        ├── proxy: the allowlist, on a Unix socket per box
        ├── gate: rules → judge → elicitation
        ├── broker: fetch, push and pull requests, sealed
        └── log: $XDG_STATE_HOME/dorothy/orchestra/<server>.jsonl
              │ ACP stdio, into the box
              ▼
   ┌ box ──────────────────────┐  ┌ box ──────────────────────┐
   │ claude-agent-acp → Claude │  │ codex-acp → codex         │
   │ its clone, rw             │  │ its clone, rw             │
   └───────────────────────────┘  └───────────────────────────┘
```

- `@dorothy/orchestra` depends on `core` alone among Dorothy's packages,
  and declares `acpx`, `@agentclientprotocol/claude-agent-acp` and
  `@agentclientprotocol/codex-acp` at fixed versions. It imports no
  model SDK and no `@dorothy/agent`: the judge reaches it as core's
  `StructuredCall`, which `cli` makes from the `approval` route.
- Entry points: `"./server"` (`runOrchestraServer`). `cli` gains the
  `--orchestra-server` mode and the dependency on `orchestra`;
  `workspace.test.ts` pins both.
- **The server's own environment:** whoever starts it, the server
  re-executes itself at once with an environment built from an
  allowlist (`PATH`, `HOME`, the XDG roots, locale and terminal
  variables), so no `ACPX_AUTH_*`, provider key, `SOPS_AGE_KEY`, OAuth
  token, cloud credential or `GIT_*` override survives. It loads
  Dorothy's secrets by path into a private object for the judge's call,
  never into its environment.
- **acpx's runtime** is created with `permissionMode: "deny-all"`, no
  per-tool policy, `fs: false` and `terminal: false`, so every action
  goes through the agent's own tools and their permission requests, and
  a missing or failed callback denies; with `onPermissionRequest`, the
  gate; and with each agent's command being the box's launcher.

## The box

Each worker's adapter, and so its agent and every command the agent
runs, is started inside `bwrap` with:

- `/` mounted read-only, the home directory a fresh tmpfs, `/tmp` a
  fresh tmpfs, `/dev` and `/proc` its own, and a new PID namespace
  ending with the server (`--die-with-parent`);
- **writable:** the worker's clone alone;
- **readable beside it:** the main checkout's object store, read-only,
  for the clone's alternates; the runtime the adapter needs; and its
  agent's own login (Logins);
- **network:** a new, empty network namespace; a bridge inside it
  listens on `127.0.0.1:<port>` and forwards to the server's proxy on a
  Unix socket mounted in; `HTTPS_PROXY` and `HTTP_PROXY` point at it;
- **the proxy** admits `CONNECT` to port 443 of the agent's provider
  (`api.anthropic.com` and Claude's sign-in hosts for Claude;
  `api.openai.com` and `chatgpt.com` for Codex) and of the hosts in
  `[orchestra] network-allow` (default `registry.npmjs.org`), and refuses
  every other host and port, logging each;
- an environment from an allowlist: `PATH`, `HOME`, `LANG`, `TERM`,
  the proxy variables, and the agent's own login variables if it has
  them; nothing else.

Inside, the agents keep their own modes, so that they still ask: Codex
in codex-acp's `agent` mode with `approvals_reviewer = "user"`, Claude
in its default Manual mode. Whether an agent's own sandbox can run
nested in the box is the probe's to settle; the box holds the limits
either way. A repository's own settings, skills, hooks or MCP servers
then run inside the box and reach nothing it withholds.

**Logins.** An agent's login must reach the agent, and whatever the box
admits, every command inside can read. So the box admits only the
agent's own login: Claude's stored subscription login, mounted
read-only, or a token in its environment; Codex's `~/.codex/auth.json`,
read-only, or the OpenAI API key, which codex-acp accepts. A worker that
reads it can use it only through the allowlist, against the agent's own
provider; it holds no key to the remote, the user's secrets or any
other service. `[orchestra] codex-login` chooses `"chatgpt"` (default)
or `"api-key"`.

## Worker repositories

`start_worker` makes the worker's repository with
`git clone --reference <main checkout> --no-hardlinks --no-checkout`
from the main checkout, at `<worktree-root>/<server id>/<worker>`, then
checks out a new `branch` from `origin/main` there. It runs in the
sealed context (The broker), so no hook of the main checkout or the
clone runs while it is made. The clone's canonical path is checked to
lie under the root.

The worker owns its clone, `.git` and all: its config, hooks, refs and
objects. None of it is ever run on the host, as the broker never runs
git in a worker's clone.

## The broker

The only way a worker's work leaves its box. Every host-side git
operation, the clone's creation included, runs sealed:

- `git` from `PATH` resolved once at start, run with
  `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL` set to a configuration of
  the broker's own holding only the credential helper and `user.*` the
  user's configuration names, `HOME` its own directory, `-c
  core.hooksPath=/dev/null`, `-c maintenance.auto=false`, `-c
  gc.auto=0`, and no other `GIT_*` variable;
- in the main checkout, never in a worker's clone.

**Bringing work back:** `git fetch --no-tags <clone> refs/heads/<branch>`
into the main checkout as `refs/orchestra/<worker>/<branch>`, the fetched
commit's OID recorded.

**`push_worker(worker, forceWithLease?)`** is asynchronous: it returns
an operation id at once, and `read_worker` reports the operation's
outcome. The operation, recorded before it runs, binds the repository,
`origin`'s URL as the main checkout's configuration gives it, the full
ref `refs/heads/<branch>`, the commit OID fetched, and, for
`forceWithLease`, the remote's OID it expects. It pushes exactly
`<oid>:refs/heads/<branch>` with `--no-follow-tags`, `--porcelain`,
`--no-recurse-submodules` and no `--mirror`. A plain push is allowed by
rule; `forceWithLease` asks the user, and the approval names the
operation's every bound value: if any differs when it runs, it asks
again. The same operation id never pushes twice.

**`open_pull_request(worker, title, body)`**, also asynchronous: `gh pr
create` in the main checkout against the repository the main checkout's
`origin` names, with `--head <branch>`, after a push of that branch.

**Never:** another branch, a tag, a deletion, a submodule, or another
remote. Each operation is logged with its result.

## Tools

Each returns within 50 seconds, as a chat ends an attempt after 60
seconds with no stream activity, a tool's run included. Each carries
MCP's `readOnlyHint`, and each that changes something takes a
caller-supplied `operationId`, so that a repeated call changes nothing
twice.

| Tool | What it does |
| --- | --- |
| `start_worker(agent, repo, branch, task, operationId)` | Makes the worker's clone and branch, starts `agent` (`claude` or `codex`) boxed in it, and sends `task` as its first prompt; returns its name, such as `codex-1`, and its clone |
| `prompt_worker(worker, text, operationId)` | Queues a turn; a worker's turns run in order |
| `read_worker(worker)` (read-only) | Its status (`working`, `idle`, `waiting-on-user`, `failed`, `stopped`), what happened since the last read, condensed and capped (replies, tools called, permission decisions with their source), its pending questions, and its broker operations' outcomes |
| `wait_worker(worker?, seconds)` (read-only) | Waits up to 45 seconds for the worker, or any, to go idle, fail, need the user or finish an operation |
| `list_workers()` (read-only) | Every worker, its agent, branch, clone and status |
| `push_worker(worker, operationId, forceWithLease?)` | Starts a push of the worker's branch (The broker) |
| `open_pull_request(worker, title, body, operationId)` | Starts a pull request for the worker's pushed branch |
| `stop_worker(worker, operationId)` | Cancels and closes its session; its clone and branch stay |

There is no tool that answers a permission request or merges.

`start_worker` refuses an `agent` outside `[orchestra] agents`, a
`repo` that is not a git checkout with an `origin`, a `branch` that
exists already, and a start past `max-workers`.

## The gate

Every `session/request_permission` from a worker passes three steps;
the first decision stands. The box stands behind all three: an `allow`
grants nothing the box withholds, and a request whose own scope reaches
past the box, such as Codex asking to run a command outside its sandbox
or for more filesystem or network access, is answered within the box
regardless, the box being unchanged by any answer.

### 1. Rules

In code, over the request's tool, command and paths. A shell command is
split at `&&`, `||`, `;` and `|`, and each part is judged; the strictest
part decides.

| Decision | Requests |
| --- | --- |
| Deny | `git push` and `gh` by a worker (the broker pushes); `git` with a force flag; adding a remote; `sops`; a download piped into a shell |
| Allow | Reads and searches in its clone; the repository's tests, linters, formatters and builds; `git add`, `git commit`, `git switch` and `git branch` in its clone; `bun install --frozen-lockfile` |
| Ask the user | Adding or upgrading a dependency; a command the rules cannot parse, such as one using `eval`, command substitution or a subshell |

`[orchestra]`'s `allow`, `ask` and `deny` add patterns; nothing removes
a built-in denial, and a request a rule denies or cannot parse never
reaches the judge. The rules settle the work's course and say early
what the box would stop anyway; they are not what keeps a worker from
the user's credentials or the network.

### 2. The judge

What no rule settles goes to a structured call on the `approval` role:
the policy, the request, the worker's task, and the tail of the
worker's recent output, fenced and marked untrusted. It answers
`{ decision: "allow" | "deny" | "ask", reason }`. An answer that breaks
the schema, a failed route or `judge-timeout-seconds` without an answer
is a denial. Its cost is logged.

### 3. The user

An `ask` goes to the client as an elicitation (Questions) naming the
worker, the exact request and why it reached the user, with two
answers: allow once, or deny. No answer within `ask-timeout-seconds` is
a denial. While it waits, the worker is `waiting-on-user`.

### Invariants

- The gate answers with the exact `optionId` the agent offered for
  `allow_once` or `reject_once`, never a kind and never `allow_always`;
  with no such option it cancels.
- Every request and decision, with its source (`rule`, `judge`, `user`
  or `timeout`) and reason, is appended to the server's log and shown
  by `read_worker`.

## Questions

- The server sends each elicitation as a server-initiated
  `elicitation/create` request of MCP protocol version `2025-06-18`, the
  version it declares, carrying in `_meta` its question id, the JSON-RPC
  id, and its deadline. A client that declares no `elicitation`
  capability gets every `ask` denied.
- When a question settles otherwise, by its deadline, its worker's
  stop or the server's close, the server sends `notifications/cancelled`
  for it, and ignores any answer that arrives later.
- Dorothy's client (Part B) is `@ai-sdk/mcp`'s, behind a transport
  wrapper of `agent`'s own: the wrapper takes `elicitation/create` and
  `notifications/cancelled` before the client sees them, declares the
  `elicitation` capability, and sends only answers to questions still
  pending, as the probe showed.

## Configuration

`[orchestra]` in `config.toml`, off by default:

```toml
[orchestra]
enabled = true
worktree-root = "~/dev/_worktree"   # default $XDG_DATA_HOME/dorothy/workers
agents = ["claude", "codex"]
max-workers = 4
codex-login = "chatgpt"             # or "api-key"
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
  provider named `anthropic`. Unlike the other roles, leaving it out
  where no such provider exists is no routing fault, so that a
  `config.toml` written before it keeps routing chat: the orchestra
  server, which alone needs it, refuses to start instead.
- A fault in `[orchestra]` is an error, as a pattern dropped could
  loosen the gate: the server prints it and exits 1, and Dorothy's chat
  goes on without its tools, warning once.
- The server refuses to start where `bwrap` is missing or cannot create
  a user namespace.

## Dorothy's chat (Part B)

- **One owner.** With `[orchestra] enabled`, the chat's launch (`cli`'s
  `runTui`) owns the server: it starts the MCP connection once, holds the
  question queue, and closes both when the chat ends, on every path out
  of `runTui`, early returns, `EOF` and signals included, settling
  pending questions before the connection closes. Each session it
  makes, a compaction's included, borrows the server's tools and never
  closes them; a compaction replacing a session stops no worker.
- **Started turns and repeats.** The model's call to any tool without
  `readOnlyHint` marks the turn started before it is dispatched, so no
  fallback to another model repeats it; each such call carries a fresh
  `operationId`.
- **Questions.** `core` gains a `QuestionSource`, handed to the TUI
  beside its notices: a `question` has `id`, `title`, `body`, `options`
  and `deadline`; `answer(id, option)` completes it; a settlement
  removes it. Neither reaches the model's messages or the transcript.
- **The prompt.** A pending question shows in a line above the input,
  with its time left; the draft is untouched. `ctrl+o` focuses it; then
  `a` or `d` chooses, and `enter` confirms that same question by its id,
  so that a settlement in between cannot pass the answer to the next.
  Questions queue, one shown at a time.

## Errors

| Condition | Behaviour |
| --- | --- |
| An agent cannot run boxed, or `bwrap` cannot | The probe stops the build; in use, the server refuses to start or `start_worker` fails |
| `[orchestra]` fault | The server prints it and exits 1 |
| A worker fails to start or exits | `failed`, with its reason; the others go on |
| `start_worker` refused | The tool's error says which rule |
| The gate's callback throws or returns nothing | acpx's `deny-all` denies |
| The judge's route fails throughout | Denial, logged |
| No answer from the user in time | Denial, logged as `timeout`; the question cancelled |
| A client without elicitation | Every `ask` is a denial |
| A broker operation fails | `read_worker` says why; nothing retried |
| The proxy refuses a host | The agent's request fails; the refusal is logged |
| The server dies under Dorothy's chat | One warning; its tools fail, as recall's do |

## Testing

No test reaches a real agent or provider, or reads `secrets.json`;
every root and key is passed in, and remotes are local bare
repositories.

- **The probe, Part A's first task,** with real agents signed in by the
  user once the weekly limits allow: each agent boxed, its model traffic
  through the proxy, signed in by each login the spec admits, asking
  for a permission and answered; whether its own sandbox runs nested;
  and a command inside reading what the box admits and failing at what
  it withholds. If an agent cannot run boxed, the build stops and
  returns to the user.
- **The box,** with a fake ACP agent inside: writes outside the clone,
  reads of the home directory, a direct connection, a refused host
  through the proxy, a symlink out of the clone, and the environment's
  allowlist (an `ACPX_AUTH_*`, a `*_API_KEY`, `SOPS_AGE_KEY` and
  `GIT_DIR` set outside, absent inside).
- **The server's environment:** the same variables, set by the client
  that starts it, absent after it re-executes.
- **The broker,** on a temporary repository and bare remote: a hostile
  clone (hooks, `config` with `insteadOf`, `pushurl`, `push.followTags`,
  `push.recurseSubmodules`, a `+` refspec, `mirror`, includes) whose
  branch is fetched and pushed, exactly that one commit reaching exactly
  that one ref and no hook running; a branch moved after a
  force-with-lease approval asking again; an operation id never pushing
  twice.
- **Rules:** table-driven, the research's hostile cases among them.
- **The gate:** rule, judge and user in order; denial on a broken
  answer, a failed route, a judge timeout, an ask timeout and a callback
  that throws; a denied or unparsed request never reaching the judge;
  the exact `optionId` chosen.
- **The engine:** workers' lifecycle, `max-workers`, refusals, failures.
- **The server:** each tool end to end through an MCP client; an
  elicitation, its cancellation and a late answer ignored.
- **Part B:** the transport wrapper; the server surviving a compaction
  with a worker waiting on the user; a provider failing after
  `start_worker` with no second worker started; shutdown on each path;
  the question's focus, confirmation by id, deadline and settlement.
- **The judge's evaluation:** the research's hostile probe kept as a
  script outside CI, rerun when the `approval` route changes.

## Verification

Each merge waits on a live run by the coordinating agent once Claude
Code's and Codex's limits allow, on a scratch repository with a local
bare remote, synthetic credentials and temporary XDG roots, recorded in
a report. Each run asserts effects, not decisions.

- **Part A**, from an MCP client that shows elicitations: one Claude and
  one Codex worker; a request allowed by rule, a judged one, an
  escalation answered, a `push_worker` of a worker's branch; and, made
  to try, a repository whose `.claude/settings.json` pre-approves
  `Bash(git push:*)`, an MCP server a worker adds, a test script that
  pushes, a hook and a config change in the clone, a symlink out of it,
  a synthetic key in the client's environment, a callback that fails and
  a late approval. Checked absent: any change to the bare remote but the
  pushed branch, any file changed outside the clone, the synthetic key
  inside, any connection the proxy did not log as allowed.
- **Part B**, from Dorothy's chat on featherless: the same, with the
  escalation answered in the TUI and a compaction during a worker's
  wait.

## Documentation

- `packages/orchestra/AGENTS.md`: the engine, the box, the proxy, the
  gate, the broker, the server.
- `packages/core/AGENTS.md`: `QuestionSource` and the `approval` role.
- `packages/memory/AGENTS.md`: sessions borrowing the launch's tools,
  within its budget.
- `packages/cli/AGENTS.md`: the new mode and the launch's ownership,
  within its budget.
- `packages/agent/AGENTS.md` (the transport wrapper) and
  `packages/tui/AGENTS.md` (the prompt), in Part B.
- Root `AGENTS.md`: the package graph, within its 100 lines.
- `README.md`: a section on orchestration, its box, its limits and its
  switch.
- `docs/reports/2026-11-02-orchestration.md`: the probe, the rulings
  and both verifications.
- `docs/roadmap.md`: an Orchestration phase ahead of Dorothy's Gateway.

## Later

- The unattended runner: workers that outlive a chat, driving a plan
  through the same engine.
- A request-bound elicitation path, for clients of newer MCP versions.
- herdr's panes for workers the server starts, for the user to watch.
- Platforms without bubblewrap.
