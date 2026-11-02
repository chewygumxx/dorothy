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

Two layers, kept apart. The constraints, the box and the broker, hold
whatever anyone answers: a worker holds no credential of the user's but
its agent's own login, opens no connection but to the allowlist, writes
nothing on the host but its clone, and reaches the user's repositories
and remotes only through the broker. The policy, rules then judge then
user, answers the permission requests the agents send, and so steers
the work's course: which commands run, which dependencies join, which
branches are pushed. A worker can act within the box without asking, so
the policy is enforced only where the broker applies it too.

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
- Each worker gets a clone of its own, borrowing objects read-only, as
  a linked worktree inside a box would expose the shared object store.
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
results. A third review found the box's mounts too wide, the broker
open to the main checkout's configuration, the clone command copying
every object, codex-acp's `agent` mode overriding the reviewer, and the
login's confinement, branch ownership and uncertain outcomes
overstated or undefined; this draft answers each.

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
| Worker repositories | A shared clone each of the broker's own repository, its objects read-only | One full copy of each repository, the broker's, at first use |
| Pushes | The broker's, from its own repository, of a worker's own reserved branch, by rule; force-with-lease and dependency changes to the user | A push is a tool call, asynchronous |
| The agents' logins | Admitted into their own box only | A hostile worker can read its own agent's login and send it out through an admitted host |
| Policy and constraint | The box and broker hold regardless; the gate answers only the requests agents send | A worker that never asks meets only the box and the broker |
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
  allowlist (`PATH`, `HOME`, the XDG roots, `SSH_AUTH_SOCK`, locale and
  terminal variables), so no `ACPX_AUTH_*`, provider key,
  `SOPS_AGE_KEY`, OAuth token, cloud credential or `GIT_*` override
  survives. `SSH_AUTH_SOCK` is the broker's alone and enters no box. It
  loads Dorothy's secrets by path into a private object for the judge's
  call, never into its environment.
- **acpx's runtime** is created with `permissionMode: "deny-all"`, no
  per-tool policy, `fs: false` and `terminal: false`, so every action
  goes through the agent's own tools and their permission requests, and
  a missing or failed callback denies; with `onPermissionRequest`, the
  gate; and with each agent's command being the box's launcher.

## The box

Each worker's adapter, and so its agent and every command the agent
runs, is started inside `bwrap` with:

- **an empty root**, into which only these are mounted: read-only, the
  system's `/usr` and its `/bin`, `/lib` and `/lib64` links, and from
  `/etc` only the certificates, `passwd`, `group`, `nsswitch.conf`,
  `localtime` and `hosts`; read-only, the installed adapter and the
  runtime it runs on, each by its resolved path; read-write, the
  worker's clone; read-only, the broker repository's object store, for
  the clone's alternates; read-only, its agent's own login (Logins);
  and the box's own proxy socket. Nothing else of the host: no `/run`,
  `/var`, `/home`, `/mnt`, `/media`, `/srv` or `/opt` beyond a path
  named above, so no host service's socket, D-Bus among them;
- the home directory and `/tmp` fresh tmpfs, `/dev` and `/proc` its
  own;
- `--unshare-all` (user, IPC, PID, network, UTS and cgroup namespaces),
  `--new-session`, `--die-with-parent`, and `--clearenv`; the adapter's
  stdin and stdout its only inherited descriptors besides stderr;
- **persistent host writes:** the clone alone; the scratch tmpfs vanish
  with the box;
- **network:** the new, empty network namespace; a bridge inside it
  listens on `127.0.0.1:<port>` and forwards to the box's proxy socket;
  `HTTPS_PROXY` and `HTTP_PROXY` point at it. The bridge is the
  worker's to use, bypass or kill: every check is the proxy's;
- an environment set from an allowlist: `PATH`, `HOME`, `LANG`, `TERM`,
  the proxy variables, and the agent's own login variables if it has
  them; nothing else.

**The proxy,** on the host, one listener per box, is an egress
restriction on TCP destinations, not an inspection of HTTPS:

- it reads one `CONNECT host:443` request, its line and headers within
  8 KiB and 10 seconds, and refuses any other method or port;
- the host is lowercased, stripped of one trailing dot, and matched
  exactly, with no wildcard, against the agent's provider hosts
  (`api.anthropic.com` and Claude's sign-in hosts for Claude;
  `api.openai.com` and `chatgpt.com` for Codex) and `[orchestra]
  network-allow` (default `registry.npmjs.org`);
- it resolves the host itself, refuses if any address is loopback,
  private, link-local, carrier-grade NAT, multicast, unique-local or
  unspecified, and connects to the address it checked, never resolving
  again;
- at most 32 open connections per box, each closed after 10 minutes
  idle; every decision is logged.

What passes is TLS the proxy cannot read, so an admitted host's own
service, or another tenant on its address, is reachable; the allowlist
narrows where data can go, and does not keep it in.

Inside, the agents keep their own modes, so that they still ask: Codex
in codex-acp's `workspace-write` mode, whose reviewer is the user, not
its `agent` mode, which sends `auto_review` with every turn; Claude in
its default Manual mode. The engine sets the mode with each new or
reloaded session and checks the session's reported mode before each
turn, failing the worker if it differs. Whether an agent's own sandbox
can run nested in the box is the real-agent gate's to settle; the box
holds the constraints either way. A repository's own settings, skills,
hooks or MCP servers then run inside the box and reach nothing it
withholds.

**Logins.** An agent's login must reach the agent, and whatever the box
admits, every command inside can read. So the box admits only the
agent's own login: Claude's stored subscription login, mounted
read-only, or a token in its environment; Codex's `~/.codex/auth.json`,
read-only, or the OpenAI API key, which codex-acp accepts. Any code the
worker runs can read that login and send it out through an admitted
host, in a request, its output or a commit; the box does not prevent
that, and keeping a login from the code its agent runs would need a
provider gateway outside the box, which is later work. So each login
is the narrowest the agent allows, and no box holds a key to the
remote, the user's secrets or any other service. `[orchestra]
codex-login` chooses `"chatgpt"` (default) or `"api-key"`.

## Worker repositories

**The repository's identity.** `start_worker`'s `repo` is a main
checkout; the broker reads its `remote.origin.url` as written, with
`git config --file <checkout>/.git/config` and no includes. The URL
must name a GitHub repository (`git@github.com:<owner>/<name>.git`,
`ssh://git@github.com/<owner>/<name>` or
`https://github.com/<owner>/<name>`, `.git` optional), and
`<owner>/<name>` is the repository's identity from then on: every
fetch, push and pull request of its workers names that URL and that
repository explicitly.

**The broker repository.** One per identity, at
`$XDG_STATE_HOME/dorothy/orchestra/repos/<owner>/<name>.git`: a bare
clone of the main checkout, `git clone --bare --no-local`, made at first
use, sealed (The broker). Its configuration is the broker's alone, and
its garbage collection and maintenance are off, so no object a worker
borrows is ever pruned. After it is made, nothing reads the main
checkout again.

**The base.** At each `start_worker`, the broker reads the remote's
default branch (`git ls-remote --symref <url> HEAD`), fetches it into
the broker repository as `refs/orchestra/<server>/<worker>/base`, and
records its OID: a worker starts from the remote's branch as it is, not
from the main checkout's local `main`, and that ref keeps the base's
objects.

**The worker's clone.** `git clone --shared --no-checkout <broker
repository> <worktree-root>/<server id>/<worker>`, which borrows the
broker repository's objects by alternates and copies none, then `git
switch --create <branch> <base OID>` in it, both sealed and before the
box first starts. From then on the worker owns its clone, `.git` and
all: its config, hooks, refs and objects, and no host git runs in it.
The clone's canonical path is checked to lie under the root.

**Branch reservations.** `start_worker` reserves the branch by creating
exclusively
`$XDG_STATE_HOME/dorothy/orchestra/branches/<owner>/<name>/<branch, hex>`,
holding the server id, the worker and the base OID. It refuses if that
file exists, from this launch or any before it, or if the remote has the
branch already. A reservation lasts as long as its clone; releasing
both is later work.

## The broker

The only way a worker's work reaches the user's repositories and
remotes. Every host-side git operation runs sealed:

- `git` from `PATH`, resolved once at start, run in the broker
  repository and nowhere else but the two steps above that make a clone;
- with `GIT_CONFIG_NOSYSTEM=1` and `GIT_CONFIG_GLOBAL` set to the
  broker's own file, holding `user.name` and `user.email` as the user's
  configuration gives them and, for an `https` URL,
  `credential.https://github.com.helper` set to `!gh auth
  git-credential`; with `-c core.hooksPath=/dev/null`, `-c
  maintenance.auto=false`, `-c gc.auto=0` and `-c
  submodule.recurse=false`; the remote always given by URL, never by
  name; the user's `HOME`, so that `ssh` and `gh` find their own
  configuration, and `SSH_AUTH_SOCK`; and no other `GIT_*` variable;
- each process in its own process group, with a deadline: 120 seconds
  for a clone, fetch or push, 60 for `gh`, then killed.

**Bringing work back:** `git fetch --no-tags --no-recurse-submodules
--no-write-fetch-head <clone>
refs/heads/<branch>:refs/orchestra/<server>/<worker>/<branch>`, the
fetched commit's OID recorded. A fetch from a path runs
`git-upload-pack` in the source; the broker passes `--upload-pack` its
own launcher, which runs it in a box of its own, the clone and the
broker repository's objects read-only and no network, so that even what
upload-pack reads of the clone is read boxed.

**`push_worker(worker, operationId, forceWithLease?)`** is asynchronous
(Operations). It fetches the worker's branch, and records the identity,
the URL, the full ref `refs/heads/<branch>`, the fetched OID, and the
remote OID it expects: none for the branch's first push, so that a
branch made on the remote meanwhile fails it; the last OID the broker
pushed for later ones; for `forceWithLease`, the remote's OID when it
was called. It pushes exactly that OID to that ref with
`--force-with-lease=refs/heads/<branch>:<expected>`, `--no-follow-tags`,
`--porcelain`, `--no-recurse-submodules` and no `--mirror`. The worker's
branch moving afterwards changes nothing: the recorded OID is pushed.
The remote moving makes the lease fail, and the operation with it; a
new call starts over.

- A plain push, a fast-forward of the last, is allowed by rule.
- A `forceWithLease` asks the user, naming every recorded value.
- A change between the base OID and the pushed OID to any dependency
  manifest or lockfile (`package.json`, `bun.lock`, `bun.lockb`,
  `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `Cargo.toml`,
  `Cargo.lock`, `pyproject.toml`, `uv.lock`, `requirements*.txt`,
  `go.mod`, `go.sum`), at any depth, asks the user, showing those
  files' diff. This is where the dependency policy is enforced: inside
  its box a worker can change them without asking.

**`open_pull_request(worker, title, body, operationId)`**, also
asynchronous: `gh pr create --repo <owner>/<name> --head <branch>`, run
in the broker repository, after a push of that branch.

**Never:** another branch, a tag, a deletion, a submodule, or another
remote. Each operation is logged with its result.

### Operations

Every tool that changes something is an operation, keyed by its
`operationId`, with a digest of its tool and arguments, recorded before
it runs:

- the same `operationId` with the same digest returns the existing
  record, never acting twice; with another digest it is refused;
- `read_operation(operationId)` returns any operation's record,
  `start_worker`'s included, with the worker it made;
- an operation is `pending`, `running`, `succeeded`, `failed` or
  `unknown`. A push or pull request whose process dies or passes its
  deadline is reconciled against the remote, by `git ls-remote` for the
  ref or `gh pr list --head` for the pull request: the remote showing
  the intended effect is `succeeded`, showing none is `failed`, and
  anything else is `unknown`, which is never retried: the branch's next
  push asks the user, showing the unknown record and the remote's
  state;
- `stop_worker` cancels its worker's pending operations; a running one
  goes on to its deadline, as an effect already sent cannot be
  recalled. On the client's `EOF` or a signal, the server stops every
  worker, gives running operations 10 seconds, kills their process
  groups, reconciles what it can, and logs the rest `unknown`.

## Tools

Each returns within 50 seconds, as a chat ends an attempt after 60
seconds with no stream activity, a tool's run included. Each carries
MCP's `readOnlyHint`, and each that changes something takes a
caller-supplied `operationId`, so that a repeated call changes nothing
twice.

| Tool | What it does |
| --- | --- |
| `start_worker(agent, repo, branch, task, operationId)` | Reserves the branch and names the worker, such as `codex-1`, returning that name at once; then, as an operation, makes its clone, starts `agent` (`claude` or `codex`) boxed in it, and sends `task` as its first prompt |
| `prompt_worker(worker, text, operationId)` | Queues a turn; a worker's turns run in order |
| `read_worker(worker)` (read-only) | Its status (`starting`, `working`, `idle`, `waiting-on-user`, `failed`, `stopped`), what happened since the last read, condensed and capped (replies, tools called, permission decisions with their source), the ids of its pending questions, and its operations' outcomes |
| `read_operation(operationId)` (read-only) | An operation's record (Operations) |
| `wait_worker(worker?, seconds)` (read-only) | Waits up to 45 seconds for the worker, or any, to go idle, fail, need the user or finish an operation |
| `list_workers()` (read-only) | Every worker, its agent, branch, clone and status |
| `push_worker(worker, operationId, forceWithLease?)` | Starts a push of the worker's branch (The broker) |
| `open_pull_request(worker, title, body, operationId)` | Starts a pull request for the worker's pushed branch |
| `stop_worker(worker, operationId)` | Cancels and closes its session; its clone and branch stay |

There is no tool that answers a permission request or merges.

`start_worker` refuses an `agent` outside `[orchestra] agents`, a
`repo` that is not a git checkout whose `origin` names a GitHub
repository, a `branch` reserved already or on the remote, and a start
past `max-workers`.

## The gate

Every `session/request_permission` from a worker passes three steps;
the first decision stands. The box stands behind all three: an `allow`
grants nothing the box withholds, and a request whose own scope reaches
past the box, such as Codex asking to run a command outside its sandbox
or for more filesystem or network access, is answered within the box
regardless, the box being unchanged by any answer.

### 1. Rules

In code, over the request's tool, command and paths. A shell command is
parsed by a shell grammar, not split by pattern, into its simple
commands, each judged; the strictest decides. Anything the parser
cannot reduce to plain words, such as `eval`, command or process
substitution, a subshell, a function, an alias or a variable in the
command's position, asks the user. Deny is stricter than ask, ask than
allow, whether a rule is built in or configured.

| Decision | Requests |
| --- | --- |
| Deny | `git push` and `gh` by a worker (the broker pushes); `git` with a force flag; adding a remote; `sops`; a download piped into a shell |
| Allow | Reads and searches in its clone; the repository's tests, linters, formatters and builds; `git add`, `git commit`, `git switch` and `git branch` in its clone; `bun install --frozen-lockfile` |
| Ask the user | Adding or upgrading a dependency (`bun add`, `npm install <name>` and their likes); a command the rules cannot reduce to plain words |

`[orchestra]`'s `allow`, `ask` and `deny` add patterns; nothing removes
a built-in denial, and a request a rule denies or cannot parse never
reaches the judge. The rules are policy over the requests an agent
sends: a worker can reset its own branch, add a remote to its clone or
run what it downloaded without asking, through a script or an agent's
own pre-approval, and the box allows each, as none reaches past it. The
constraints that matter whatever a worker does are the box's and the
broker's: the push rules and the dependency check are the broker's own,
applied to what leaves.

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
  fallback to another model repeats it. Its `operationId` is derived
  from the model's tool call id, so that a retransmission of one call
  is the same operation and every new call a new one.
- **Questions.** `core` gains a `QuestionSource`, handed to the TUI
  beside its notices: a `question` has `id`, `title`, `body`, `options`
  and `deadline`; `answer(id, option)` completes it; a settlement
  removes it. A question's exchange and the user's answer never pass
  through the model's messages or the transcript; the model sees only,
  through `read_worker`, that a question is pending and, once settled,
  the decision and its source.
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
| A broker operation fails | `failed`, and `read_worker` says why; nothing retried |
| A broker operation's outcome is lost | Reconciled against the remote; otherwise `unknown`, and the branch's next push asks the user |
| A Codex session reports a mode other than `workspace-write` | The worker fails before its turn |
| The proxy refuses a host | The agent's request fails; the refusal is logged |
| The server dies under Dorothy's chat | One warning; its tools fail, as recall's do |

## Testing

No test reaches a real agent or provider, or reads `secrets.json`;
every root and key is passed in, and remotes are local bare
repositories, which the broker's GitHub check, a parameter, admits in
tests alone.

- **The real-agent gate, Part A's first task,** with real agents signed
  in by the user once the weekly limits allow: each agent boxed, its
  model traffic and its subprocesses' through the proxy's variables;
  signed in by each login the spec admits, with the login's refresh and
  persistence under a read-only mount; whether its own sandbox runs
  nested, and an escalation it asks for staying inside the box; a
  permission request delivered, answered once by exact option, then
  cancelled, and the session reloaded; a command inside reading what
  the box admits and failing at what it withholds; and the worker's
  whole process tree gone after `stop_worker` and after the server is
  killed. Everything else in Part A is tested offline and does not wait
  for it. If an agent cannot run boxed, the build stops and
  returns to the user.
- **The box,** with a fake ACP agent inside: writes outside the clone;
  reads of synthetic files planted in the home directory, under a
  nondefault XDG root, in `/var`, `/opt` and `/mnt`; a synthetic Unix
  socket planted under `/run` and in the home directory, unreachable; a
  symlink out of the clone; an inherited descriptor, absent; and the
  environment's allowlist (an `ACPX_AUTH_*`, a `*_API_KEY`,
  `SOPS_AGE_KEY` and `GIT_DIR` set outside, absent inside).
- **The proxy:** a direct connection, refused; an unlisted host, a
  listed host on another port, a host resolving to a private or
  loopback address, an oversized or slow `CONNECT`, and a 33rd
  connection, each refused and logged; the socket used directly, not
  through the bridge, held to the same checks; the bridge killed, the
  agent's requests failing and nothing else reached.
- **The server's environment:** the same variables, set by the client
  that starts it, absent after it re-executes.
- **The broker,** on a temporary repository and bare remote: a hostile
  clone (hooks, `config` with `insteadOf`, `pushurl`, `push.followTags`,
  `push.recurseSubmodules`, `submodule.recurse`, a `+` refspec,
  `mirror`, includes) and a hostile main checkout (the same in its
  local and worktree configuration), whose worker's branch is fetched
  and pushed, exactly that one commit reaching exactly that one URL and
  ref, no hook or other transport running and no submodule fetched; a
  worker's branch moved after `push_worker`, the recorded OID pushed; a
  remote moved, the lease failing; a branch made on the remote before a
  first push, the push failing; a dependency file changed, asking the
  user; a base taken from the remote's branch where the main checkout's
  local `main` differs; a clone borrowing, not copying, objects.
- **Reservations:** two simultaneous starts of one branch, one refused;
  a branch reserved by an earlier launch, refused; worker names reused
  across launches, their broker refs apart.
- **Operations:** a repeat returning the record without acting; a
  reused id with other arguments refused; a push killed after sending,
  reconciled; one reconciled to neither, `unknown`, its branch's next
  push asking; `stop_worker`, `EOF` and a signal with an operation
  running, its process group gone afterwards.
- **The engine's modes:** a fake Codex adapter reporting `agent` mode,
  failing the worker.
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
- **The rules' parser:** the constructs that must ask, each one.
- **The judge's evaluation:** the research's hostile probe kept as a
  script outside CI, rerun when the `approval` route changes.

## Verification

Each merge waits on a live run by the coordinating agent once Claude
Code's and Codex's limits allow, on a scratch repository with a local
bare remote, synthetic credentials and temporary XDG roots, recorded in
a report. Each run asserts effects, not decisions.

- **Part A**, from an MCP client that shows elicitations: one Claude and
  one Codex worker; a request allowed by rule, a judged one, an
  escalation answered, a `push_worker` of a worker's branch, a
  dependency added and its push asked; and, made
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
- Releasing a worker's clone and branch reservation.
- A provider gateway outside the box, holding the agents' logins, if
  keeping them from worker code becomes a requirement.
