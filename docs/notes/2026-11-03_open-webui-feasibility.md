---
ctime: 2026-11-03
mtime: 2026-11-03
spdx: GPL-3.0-only
title: Dorothy through Open WebUI and Featherless
description: >-
  Feasibility of Open WebUI as Dorothy's interface or agent host, with
  Featherless inference, shared memory and the existing Hermes delivery.
tags:
  - dorothy
  - agents
  - open-webui
  - featherless
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-11-03_open-webui-feasibility.md
   -
   -->

# Dorothy through Open WebUI and Featherless

Researched on 2026-11-03 in response to the user's interest in a fully
agentic Dorothy through Open WebUI and the Featherless API. They later
clarified that stewardship of Claude Code and Codex is the priority;
the [Pi study][pi-note] follows that question.

The integration is feasible in principle. Featherless supplies model
inference; the host supplies tool execution and task management;
Dorothy supplies her shared identity and memory. The following is
documentation and source research, not a deployed or tested setup.

## Existing foundations

- Dorothy's [provider implementation][providers] already supports
  Featherless through Chat Completions. Featherless documents a direct
  Open WebUI connection at `https://api.featherless.ai/v1`
  ([guide][fl-webui]).
- Her [identity package][identity] supplies host-neutral text, separate
  from a host's capabilities and plumbing.
- Her [memory service][memory] already serves Streamable HTTP MCP.
  Open WebUI supports that transport natively ([MCP][ow-mcp]). This
  makes a memory connection plausible without introducing a stdio
  proxy, subject to authentication, reachability and project scope.
- Her [gateway][gateway] currently injects identity only into
  Anthropic-format message requests. The broader gateway is a roadmap
  idea; it must not be described as an existing Chat Completions agent
  endpoint for WebUI.

Open WebUI supplies native tool loops and external tools. Its separate
Open Terminal integration adds shell and filesystem operations with a
persistent execution environment ([Open Terminal][ow-terminal]).
These capabilities establish an agent-host option. They do not measure
the quality of a particular model's task planning or tool use.

## Two viable approaches

### Open WebUI runs Dorothy

Open WebUI owns the conversation and tool loop, Featherless the model,
Dorothy her identity and memory, and Open Terminal the execution
environment. A repository-owned integration would generate the persona
configuration, connect the memory service, deliver opening context and
record WebUI conversations back into Dorothy's archive.

Her memory should remain one shared service across hosts. Automatic
recording needs stable user, chat, message and project identities, plus
handling of edits, retries and branches. Merely attaching the recall
tools does not supply these behaviours.

### Open WebUI fronts Dorothy in Hermes

Hermes owns execution and tools; WebUI presents the conversation.
Open WebUI documents connecting to agents' compatible API servers,
including Hermes ([agent connections][ow-agents]). Dorothy already has
a [Hermes delivery profile][delivery] and a session recorder.

This looked like the shortest initial path for a general agentic web
interface. It remains an inference: WebUI-created API sessions must be
shown to load Dorothy's profile, memory provider and model settings.
The delivery report still lists live probes as pending. An API
connection by itself does not establish identity or memory continuity.

## Boundaries to verify

- Select a model with reliable native tool calling. Featherless's
  compatibility does not make every model an effective agent
  ([tool calling][fl-tools]).
- Check the effective model and plan context limits, output limits,
  and concurrency before a workload. The plan endpoint distinguishes
  model limits from account limits ([plan][fl-plan]).
- Test successive tool calls, an error and recovery, memory recall,
  recording, and session resumption. For reasoning models, check the
  provider's preservation settings ([thinking][fl-thinking]).
- Give the agent loop one owner. A custom WebUI Pipe that executes
  tools internally must not emit those completed actions as new tool
  calls for WebUI to execute again. The official Pipe guide explains
  this boundary ([Pipe guide][ow-pipe]).
- Keep provider credentials on the server side, through Dorothy's
  existing secret boundary where Dorothy owns the connection. Test
  network and authentication changes with synthetic memory roots.

## Recommendation in context

For a general browser interface, first verify the existing Hermes
delivery through its API. For Open WebUI as the actual host, persona
delivery and recording are a distinct integration project. Both can
preserve Dorothy's protocol diversity.

The user's subsequent emphasis on agent stewardship changes what to
test first. The [Pi trial proposal][pi-note] directly evaluates the
Herdr workflow they want, and can precede a browser interface. None of
this research established a need to replace Dorothy's existing runtime.

No deployment, package installation, paid inference or live memory
probe was performed. Upstream web documentation was checked on the
research date; no Open WebUI release was installed or pinned locally.

[pi-note]: ./2026-11-03_pi-stewardship.md
[providers]: ../../packages/agent/src/providers.ts
[identity]: ../../packages/identity/AGENTS.md
[memory]: ../../packages/memory/src/service/service.ts
[gateway]: ../../packages/gateway/AGENTS.md
[delivery]: ../reports/2026-11-01-delivery.md
[fl-webui]: https://featherless.ai/docs/open-web-ui
[fl-tools]: https://featherless.ai/docs/tool-calling
[fl-plan]: https://featherless.ai/docs/api-reference-plan
[fl-thinking]: https://featherless.ai/docs/chat-template-kwargs
[ow-mcp]: https://docs.openwebui.com/features/extensibility/mcp/
[ow-terminal]: https://docs.openwebui.com/features/open-terminal/
[ow-agents]:
  https://docs.openwebui.com/getting-started/quick-start/connect-an-agent/
[ow-pipe]:
  https://docs.openwebui.com/features/extensibility/plugin/functions/pipe/
