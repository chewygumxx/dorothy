---
ctime: 2026-11-01
mtime: 2026-11-01
spdx: GPL-3.0-only
title: An orchestration layer for less permissive agents
description: >-
  Which client should orchestrate Claude Code and Codex agents that run
  under stricter permission policies than today's, answering their
  approvals itself: the agents' own programmatic surfaces, the shared
  protocol, the orchestrators, and a recommendation.
tags:
  - dorothy
  - agents
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-11-01_agent-orchestration.md
   -
   -->

# An orchestration layer for less permissive agents

Researched on 2026-11-01 for the user, who asked which agent client is
most appropriate for orchestrating Claude Code and Codex agents of less
permissive policy.

## Today

`dorothy-main`, a Claude Code session, coordinates through herdr 0.9.5:
it types into the other agents' terminals (`send-prompt.sh`), reads
their panes, and waits on herdr's lifecycle states
([herdr](../../.agents/skills/agent-stewardship/references/herdr.md)).
Codex runs with `approval_policy = "never"` and
`sandbox_mode = "danger-full-access"`, so it never asks
([Codex full send](../../.agents/memory/codex-full-send.md)); Claude Code's
own permission prompts are not covered at all. herdr recognises an agent
`blocked` on an approval dialog, but answering one means reading the
pane and sending keys, and herdr's own guidance is to ask the user
first.

A less permissive policy turns approvals from a rarity into the main
traffic between the agents, and screen-scraping them does not scale:
the requirement is a structured approval channel the orchestrator can
answer.

## What each agent offers a program

### Claude Code

- `claude -p` with `--input-format stream-json --output-format
  stream-json` is a two-way session; `--resume <id>` continues one. Since
  v2.1.302 a `-p` run starts in Manual mode, and "a call that needs
  approval is denied unless something approves it, such as a
  `PermissionRequest` hook or a `--permission-prompt-tool`"
  ([headless](https://code.claude.com/docs/en/headless)).
- `--permission-prompt-tool <mcp tool>` hands every approval Claude Code
  would show to an MCP tool the orchestrator serves: the approval
  channel, on the unmodified binary.
- A `PermissionRequest` hook does the same from settings; a
  `PreToolUse` hook answering `ask` is a hard deny in headless runs, and
  one open bug (anthropics/claude-code#95726) has the `PermissionRequest`
  hook not firing under stream-json input.
- Modes ([permission modes](https://code.claude.com/docs/en/permission-modes)):
  `default` (Manual), `acceptEdits`, `plan`, `auto` (a classifier
  reviews actions, pausing back to prompts after 3 blocks in a row or
  20 in all), `dontAsk` (deny what would prompt) and
  `bypassPermissions`. No mode auto-approves explicit ask rules,
  `AskUserQuestion` or critical-path `rm`.
- Agent teams and subagents orchestrate Claude Code only; teammates
  inherit the lead's mode, and their prompts reach the lead's human
  ([agent teams](https://code.claude.com/docs/en/agent-teams)).

### Codex

- `codex app-server`: JSON-RPC over stdio, the surface Codex's own
  clients use. Approvals arrive as server requests,
  `item/commandExecution/requestApproval` and
  `item/fileChange/requestApproval`, answered `accept`,
  `acceptForSession`, `decline`, `cancel`, or with an execpolicy
  amendment; `item/permissions/requestApproval` grants sandbox scope per
  turn or session. Sandbox and approval policy are set per thread and
  per turn. It is labelled experimental and "not supported for
  production workloads"
  ([app-server](https://learn.chatgpt.com/docs/app-server)).
- `codex mcp-server` puts approvals behind MCP elicitation; OpenAI's own
  multi-agent examples simply call it with `approval-policy: never`,
  and one report has it hanging on elicitation (openai/codex#11816).
- The TypeScript SDK wraps `codex exec` and has no approval callback.
- Policy ([approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security)):
  sandbox `read-only`, `workspace-write` or `danger-full-access`;
  `approval_policy` `untrusted`, `on-request`, `never` or a granular
  table (`sandbox_approval`, `rules`, `mcp_elicitations`,
  `request_permissions`, `skill_approval`); and
  `approvals_reviewer = "auto_review"`, a reviewer agent that approves
  low and medium risk, denies critical risk, sends high risk on, and
  fails closed.
- In `workspace-write`, `.git`, `.codex`, `.agents` and `.aws` stay
  read-only, so a worker in a worktree, whose commits write to the main
  repository's `.git`, asks for every commit. A less permissive Codex
  needs an orchestrator that answers those, or a narrow rule for them.

## The shared protocol: ACP

The Agent Client Protocol (Zed's, open) gives one shape to every agent:
`session/new`, `session/prompt`, streamed updates, and
`session/request_permission`, whose options carry a `kind`
(`allow_once`, `allow_always`, `reject_once`, `reject_always`) and are
answered by `optionId`
([tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls)).
Neither agent speaks it natively: Claude Code through
`@agentclientprotocol/claude-agent-acp`, a community adapter on the Agent
SDK, and Codex through `@agentclientprotocol/codex-acp`, which drives the
app-server.

## The orchestrators

| Candidate | Drives | Approvals reach | Fit |
| --- | --- | --- | --- |
| herdr (today) | Any TUI agent | A pane, by keystroke | Visible, but scraping |
| acpx 0.22 (OpenClaw, MIT) | 30 ACP agents, Claude and Codex among them | A policy, or a host callback when embedded | Best fit |
| Native protocols, a small supervisor of ours | Claude `-p` stream-json, Codex app-server | The supervisor, live | Most control, most code |
| OpenClaw ACP agents | Claude, Codex via acpx | `approve-all`, `approve-reads` or `deny-all`; no live routing | Too coarse |
| Hermes Agent | Claude via `claude -p` skills; ACP children only for Copilot | Its terminal | Not yet |
| Rivet Sandbox Agent (Apache-2.0) | Claude, Codex and more over HTTP/SSE | `permission.requested` events | Cloud sandboxes, API keys |
| coder/agentapi | TUI agents over HTTP | Raw keystrokes | Scraping; Coder moved off it |
| Conductor, Vibe Kanban, Claude Squad, Nimbalyst and kin | Parallel agents in worktrees | A human, in a GUI or TUI | Human dashboards |
| Happy, Omnara, Crestnotch | Claude, Codex | A human's phone or desktop | Human approval |
| Zed parallel agents | Claude, Codex over ACP | A human, in the editor | Human IDE |
| Claude agent teams; Codex subagents | Their own vendor only | The lead's human; the parent | One vendor each |

### acpx

acpx is a headless ACP client built "so agents, orchestrators and
developers" drive coding agents without PTY scraping
([openclaw/acpx](https://github.com/openclaw/acpx)). It keeps named,
persistent sessions per repository, queues prompts to a busy session,
and emits NDJSON ACP events with `--format json`. Its permissions:

- Modes `--approve-all`, `--approve-reads` (the default) and
  `--deny-all`, and a per-tool policy of `autoApprove`, `autoDeny`,
  `escalate` and `defaultAction`.
- On the command line, an escalated request is denied for that turn,
  its details returned in `_meta.acpx.permissionEscalation` "so an
  orchestrator can resume with a broader policy".
- Embedded (`acpx/runtime`), a host `onPermissionRequest` callback
  decides each request live, per session and per turn, by the agent's
  own `optionId`; returning nothing falls back to the policy.

Its limits: it is pre-1.0; its filesystem checks are "best-effort
guardrails", "not an OS sandbox"; and for Claude, rules and hooks inside
Claude Code resolve some calls before acpx sees a request, so a hard
boundary still needs Claude-side deny rules or hooks. OpenClaw, one of
the harnesses Dorothy targets, builds its own ACP agents on it.

## Terms

Anthropic's
[legal page](https://code.claude.com/docs/en/legal-and-compliance)
permits "an end user signing in to the unmodified Claude Code binary
with their own Claude subscription", and asks developers "building
products or services", "including those using the Agent SDK", to use
API keys; nothing may "collect, store, or intermediate" subscription
credentials. Driving the `claude` binary with `-p` on the user's own
login sits inside the first. The ACP adapter for Claude runs on the
Agent SDK: for the user's own orchestration on their own login it is
the same individual use, but it is the less clear-cut of the two, and
the user's to rule on.

## Recommendation

1. **The orchestrating agent stays Claude Code** (`dorothy-main`): the
   only one that already holds the repository's skills, memory and
   process, and the one Anthropic's terms cover cleanly on a
   subscription.
2. **The control layer is structured, not scraped.** Two ways, to be
   settled by a spike:
   - acpx, embedded or as a CLI, for one permission model across both
     agents, at the cost of a pre-1.0 dependency and two adapters; or
   - the agents' own protocols, Claude Code's stream-json with
     `--permission-prompt-tool` and Codex's app-server, behind a small
     supervisor of Dorothy's, at the cost of two protocols to keep up
     with, one of them experimental.
3. **Workers run less permissively, their approvals answered by
   policy first, then by the orchestrator:** Codex in `workspace-write`
   with `on-request` and `approvals_reviewer = "auto_review"`; Claude in
   Manual or `auto` mode with the permission tool. Routine approvals,
   such as a worktree's commits, are answered by rule; the rest reach
   `dorothy-main`, and the irreversible ones the user.
4. **herdr stays for visibility** while the spike runs: headless
   sessions lose the panes the user watches today.

The spike: one Claude worker and one Codex worker, each made to ask for
one approval, answered by the orchestrator through each route, with
what each route costs to build and what it shows the user.
