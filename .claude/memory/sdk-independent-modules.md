---
name: sdk-independent-modules
description: >-
  New subsystems (such as memory recall tooling) stay independent of the Agent
  SDK, as separate modules speaking standard protocols
metadata:
  node_type: memory
  type: feedback
  originSessionId: 2ccf70ee-6409-47ee-beb4-47238d16379f
  modified: 2026-10-05T18:02:11.730Z
---

Build new subsystems, such as Dorothy's memory recall tooling, independent of
the Claude Agent SDK, as separate specialised modules (an MCP server over
stdio, say), rather than through SDK conveniences like `createSdkMcpServer`.

**Why:** On 2026-10-06, choosing recall's tooling, the user said the move to
the Messages API is highly valued, so leaning on the SDK is needless technical
debt; they also favour UNIX philosophy (small programs with one job).

**How to apply:** Keep SDK types at a thin adapter edge, and prefer standard
protocols that the Messages API iteration can reuse unchanged. Recall's spec
(`docs/specs/2026-10-06-recall-design.md`) is the worked example.
