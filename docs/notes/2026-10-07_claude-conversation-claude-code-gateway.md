---
ctime: 2026-10-07
mtime: 2026-10-07
spdx: GPL-3.0-only
title: "Conversation with Claude: Claude Code Gateway"
description: >-
  Extract of Claude conversation regarding a gateway proxy between Claude Code
  API requests for the sake of editing persistent context.
tags:
  - llm
  - claude
  - claude-code
  - gateway
  - proxy
  - anthropic
  - dorothy
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-10-07_claude-conversation-claude-code-gateway.md
   -
   -->

# Conversation with Claude: Claude Code Gateway

## chewygumxx Prompt 1

Despite the flexibility and customisation that the Claude Code Agent SDK
documentation espouses, it's apparent that there is no way the following can be
omitted without a patch:

```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "text",
          "text": "<system-reminder>\nAs you answer the user's questions, you can use the following context:\n# userEmail\nThe user's email address is cgumxx@pm.me. Use it only to identify the user, such as for authorship, attribution, or filtering their own work. Never send it to an unrelated service, such as in a request header, URL, or payload, unless the user explicitly asks.\n\nClaude Code attached this context automatically; it isn't part of the user's message. It describes the user's own account and workspace, so they don't need it reported back.\n</system-reminder>\n"
        }
      ]
    },
    {
      "role": "system",
      "content": [
        {
          "type": "text",
          "text": "# Environment\nYou have been invoked in the following environment: \n - Primary working directory: /home/chewygumxx/dev/dorothy/.claude/worktrees/context-leak\n - This is a git worktree \u2014 an isolated copy of the repository. Run all commands from this directory. Do NOT `cd` to the original repository root.\n - The git stash stack is shared with the main checkout and all other worktrees, and other Claude sessions may push or pop it concurrently. Never use bare `git stash` / `git stash pop` \u2014 you could pop another session's changes. Prefer a temporary WIP commit to set work aside; if you must stash, use `git stash push -u -m \"<unique-tag>\"`, immediately capture your entry's SHA via `git stash list --format='%H %gs'`, restore with `git stash apply <sha>` (not pop), and afterwards drop the entry, re-finding its current `stash@{n}` by tag first.\n - Is a git repository: true\n - Platform: linux\n - Shell: zsh\n - OS Version: Linux 7.2.8-arch1-2\n\nYou are powered by the model named Sonnet 5.5. The exact model ID is claude-sonnet-5-5. Assistant knowledge cutoff is June 2026.\n\n<total_tokens>15000000 tokens left</total_tokens>\n\nToday's date is 2026-10-07.",
          "cache_control": {
            "type": "ephemeral",
            "ttl": "1h"
          }
        }
      ],
      "output_config": {
        "effort": "medium"
      }
    }
  ],
  "system": [
    {
      "type": "text",
      "text": "x-anthropic-billing-header: cc_version=2.1.287.56c; cc_entrypoint=sdk-ts;"
    },
    {
      "type": "text",
      "text": "You are a Claude agent, built on Anthropic's Claude Agent SDK.",
      "cache_control": {
        "type": "ephemeral",
        "ttl": "1h"
      }
    }
  ]
}
```

While I have no interest in eliding the content of `.system`, nor do I have
issue with Anthropic being sent the email in which my Claude account is
assigned, there are applications in which I _would_ like the `.messages[1]`
completely elided. For example, my repository hosted at
<https://github.com/chewygumxx/dorothy.>

The obvious solution would be the Messages API however I'm not ready for that
expense when I've not even finished testing. I haven't tried patching it out of
respect for Anthropic's Terms of Service and my naivety of certain items and
their metric for violation. Does Anthropic explicitly forbid patching the API?
Is there some other means that is compliant with Anthropic's stipulations that
I may pursue alternatively?

---

## Claude Response 1

I'll check Anthropic's current terms and the Agent SDK docs on this, then look
at your repo for context.

The synthetic tests pass. Now checking it against what the real Agent SDK
actually sends, using a fake upstream so no credentials are involved.

### Short answer

No clause says "do not patch the Agent SDK" in those words, but the clause a
patch would most plausibly be judged against does exist. More usefully, you
don't need a patch: Claude Code has a documented interception point where you
can drop that message from your own outgoing requests. I built that for Dorothy
and tested it against the real SDK.

### What Anthropic's terms say

With a Pro/Max token you are under the Consumer Terms. Section 3 bars
decompiling, reverse engineering, disassembling, or otherwise reducing the
Services to human-readable form, except where the law prohibits that
restriction. Patching the shipped Claude Code bundle means doing exactly that
to find the code that builds the block, so that is where the risk sits. The
same section bars access through bots or scripts unless you use an Anthropic
API key or Anthropic explicitly permits it. SDK use on a subscription rests on
that permission: personal use and local development with the Agent SDK were
confirmed as fine by Anthropic and by Thariq's post, and the advertised Pro and
Max limits assume ordinary, individual use of Claude Code and the Agent SDK.

The only literal "must not be modified" rule is narrower: when Claude Code is
preinstalled or run inside your products, it must be installed and run as
Anthropic publishes it. That isn't your situation today, but it shows where
Anthropic stands on modification. Anthropic also reserves the right to enforce
these restrictions without prior notice, and the same page points to sales for
questions about permitted authentication.

One note for Dorothy specifically: developers building products should use API
keys, and may not collect, store, or intermediate Claude.ai credentials or
session tokens. Your own token on your own machine is personal use. If other
people start running Dorothy, the README's `CLAUDE_CODE_OAUTH_TOKEN` path is
where that rule applies.

I'm not a lawyer; this is a reading of the published text.

### Why no SDK option removes it

You're right that configuration can't do it. The working directory, platform,
shell, and OS version are delivered in the conversation, not the system prompt,
so a custom `systemPrompt` never touches them. The docs' table of built-in
context you can switch off covers git instructions, commit attribution, setting
sources, CLAUDE.md files, and attachment reminders, with nothing for the
environment block, and the environment variable reference has no toggle either.
`excludeDynamicSections` only moves per-user context into the first user
message, and the SDK ignores it with a custom prompt. Bare mode trims more, but
it never reads OAuth credentials or the keychain, so it requires an API key.

### The compliant route: a gateway you run

The docs themselves suggest pointing `ANTHROPIC_BASE_URL` at a proxy you
control to inspect requests. They also say that with only `ANTHROPIC_BASE_URL`
set, requests route through the gateway while your saved claude.ai login stays
the active credential, so its limits and billing apply; a gateway forwarding to
Anthropic must pass the OAuth capability in `anthropic-beta`. So the setup is
documented, and dropping a message there edits your own outbound request
without changing Anthropic's software. The docs don't specifically bless
removing content, so this is the most defensible option rather than a
guaranteed one.

#### What `env-strip-gateway.ts` does

- Removes only the `# Environment` block, in either shape: the `role: "system"`
  message, or a `<system-reminder>` block inside a user message.
- Leaves `.system`, the `userEmail` reminder, every other message, all headers
  and your token untouched.
- If the removed message carried `output_config`, moves it to the top level of
  the request unless the request already sets one there.
- Decompresses gzip request bodies before rewriting them, and streams SSE
  replies through unchanged.
- Listens on loopback only, never logs credentials, and logs a warning if the
  block shows up in a shape it doesn't recognise, so you notice format drift.

#### How I tested it

- The 11 unit tests pass. They cover both message shapes, gzip bodies,
  streaming, token counting, byte-for-byte passthrough, and GET requests.
- I ran the real Agent SDK 0.3.292 (Claude Code 2.1.292) against a mock
  upstream. Without the gateway, `messages[1]` was the `role: "system"`
  environment message with its own `output_config`, matching your dump.
  Through the gateway that message was gone, everything else was identical,
  and the reply completed. That build also sends the same `effort` at the
  top level, so dropping the message loses nothing.

#### Wiring it into Dorothy

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { startEnvStripGateway } from "./env-strip-gateway";

const gateway = startEnvStripGateway();

for await (const message of query({
  prompt,
  options: {
    systemPrompt: persona,
    env: { ...process.env, ANTHROPIC_BASE_URL: gateway.url },
  },
})) {
  // ...
}
```

Spread `process.env` because in TypeScript the `env` option replaces the
inherited environment. If you have `HTTPS_PROXY` set, add `NO_PROXY:
"127.0.0.1"` as well.

There are two side effects. A non-first-party base URL turns off MCP tool
search by default, and turns off Remote Control. Also, through a gateway the
system prompt is sent as one block, not split into two separately cached
blocks. For Dorothy's single persona prompt, neither should matter.

### Alternatives to patching

1. **The gateway above.** It needs no change to Anthropic's software and runs
   inside Dorothy's own process.
2. **Move to the Messages API when you're ready.** There's no rush on cost: the
   planned separate Agent SDK credit is paused, so SDK usage still draws from
   your subscription limits for now.
3. **Ask Anthropic.** You could file a feature request on
   `anthropics/claude-code` for a toggle that turns off the environment
   context, or contact them for a ruling on patching.

### Related convention

The contract here is the Messages API wire format, which Claude Code's gateway
compatibility guide treats as what a gateway must honour. Replies stream as
standard Server-Sent Events (`text/event-stream`), which is why the gateway can
pass the response body through without parsing it.

### Sources

- [Legal and compliance, Claude Code Docs](https://code.claude.com/docs/en/legal-and-compliance)
- [Consumer Terms of Service](https://www.anthropic.com/legal/consumer-terms)
- [Modifying system prompts, Agent SDK](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts)
- [Other LLM gateways](https://code.claude.com/docs/en/llm-gateway)
- [Environment variables](https://code.claude.com/docs/en/env-vars)
- [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)
- [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Anthropic's Confusing Claude Subscription Policy, Explained](https://engineerscodex.com/anthropic-claude-subscription-switcharoo)

---

## Claude Artifact: env-strip-gateway.ts

```ts
// SPDX-License-Identifier: GPL-3.0-only
//
// env-strip-gateway.ts
//
// A local Anthropic-format gateway for the Claude Agent SDK. Point
// ANTHROPIC_BASE_URL at it and it forwards every request to the real API
// as is, except that it removes the "# Environment" context block Claude
// Code adds to the conversation (working directory, worktree notes,
// platform, shell, OS version, model name, token budget, date). The system
// prompt, every other message, all headers and your credentials pass
// through untouched.
//
// Standalone:  bun env-strip-gateway.ts         (listens on 127.0.0.1:8787)
// Embedded:    const gateway = startEnvStripGateway();
//              query({ prompt, options: { env: { ...process.env, ANTHROPIC_BASE_URL: gateway.url } } })
//
// Environment variables (standalone mode):
//     ENV_STRIP_PORT      port to listen on (default 8787)
//     ENV_STRIP_UPSTREAM  where to forward (default https://api.anthropic.com)
//     ENV_STRIP_QUIET     set to 1 to stop logging what was removed

// The block as Claude Code sends it, either bare (a role "system" message on
// newer models) or wrapped in <system-reminder> tags inside a user message.
const ENVIRONMENT_BLOCK =
  /^\s*(?:<system-reminder>\s*)?# Environment\s*\n\s*You have been invoked in the following environment/;

// Used only to warn when the format drifts and the block slips through.
const ENVIRONMENT_MARKER = "You have been invoked in the following environment";

// Headers that describe one hop of the connection rather than the request.
const HOP_HEADERS = [
  "host",
  "connection",
  "keep-alive",
  "content-length",
  "transfer-encoding",
  "accept-encoding",
];

type Block = { type?: string; text?: unknown; [key: string]: unknown };
type Message = {
  role?: string;
  content?: string | Block[];
  [key: string]: unknown;
};
type Body = {
  messages?: unknown;
  output_config?: unknown;
  [key: string]: unknown;
};

export type StripReport = {
  // Environment text blocks removed.
  blocks: number;
  // Messages removed because the block was all they held.
  messages: number;
  // Per-message fields moved to the request top level so they still apply.
  hoisted: string[];
  // Per-message fields lost with a removed message.
  dropped: string[];
};

export type GatewayOptions = {
  port?: number;
  hostname?: string;
  upstream?: string;
  log?: (line: string) => void;
};

export type Gateway = {
  url: string;
  upstream: string;
  stop: () => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isEnvironmentText(text: unknown): boolean {
  return typeof text === "string" && ENVIRONMENT_BLOCK.test(text);
}

// Removes the environment block from a Messages API request body in place.
export function stripEnvironment(body: Body): StripReport {
  const report: StripReport = {
    blocks: 0,
    messages: 0,
    hoisted: [],
    dropped: [],
  };
  if (!Array.isArray(body.messages)) {
    return report;
  }

  const kept: Message[] = [];
  for (const message of body.messages as Message[]) {
    let content: Block[] | string | undefined = message?.content;
    let removed = 0;

    if (isEnvironmentText(content)) {
      content = [];
      removed = 1;
    } else if (Array.isArray(content)) {
      const before = content.length;
      content = content.filter(
        (block) => !(block?.type === "text" && isEnvironmentText(block.text)),
      );
      removed = before - content.length;
    }

    if (removed === 0 || !Array.isArray(content)) {
      kept.push(message);
      continue;
    }
    report.blocks += removed;

    if (content.length > 0) {
      kept.push({ ...message, content });
      continue;
    }

    // The message held nothing but the environment block, so it goes.
    // Settings riding on it (such as output_config.effort) move to the
    // top level of the request, where the API also accepts them, unless
    // the request already sets them there.
    report.messages += 1;
    for (const [key, value] of Object.entries(message)) {
      if (key === "role" || key === "content") {
        continue;
      }
      if (key === "output_config" && isRecord(value)) {
        const existing = isRecord(body.output_config) ? body.output_config : {};
        body.output_config = { ...value, ...existing };
        report.hoisted.push(key);
      } else {
        report.dropped.push(key);
      }
    }
  }

  body.messages = kept;
  return report;
}

type Bytes = Uint8Array<ArrayBuffer>;

function rewriteBody(
  bytes: Bytes,
  label: string,
  log: (line: string) => void,
): Bytes {
  const text = new TextDecoder().decode(bytes);
  if (!text.includes(ENVIRONMENT_MARKER)) {
    return bytes;
  }

  let body: Body;
  try {
    body = JSON.parse(text);
  } catch {
    log(`[env-strip] ${label}: body is not JSON, forwarded unchanged`);
    return bytes;
  }

  const report = stripEnvironment(body);
  const out = JSON.stringify(body);

  if (report.blocks > 0) {
    const parts = [`removed ${report.blocks} environment block(s)`];
    if (report.messages > 0) {
      parts.push(`${report.messages} message(s) dropped`);
    }
    if (report.hoisted.length > 0) {
      parts.push(`moved ${report.hoisted.join(", ")} to the top level`);
    }
    if (report.dropped.length > 0) {
      parts.push(`lost per-message ${report.dropped.join(", ")}`);
    }
    log(`[env-strip] ${label}: ${parts.join("; ")}`);
  }
  if (out.includes(ENVIRONMENT_MARKER)) {
    log(
      `[env-strip] ${label}: environment text is still present in a shape this gateway does not recognise`,
    );
  }

  return report.blocks > 0 ? new TextEncoder().encode(out) : bytes;
}

function errorResponse(status: number, message: string): Response {
  return Response.json(
    { type: "error", error: { type: "api_error", message } },
    { status },
  );
}

export function startEnvStripGateway(options: GatewayOptions = {}): Gateway {
  const upstream = (options.upstream ?? "https://api.anthropic.com").replace(
    /\/+$/,
    "",
  );
  const log = options.log ?? (() => {});

  const server = Bun.serve({
    // Loopback only: requests carry your OAuth token or API key.
    hostname: options.hostname ?? "127.0.0.1",
    port: options.port ?? 0,
    // A streamed reply can stay quiet for a long time while Claude thinks.
    idleTimeout: 0,

    async fetch(request) {
      const incoming = new URL(request.url);
      const target = `${upstream}${incoming.pathname}${incoming.search}`;
      const label = `${request.method} ${incoming.pathname}`;

      const headers = new Headers(request.headers);
      for (const name of HOP_HEADERS) {
        headers.delete(name);
      }
      // Ask for an uncompressed reply so it can stream straight through.
      headers.set("accept-encoding", "identity");

      let body: Bytes | undefined;
      if (request.method !== "GET" && request.method !== "HEAD") {
        body = new Uint8Array(await request.arrayBuffer());
        if (headers.get("content-encoding")?.toLowerCase() === "gzip") {
          body = new Uint8Array(Bun.gunzipSync(body));
          headers.delete("content-encoding");
        }
        if (
          request.method === "POST" &&
          incoming.pathname.startsWith("/v1/messages")
        ) {
          body = rewriteBody(body, label, log);
        }
      }

      let response: Response;
      try {
        response = await fetch(target, {
          method: request.method,
          headers,
          body,
          redirect: "manual",
          signal: request.signal,
        });
      } catch (error) {
        return errorResponse(
          502,
          `env-strip gateway could not reach ${upstream}: ${String(error)}`,
        );
      }

      const outHeaders = new Headers(response.headers);
      for (const name of [
        "content-encoding",
        "content-length",
        "transfer-encoding",
        "connection",
      ]) {
        outHeaders.delete(name);
      }
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: outHeaders,
      });
    },
  });

  return {
    url: server.url.href.replace(/\/+$/, ""),
    upstream,
    stop: () => server.stop(true),
  };
}

if (import.meta.main) {
  const quiet = process.env.ENV_STRIP_QUIET === "1";
  const gateway = startEnvStripGateway({
    port: Number(process.env.ENV_STRIP_PORT ?? 8787),
    upstream: process.env.ENV_STRIP_UPSTREAM,
    log: quiet ? undefined : (line) => console.error(line),
  });
  console.error(
    `[env-strip] listening on ${gateway.url}, forwarding to ${gateway.upstream}`,
  );
  console.error(`[env-strip] set ANTHROPIC_BASE_URL=${gateway.url}`);
}
```

---

## Claude Artifact: env-strip-gateway.test.ts

```ts
// SPDX-License-Identifier: GPL-3.0-only

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type Gateway,
  startEnvStripGateway,
  stripEnvironment,
} from "./env-strip-gateway";

const ENVIRONMENT_TEXT = [
  "# Environment",
  "You have been invoked in the following environment: ",
  " - Primary working directory: /home/someone/dev/dorothy",
  " - Platform: linux",
  " - Shell: zsh",
  "",
  "You are powered by the model named Sonnet 5.5. The exact model ID is claude-sonnet-5-5.",
  "",
  "Today's date is 2026-10-07.",
].join("\n");

const EMAIL_REMINDER =
  "<system-reminder>\n# userEmail\nThe user's email address is someone@example.com.\n</system-reminder>\n";

function requestBody() {
  return {
    model: "claude-sonnet-5-5",
    max_tokens: 1024,
    stream: true,
    system: [
      {
        type: "text",
        text: "x-anthropic-billing-header: cc_version=2.1.287.56c; cc_entrypoint=sdk-ts;",
      },
      {
        type: "text",
        text: "You are Dorothy.",
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ],
    messages: [
      { role: "user", content: [{ type: "text", text: EMAIL_REMINDER }] },
      {
        role: "system",
        content: [
          {
            type: "text",
            text: ENVIRONMENT_TEXT,
            cache_control: { type: "ephemeral", ttl: "1h" },
          },
        ],
        output_config: { effort: "medium" },
      },
      { role: "user", content: [{ type: "text", text: "What is your name?" }] },
    ],
  };
}

type Seen = { method: string; path: string; headers: Headers; body: string };

let seen: Seen[] = [];
let upstream: ReturnType<typeof Bun.serve>;
let gateway: Gateway;
const logs: string[] = [];

beforeAll(() => {
  upstream = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      seen.push({
        method: request.method,
        path: url.pathname + url.search,
        headers: request.headers,
        body: await request.text(),
      });
      if (url.pathname === "/v1/messages") {
        const events = [
          'event: message_start\ndata: {"type":"message_start"}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Dorothy"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ];
        const stream = new ReadableStream({
          async start(controller) {
            for (const event of events) {
              controller.enqueue(new TextEncoder().encode(event));
              await Bun.sleep(5);
            }
            controller.close();
          },
        });
        return new Response(stream, {
          headers: { "content-type": "text/event-stream" },
        });
      }
      if (url.pathname === "/v1/models") {
        return Response.json({ data: [{ id: "claude-sonnet-5-5" }] });
      }
      return Response.json({ input_tokens: 42 });
    },
  });
  gateway = startEnvStripGateway({
    upstream: upstream.url.href,
    log: (line) => logs.push(line),
  });
});

afterAll(() => {
  gateway.stop();
  upstream.stop(true);
});

function send(
  path: string,
  body: string | Uint8Array,
  extra: Record<string, string> = {},
) {
  seen = [];
  return fetch(`${gateway.url}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer sk-ant-oat01-test",
      "anthropic-beta": "oauth-2025-04-20",
      ...extra,
    },
    body,
  });
}

describe("stripEnvironment", () => {
  test("drops the system-role environment message and keeps its effort", () => {
    const body = requestBody();
    const report = stripEnvironment(body);
    expect(report).toEqual({
      blocks: 1,
      messages: 1,
      hoisted: ["output_config"],
      dropped: [],
    });
    expect(body.messages.map((m) => m.role)).toEqual(["user", "user"]);
    expect((body as { output_config?: unknown }).output_config).toEqual({
      effort: "medium",
    });
  });

  test("an existing top-level output_config wins over the hoisted one", () => {
    const body = { ...requestBody(), output_config: { effort: "high" } };
    stripEnvironment(body);
    expect(body.output_config).toEqual({ effort: "high" });
  });

  test("removes only the environment block from a mixed user message", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EMAIL_REMINDER },
            {
              type: "text",
              text: `<system-reminder>\n${ENVIRONMENT_TEXT}\n</system-reminder>`,
            },
            { type: "text", text: "Hello" },
          ],
        },
      ],
    };
    const report = stripEnvironment(body);
    expect(report.blocks).toBe(1);
    expect(report.messages).toBe(0);
    expect(body.messages[0].content.map((b) => b.text)).toEqual([
      EMAIL_REMINDER,
      "Hello",
    ]);
  });

  test("handles string content", () => {
    const body = {
      messages: [
        { role: "system", content: ENVIRONMENT_TEXT },
        { role: "user", content: "Hi" },
      ],
    };
    expect(stripEnvironment(body).messages).toBe(1);
    expect(body.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  test("leaves a user's own mention of the heading alone", () => {
    const body = {
      messages: [
        {
          role: "user",
          content: "Explain what '# Environment' means in Claude Code",
        },
      ],
    };
    expect(stripEnvironment(body).blocks).toBe(0);
  });
});

describe("gateway", () => {
  test("strips the block, forwards everything else, and streams the reply", async () => {
    const response = await send(
      "/v1/messages?beta=true",
      JSON.stringify(requestBody()),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reply = await response.text();
    expect(reply).toContain('"text":"Dorothy"');
    expect(reply.endsWith('data: {"type":"message_stop"}\n\n')).toBe(true);

    const [request] = seen;
    expect(request.path).toBe("/v1/messages?beta=true");
    expect(request.headers.get("authorization")).toBe(
      "Bearer sk-ant-oat01-test",
    );
    expect(request.headers.get("anthropic-beta")).toBe("oauth-2025-04-20");

    const forwarded = JSON.parse(request.body);
    const original = requestBody();
    expect(forwarded.system).toEqual(original.system);
    expect(forwarded.messages).toEqual([
      original.messages[0],
      original.messages[2],
    ]);
    expect(forwarded.output_config).toEqual({ effort: "medium" });
    expect(request.body).not.toContain("Primary working directory");
  });

  test("decompresses a gzip request body before rewriting it", async () => {
    const gz = Bun.gzipSync(
      new TextEncoder().encode(JSON.stringify(requestBody())),
    );
    const response = await send("/v1/messages", gz, {
      "content-encoding": "gzip",
    });
    expect(response.status).toBe(200);
    await response.text();
    expect(seen[0].headers.get("content-encoding")).toBeNull();
    expect(JSON.parse(seen[0].body).messages).toHaveLength(2);
  });

  test("strips token counting requests too", async () => {
    const response = await send(
      "/v1/messages/count_tokens",
      JSON.stringify(requestBody()),
    );
    expect(await response.json()).toEqual({ input_tokens: 42 });
    expect(seen[0].body).not.toContain("Primary working directory");
  });

  test("forwards a body without the block byte for byte", async () => {
    const raw = JSON.stringify(
      { model: "m", messages: [{ role: "user", content: "Hi" }] },
      null,
      4,
    );
    await (await send("/v1/messages", raw)).text();
    expect(seen[0].body).toBe(raw);
  });

  test("passes GET requests through", async () => {
    seen = [];
    const response = await fetch(`${gateway.url}/v1/models`, {
      headers: { "x-api-key": "k" },
    });
    expect(await response.json()).toEqual({
      data: [{ id: "claude-sonnet-5-5" }],
    });
    expect(seen[0].headers.get("x-api-key")).toBe("k");
  });

  test("logs what it removed without logging credentials", () => {
    const joined = logs.join("\n");
    expect(joined).toContain("removed 1 environment block(s)");
    expect(joined).not.toContain("sk-ant");
  });
});
```

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
