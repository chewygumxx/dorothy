---
name: dorothy-ambition
description: "One adaptable Dorothy: extensible, remembering; Anthropic in doubt"
metadata:
  node_type: memory
  type: project
  originSessionId: 7799bd91-7490-4c5f-acc5-387e592c63f5
  modified: 2026-10-14T22:05:02.463Z
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
  OpenRouter when usage runs out or a different model suits the task. On
  2026-10-18 the user was weighing leaving Anthropic altogether for more
  permissive, cheaper models
  ([replacements](../../docs/notes/2026-10-18_open-source-replacements.md)).
- Sceptical of Hermes's self-improvement loop over a scheduled run of
  the claude-md-management or claude-code-setup plugins.
- Memory comes first, and may be reworked whole. Its principle: "Wherever
  you go, your memory follows with you." To be discussed in its spec.
- Nothing is forgotten: a memory may fade in prominence (ranking,
  retiring) but must always remain possible to query. Since 2026-10-18 a
  preference, not a rule: see [memory priorities](./memory-priorities.md).

**Why:** the user wants the best for Dorothy without being hosted by
either project. The objectives report,
`docs/reports/2026-10-15-objectives.md`, records it all.

**How to apply:** weigh designs against these aims, prefer Dorothy as
the core borrowing open formats (SKILL.md, MCP), and treat provider
fallback as a requirement of Model Providers. See
[nested claude sessions](./nested-claude-session-env.md) for probes.
