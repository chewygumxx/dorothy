---
name: dorothy-ambition
description: "One adaptable Dorothy: extensible, remembering, Anthropic first"
metadata:
  node_type: memory
  type: project
  originSessionId: 7799bd91-7490-4c5f-acc5-387e592c63f5
  modified: 2026-10-14T21:10:22.279Z
---

Stated 2026-10-15, after comparing OpenClaw and Hermes Agent as hosts:

- One Dorothy, adaptable above all: resilient to upstream hindrance
  (vendor policy, quota), remembering and learning, efficient and nimble,
  extendable so she can grow.
- Extensibility like OpenClaw's, chiefly its catalogue of skills and
  tools; reaching her away from the terminal (chat apps) is a welcome
  second.
- Identity persistence and memory management like Hermes's, which the
  user sees as the state of the art.
- Anthropic's models first, falling back to featherless.ai and maybe
  OpenRouter when usage runs out or a different model suits the task.
- Sceptical of Hermes's self-improvement loop over a scheduled run of
  the claude-md-management or claude-code-setup plugins.
- Memory comes first, and may be reworked whole. Its principle: "Wherever
  you go, your memory follows with you." To be discussed in its spec.

**Why:** the user wants the best for Dorothy without being hosted by
either project. The objectives report,
`docs/reports/2026-10-15-objectives.md`, records it all.

**How to apply:** weigh designs against these aims, prefer Dorothy as
the core borrowing open formats (SKILL.md, MCP), and treat provider
fallback as a requirement of Model Providers. See
[nested claude sessions](./nested-claude-session-env.md) for probes.
