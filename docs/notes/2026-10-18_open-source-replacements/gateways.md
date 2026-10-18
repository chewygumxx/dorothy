---
ctime: 2026-10-18
mtime: 2026-10-18
spdx: GPL-3.0-only
title: "Provider-neutral Dorothy: what already exists (research as of 2026-10-18)"
description: >-
  LLM gateways, TypeScript model libraries, cheaper model sources and
  Anthropic's terms, against Dorothy's model side.
tags:
  - dorothy
  - providers
  - notes
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-10-18_open-source-replacements/gateways.md
   -
   -->

# Provider-neutral Dorothy: what already exists (research as of 2026-10-18)

A research agent's report, kept as it was written apart from its line
wrapping, its em dashes and this header, for the
[note on open-source replacements](../2026-10-18_open-source-replacements.md).

I changed no files in the repo. Statements carry a link. Anything sourced only
from third-party blogs, or not confirmed at all, is marked **(unverified)**.

## Summary

- **Nothing open source does Dorothy's marker-based, additive, byte-for-byte
  system-prompt rewrite.** Every router that can inject a prompt does it by
  parsing and re-serialising the request. The ones with declarative injection
  only prepend or append messages. Claude Code's own gateway guide says that
  rewriting `system` defeats its attribution strip and can break preserved
  thinking, and that allowlisting fields breaks features ([CC gateway
  guide](https://code.claude.com/docs/en/llm-gateway-protocol)). Keep
  `packages/gateway` and change only what it forwards to.
- **Most cheap open-model vendors now serve the Anthropic Messages API
  natively.** That covers DeepSeek, Moonshot/Kimi, MiniMax, Qwen/DashScope, Z.ai
  and OpenRouter, plus local Ollama, llama.cpp, vLLM and LM Studio. Dorothy's
  gateway already reads its upstream from `ANTHROPIC_BASE_URL`
  (`packages/gateway/src/server.ts`, `upstreamFrom`), so moving `dorothy
  --claude` off Anthropic is mostly configuration.
- **The Vercel AI SDK 7 is the best replacement for `packages/agent`**
  (Apache-2.0, `ai@7.0.143` published 2026-10-16). It takes zod schemas, has
  middleware, a provider registry, an Anthropic provider with a custom base URL,
  and OpenAI-compatible and OpenRouter providers. pi-ai (MIT, now owned by
  Earendil) is the lighter runner-up, with built-in cost tracking and
  cross-provider handoff, but it uses TypeBox rather than zod.
- **For routing and fallback, OpenRouter is the cheapest to operate** (hosted, a
  `models` fallback array, a no-logging default). Self-hosted options: LiteLLM
  has the broadest coverage but is Python, needs Postgres for budgets, and was
  hit by a supply-chain attack in March 2026. Bifrost (Go, Apache-2.0) and
  agentgateway (Rust, Apache-2.0) are the leanest. CCR v3 is the most "Claude
  Code native".
- **Coding plans are off-limits for a persona assistant.** Z.ai's GLM Coding
  Plan, Kimi Code and Alibaba's Coding Plan restrict use to approved coding
  tools, and Alibaba forbids app backends and scripts. Featherless's $25 flat
  plan excludes API traffic and background automation. Use pay-as-you-go APIs.
- **Policy, factually:**
  - Anthropic's current wording says developers building with the Agent SDK
    "should use API key authentication".
  - Since 2026-04-04, subscriptions no longer cover third-party harnesses.
  - Dorothy's `.env` declares `CLAUDE_CODE_OAUTH_TOKEN`, which `packages/agent`
    uses with the Agent SDK. That sits in the grey zone this wording addresses.
  - Max plans now include $100 or $200 of monthly API credits that explicitly
    cover the Agent SDK when used with an API key.

---

## A. Gateways and routers

| Project | Licence | Language / deployment | Accepts | Request rewrite hook | Routing / fallback | Budgets | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [LiteLLM](https://github.com/BerriAI/litellm) | MIT, except `enterprise/` ([LICENSE](https://raw.githubusercontent.com/BerriAI/litellm/main/LICENSE)) | Python; pip/uv, Docker, Helm | Anthropic `/v1/messages`, OpenAI chat, `/responses` | `async_pre_call_hook` mutates `data` ([docs](https://docs.litellm.ai/docs/proxy/call_hooks)) | Router retries and fallbacks, load balancing | Per key/user/team, `budget_duration`, TPM/RPM; needs Postgres; per-model budgets are Enterprise ([docs](https://docs.litellm.ai/docs/proxy/users)) | Active; v1.105.1 "Latest" on 14 Oct ([releases](https://github.com/BerriAI/litellm/releases)) |
| [claude-code-router](https://github.com/musistudio/claude-code-router) v3 | MIT | TypeScript, Node 22+; Electron desktop app, CLI or Docker | Anthropic Messages, OpenAI Chat and Responses, Gemini | "Request rewrites" and gateway plugins; system-prompt injection not documented **(unverified)** | Conditions on headers and bodies, retries, ordered fallbacks, credential pools | Client keys with request and token limits; logs show estimated cost | v3.1.3, 2026-10-09 ([releases](https://github.com/musistudio/claude-code-router/releases)) |
| [Bifrost](https://github.com/maximhq/bifrost) | Apache-2.0; some features Enterprise | Go; `npx`, Docker, Helm | `/anthropic`, `/openai` (Codex uses `/openai/v1`), Gemini ([agents](https://docs.getbifrost.ai/cli-agents/overview)) | Go plugin `PreLLMHook` edits the normalised `BifrostRequest`, loaded as a `.so` ([docs](https://docs.getbifrost.ai/plugins/writing-go-plugin)) | Automatic failover, key and provider load balancing | Virtual-key, team and customer budgets in open source | transports v2.3.0, 2026-10-13 (GitHub API) |
| [agentgateway](https://github.com/agentgateway/agentgateway) | Apache-2.0 (Linux Foundation / AAIF) | Rust; standalone binary or Kubernetes | `/v1/messages`, OpenAI; converts Messages to Responses | Declarative `prompts.prepend/append` ([docs](https://agentgateway.dev/docs/standalone/latest/documentation/configuration/traffic-management/llm/)) | Routing, model aliases | API-key-scoped LLM budgets ([releases](https://github.com/agentgateway/agentgateway/releases)) | v1.6.0, 2026-10-02 |
| [Agent Router](https://github.com/theagentrouter/agent-router) (formerly Envoy AI Gateway) | Apache-2.0 | Go/Envoy; `aigw run` or Kubernetes | `/anthropic/v1/messages`, translated to OpenAI, Bedrock and others ([v1.0](https://theagentrouter.ai/release-notes/v1.0/)) | Envoy-level only | Failover | Quotas, rate limits | Renamed 2026-09-10; v1.2.0 on 2026-10-06 ([blog](https://theagentrouter.ai/blog/envoy-ai-gateway-is-now-agent-router/)) |
| [Portkey Gateway](https://github.com/Portkey-AI/gateway) | MIT | TypeScript; `npx`, Docker, Workers | OpenAI; Anthropic `/messages` on the hosted product ([docs](https://portkey.ai/docs/integrations/libraries/claude-code)); in the open-source gateway **(unverified)** | Guardrails that deny, not rewrite | Fallbacks, conditional routing, retries | Hosted/Enterprise only | Palo Alto Networks bought it, closing 2026-05-29 ([10-K](https://www.sec.gov/Archives/edgar/data/0001327567/000132756726000023/panw-20260731.htm)); last push to default branch 2026-05-25 |
| [Otari](https://github.com/mozilla-ai/otari) (Mozilla.ai, built on [any-llm](https://github.com/mozilla-ai/any-llm)) | Apache-2.0 | Python 3.13; Docker plus Postgres | `/api/v1/messages`, `/chat/completions`, `/responses` | None documented | Failover, weighting | Budgets checked before dispatch ([any-llm-gateway post](https://blog.mozilla.ai/control-llm-spend-and-access-with-any-llm-gateway/)) | Young (622 stars). Whether it is any-llm-gateway renamed is **(unverified)** |
| [Kong AI Gateway](https://developer.konghq.com/plugins/ai-prompt-decorator/) | Core Apache-2.0; advanced AI plugins Enterprise | Lua/Nginx | `/v1/messages` ([guide](https://developer.konghq.com/ai-gateway/use-claude-code-with-ai-gateway-openai/)) | AI Prompt Decorator prepends or appends messages | Model-based routing | Enterprise | Claim that the open-source line froze at 3.9.x comes from a competitor ([enterpilot](https://enterpilot.io/blog/kong-ai-gateway-alternative/)) **(unverified)** |
| [Helicone AI Gateway](https://github.com/Helicone/ai-gateway) | LICENSE file says GPL-3.0; README says Apache | Rust | OpenAI | None | Load balancing | Rate limits | Mintlify bought it on 2026-03-03 and it is in maintenance mode ([respan](https://www.respan.ai/blog/best-helicone-alternative)); last push 2025-11-21 |
| [TensorZero](https://github.com/tensorzero/tensorzero) | Apache-2.0 | Rust | OpenAI | Templates | Variants, fallbacks | Rate limits | **Archived 2026-06-12** ([byteiota](https://byteiota.com/tensorzero-shuts-down-what-oss-llmops-cant-survive/)) |
| [LLM Gateway](https://github.com/theopenco/llmgateway) | AGPL per third parties **(unverified)**, plus a commercial `ee/` | TypeScript | OpenAI | n/a | Yes | Yes | Active |

### Anthropic-to-OpenAI translators

- [y-router](https://github.com/luohy15/y-router) was archived on 2026-01-11
  because OpenRouter now has native Claude Code support.
- [1rgs/claude-code-proxy](https://github.com/1rgs/claude-code-proxy) declares
  no licence on GitHub, so it is not safely reusable.
- [fuergaosi233/claude-code-proxy](https://github.com/fuergaosi233/claude-code-proxy)
  is MIT and Python, last pushed 2026-03.
- [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) (MIT, 55k stars)
  wraps logins to Claude Code, Codex and other CLIs as an API. Its Claude path
  conflicts with Anthropic's terms (section D).

### Hosted options, not software you run

- [OpenRouter's Anthropic
  "skin"](https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration):
  `ANTHROPIC_BASE_URL=https://openrouter.ai/api`. OpenRouter only *guarantees*
  Claude Code with Anthropic as first-party provider.
- [Vercel AI Gateway (Messages
  API)](https://vercel.com/docs/ai-gateway/sdks-and-apis/anthropic-messages-api)
  and [Cloudflare AI
  Gateway](https://developers.cloudflare.com/ai-gateway/integrations/coding-agents/claude-code/).

### Streaming fidelity and prompt caching

What Claude Code requires of a gateway
([guide](https://code.claude.com/docs/en/llm-gateway-protocol)):

- Stream event by event and keep `ping` events.
- Forward `anthropic-beta`, `anthropic-version` and `cache_control` unchanged,
  as open lists.
- Keep the attribution block as the first `system` entry. It has been stable per
  conversation since v2.1.181, so gateway-side caches and other providers'
  prefix caches still work.

How the candidates measure up:

- **LiteLLM:**
  - Its `/anthropic` passthrough route forwards bodies and headers verbatim.
  - Its unified `/v1/messages` route rebuilds the request from an allowlist. It
    silently dropped `safeguards` until PR #42152, merged 2026-09-21 ([LiteLLM
    blog](https://docs.litellm.ai/blog/claude-code-server-side-auto-mode)).
  - Pre-call hooks have been reported as not firing on `/v1/messages`
    ([#27518](https://github.com/BerriAI/litellm/issues/27518),
    [#30469](https://github.com/BerriAI/litellm/issues/30469)). Current status
    **(unverified)**.
- **Bifrost and CCR:** neither documents raw passthrough or `cache_control`
  handling **(unverified)**.
- **Portkey (hosted):** needs `forward_headers: ["anthropic-beta"]`.
- **LiteLLM's March 2026 supply-chain incident:** PyPI releases 1.82.7 and
  1.82.8 carried a credential stealer. The official Docker image was not
  affected ([LiteLLM
  notice](https://docs.litellm.ai/blog/security-update-march-2026),
  [Datadog](https://securitylabs.datadoghq.com/articles/litellm-compromised-pypi-teampcp-supply-chain-campaign/)).

---

## B. TypeScript libraries

Versions, licences and unpacked sizes come from `npm view` on 2026-10-18.

| Library | Licence | Version / size | Providers | Structured output with zod | Tools | Prompt caching | Own loop / memory | Bun |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Vercel AI SDK** (`ai`, `@ai-sdk/*`) | Apache-2.0 ([LICENSE](https://raw.githubusercontent.com/vercel/ai/main/LICENSE)) | 7.0.143; 8.2 MB, 3 deps | `@ai-sdk/anthropic` (4.0.82, base URL settable), [`@ai-sdk/openai-compatible`](https://ai-sdk.dev/providers/openai-compatible-providers) (custom `fetch`, `transformRequestBody`), [`@openrouter/ai-sdk-provider`](https://github.com/OpenRouterTeam/ai-sdk-provider) 3.x for v7, community Ollama | `generateText`/`streamText` with `Output.object({schema})`; `generateObject` deprecated ([v6 guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-6-0)) | Yes; `ToolLoopAgent` | Anthropic `cacheControl` through `providerOptions`; OpenRouter `cache_control` | Loop yes; memory no. [Middleware](https://ai-sdk.dev/docs/ai-sdk-core/middleware) (`transformParams`, `wrapStream`, `defaultInstructionsMiddleware`); **no built-in fallback** | v7 needs Node 22 and ESM ([AI SDK 7](https://x.com/vercel/status/2070155382488764566)); Bun not listed **(unverified)** |
| **pi-ai / pi-agent-core** ([earendil-works/pi](https://github.com/earendil-works/pi)) | MIT; core promised to stay MIT | 1.3.0; pi-ai 4.2 MB, 10 deps | Anthropic, OpenAI, Google, OpenRouter, Z.ai, Moonshot, MiniMax, Qwen; any OpenAI-compatible server (Ollama, vLLM, LM Studio) | TypeBox, not zod; constrained sampling on some providers ([README](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)) | Yes | `sessionId` and `cacheRetention`; Anthropic `cache_control`; OpenAI `prompt_cache_key` | Agent loop in pi-agent-core; cross-provider handoffs; cost per message | Node 22.19+ stated; Bun **(unverified)** |
| [OpenAI Agents SDK JS](https://github.com/openai/openai-agents-js) | MIT | 0.20.0 | OpenAI natively; others through [`aisdk()`](https://openai.github.io/openai-agents-js/extensions/ai-sdk/) | zod | Yes; handoffs | Through the provider | Sessions | Bun listed |
| [Mastra](https://github.com/mastra-ai/mastra) | Apache-2.0 plus source-available `ee/` | `@mastra/core` 1.78.0; **76.7 MB**, 30 deps | 40+ through its model router | Yes **(unverified)** | Yes | n/a | Loop plus "Observational Memory" | **(unverified)** |
| [VoltAgent](https://github.com/VoltAgent/voltagent) | MIT | 2.11.0; 12.9 MB, 44 deps | AI SDK providers | zod | Yes | n/a | Memory adapters | **(unverified)** |
| LangChain.js / [LangGraph.js](https://github.com/langchain-ai/langgraphjs) | MIT | 1.5.18 / 1.5.1 | Broad | zod | Yes | Through the provider | `createAgent` with `summarizationMiddleware` ([v1](https://docs.langchain.com/oss/javascript/releases/langchain-v1)) | **(unverified)** |
| [token.js](https://github.com/token-js/token.js) | MIT | 0.7.1 | OpenAI-shaped; OpenRouter, any OpenAI-compatible | JSON mode | Some providers | n/a | No | n/a; last push 2026-07 |
| [multi-llm-ts](https://github.com/nbonamy/multi-llm-ts) | Conflicting: Apache-2.0 on GitHub, MIT in README | 5.1.2 | Ollama, OpenRouter and others | zod | Yes | n/a | No | n/a; 84 stars |
| [Genkit](https://github.com/firebase/genkit) | Apache-2.0 | 1.42.0 | Google, OpenAI, Anthropic, Ollama plugins | Yes | Yes | n/a | Flows | n/a |
| [Ax](https://github.com/ax-llm/ax) | Apache-2.0 | 25.4.2; 22 MB | 49 deployments plus OpenAI-compatible | Standard Schema (zod) | Yes | n/a | DSPy-style `AxAgent` | n/a |
| [`openai`](https://github.com/openai/openai-node) / [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript) | Apache-2.0 / MIT | 7.36.0 / 0.135.0 | Their own protocol, at any base URL | zod helpers | Yes | Native | No | Yes |

For comparison, `@anthropic-ai/claude-agent-sdk` 0.3.302 is licensed "SEE
LICENSE IN README" and spawns the proprietary Claude Code binary.

Two caveats on the AI SDK:

- `Output.object` parses free text on the client. `generateObject` asked the
  provider for JSON mode. One report measured 17 of 20 against 20 of 20
  successes ([#12491](https://github.com/vercel/ai/issues/12491)). That matters
  on open models without strict JSON schema.
- Many featherless models lack native tools (section C).

---

## C. Cheaper and more permissive model sources

**featherless.ai** ([pricing](https://featherless.ai/pricing),
[plans](https://featherless.ai/docs/plans))

| Plan | Price | Billing | Concurrency | Context | Allowed use |
| --- | --- | --- | --- | --- | --- |
| Chat | $25/month | Flat rate, unlimited requests | 4 units | 32K | Interactive, human-driven only; excludes app/API traffic and background automation |
| Developer | From $50/month | Prepaid credits, charged per token | 100 units | Up to 256K | API applications |
| Pay-as-you-go | Usage | Credits, charged per token | 100 units | Up to 256K | API applications |

- **Featherless is no longer flat-rate for API use.** The roadmap's "fallback to
  featherless" therefore means credits, or interactive use only.
- The API is OpenAI-compatible only. The [tool-calling
  doc](https://featherless.ai/docs/tool-calling), last edited Aug 2025, lists
  native tools only for Kimi-K2-Instruct and the Qwen 3 family. The catalogue
  now has a tool-use filter ([models
  API](https://featherless.ai/docs/api-reference-models)).
- "Prompts stored: Never."

**OpenRouter** ([FAQ](https://openrouter.ai/docs/faq))

- **Pricing:** provider prices passed through with no inference markup. A 5.5%
  fee applies to card credit purchases, with a $0.80 minimum.
- **BYOK:** free up to $25k a month of list-price usage, then a 5% fee.
- **Free models:** 50 requests a day, or 1,000 a day after buying $10 of
  credits.
- **Logging:** prompts are not logged by default.
- **Fallbacks:** a `models` array for model-level fallback,
  `provider.data_collection: "deny"` and `provider.zdr: true`
  ([routing](https://openrouter.ai/docs/guides/routing/provider-selection),
  [failover](https://openrouter.ai/blog/insights/reliability-failover/)).
- **Codex:** works through its Responses API (`wire_api = "responses"`)
  ([guide](https://www.morphllm.com/codex-provider-configuration)).

**Anthropic-compatible endpoints** (point Dorothy's gateway or Claude Code
straight at them)

| Provider | Base URL | Notes |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/anthropic` ([docs](https://api-docs.deepseek.com/guides/anthropic_api/)) | `deepseek-flash` (V4.1, 1M context) is $0.15 in / $0.60 out per M off-peak, $0.003 for cache hits. `deepseek-v4-pro` is $0.66 / $1.98. Peak hours double prices ([pricing](https://api-docs.deepseek.com/quick_start/pricing)). Data stored in China and used for training by default per third parties ([meetily](https://meetily.ai/llm-privacy/deepseek)) **(unverified against the primary policy)** |
| Moonshot Kimi | `https://api.moonshot.ai/anthropic` ([docs](https://platform.kimi.ai/docs/api/overview), [CC guide](https://platform.kimi.ai/docs/guide/claude-code-kimi)) | Kimi K3 at $3 / $15 per M, $0.30 cache hits ([Morph](https://www.morphllm.com/kimi-api)) **(unverified)**. The Kimi Code plan is limited to approved coding agents and personal development ([terms](https://www.kimi.com/code/docs/en/benefits.html)) |
| Z.ai GLM | Pay-as-you-go API; Coding Plan uses its own endpoints | Coding Plan "only within officially supported tools" ([policy](https://docs.z.ai/devpack/usage-policy), [FAQ](https://docs.z.ai/devpack/faq)). Reportedly bans role-play and general chat ([TorchTree](https://torchtree.com/en/post/zai-glm-coding-plan-policy-change/)) **(unverified)** |
| MiniMax | `https://api.minimax.io/anthropic` ([docs](https://platform.minimax.io/docs/guides/text-ai-coding-tools)) | The M Plan is for "individual, interactive" use; production should use pay-as-you-go ([FAQ](https://platform.minimax.io/docs/m-plan/faq)) |
| Qwen (Model Studio) | `https://dashscope-intl.aliyuncs.com/apps/anthropic` ([QwenCloud](https://docs.qwencloud.com/api-reference/chat/anthropic), [Alibaba](https://www.alibabacloud.com/help/en/model-studio/claude-code)) | The Coding Plan forbids "automated scripts, application backends" ([coding plan](https://www.alibabacloud.com/help/en/model-studio/coding-plan)) |

**Local serving** (all speak Anthropic `/v1/messages`)

- **llama.cpp `llama-server`:** has `/v1/messages` and `count_tokens`,
  streaming, tools with `--jinja`, and thinking ([HF
  blog](https://huggingface.co/blog/ggml-org/anthropic-messages-api-in-llamacpp)).
- **vLLM:** has `/v1/messages` and `count_tokens`
  ([docs](https://docs.vllm.ai/en/stable/serving/online_serving/)). Claude Code
  2.1.154 and later broke validation on vLLM 0.20.1
  ([#44000](https://github.com/vllm-project/vllm/issues/44000)).
- **LM Studio 0.4.1+:** has `/v1/messages`. Its docs recommend
  `CLAUDE_CODE_ATTRIBUTION_HEADER=0`
  ([docs](https://lmstudio.ai/docs/integrations/claude-code)).
- **Ollama 0.14+:** `/v1/messages`, with no `count_tokens`
  ([guide](https://renezander.com/guides/claude-code-local-llm-anthropic-base-url/)).
  Official doc page not retrieved **(unverified)**.
- All of them also serve OpenAI chat completions. Local serving has no content
  policy and no retention beyond your own machine.

### Clients

- **Codex CLI** now accepts only `wire_api = "responses"`. Chat support was
  removed in early Feb 2026 (codex discussion #7782;
  [DEV](https://dev.to/milkyway008/codex-cli-bricks-every-command-after-an-update-the-wireapi-config-trap-3d9n)).
  A Dorothy OpenAI adapter for Codex must therefore speak the Responses API,
  with the persona in `instructions`.
- **OpenCode** ([MIT](https://github.com/anomalyco/opencode)) runs on the AI
  SDK. Any provider's `baseURL` can be overridden
  ([docs](https://opencode.ai/docs/providers/)).
- **OpenAI's "Sign in with ChatGPT":** since 2026-09-29, subscription usage is
  allowed in open-source and local personal projects ([New
  Stack](https://thenewstack.io/sign-in-with-chatgpt/)). This is a permissive
  subscription route, but not an open-weights one. pi-ai already implements it.

---

## D. Anthropic policy (Oct 2026)

### Consumer Terms §3.7

- It has barred automated access except by API key since at least Feb 2024.
  Anthropic's Feb 2026 documentation update explicitly named the Agent SDK as an
  unauthorised use of subscription OAuth tokens ([The
  Register](https://www.theregister.com/software/2026/02/20/anthropic-clarifies-ban-on-third-party-tool-access-to-claude/5014546)).

**Current [legal and compliance
page](https://code.claude.com/docs/en/legal-and-compliance), fetched today**

- OAuth is "intended exclusively for purchasers of Claude Free, Pro, Max, Team,
  and Enterprise subscription plans and is designed to support ordinary use of
  Claude Code and other native Anthropic applications."
- "Developers building products or services that interact with Claude's
  capabilities, including those using the Agent SDK, should use API key
  authentication."
- Anthropic does not permit routing "requests through Free, Pro, or Max plan
  credentials on behalf of their users."
- "Advertised usage limits for Pro and Max plans assume ordinary, individual
  usage of Claude Code and the Agent SDK."
- Anthropic "may \[enforce\] without prior notice."
- The explicit February sentence calling Agent SDK use "a violation" no longer
  appears. A personal, unshared Agent SDK app on `CLAUDE_CODE_OAUTH_TOKEN`,
  which is what Dorothy does today, is **not explicitly permitted**.

### Third-party harnesses

- From 2026-04-04, subscriptions no longer cover third-party harnesses. Such use
  needs extra usage or an API key ([Boris
  Cherny](https://x.com/bcherny/status/2040206440556826908)).

### Gateways

- Setting `ANTHROPIC_BASE_URL` without a gateway credential keeps the claude.ai
  login active, along with its limits and billing. This is documented behaviour,
  and is how `dorothy --claude` works.
- Anthropic "doesn't support routing Claude Code to non-Claude models through
  any gateway" ([LLM gateways](https://code.claude.com/docs/en/llm-gateway)).

### Limits

- Pro and Max have a 5-hour session limit and a weekly limit, shared across
  Claude and Claude Code. Max adds a separate weekly limit for Fable
  ([support](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)).
- Reported weekly-limit changes in Sept and Oct 2026 come only from third
  parties ([growthcab](https://www.growthcab.com/claude-max-usage-limits))
  **(unverified)**.

### Max API credits

- Since 2026-10-07, Max 5x gets $100 and Max 20x $200 a month in API credits.
- They cover the "Claude API … Claude Agent SDK", not Claude Code, and expire
  each billing cycle
  ([docs](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers)).
- Switching `packages/agent` to an API key would put Dorothy's own calls on
  clean terms without leaving Anthropic.

---

## Mapping Dorothy to candidates

| Dorothy part | Best candidate | Fit | What is lost | Effort |
| --- | --- | --- | --- | --- |
| **Gateway: marker rewrite for Claude Code** | Keep `packages/gateway`; point `ANTHROPIC_BASE_URL` at DeepSeek, Kimi, MiniMax, Qwen, OpenRouter or local servers | Full (it is already provider-neutral on the Anthropic protocol) | Claude-only features: advisor tool, `safeguards` auto mode; fast mode and WebFetch checks call api.anthropic.com. Non-Anthropic upstreams receive the attribution block (stable, so caches survive) | Hours: model mapping (`ANTHROPIC_DEFAULT_*_MODEL`), context window overrides |
| Gateway replaced by LiteLLM, Bifrost, CCR or agentgateway | LiteLLM hook, Bifrost `PreLLMHook`, agentgateway `prepend` | Partial | Marker-based additive rewrite and drift stats; byte fidelity (parse and re-serialise, allowlists); prepend defeats the positional attribution strip; hook-firing bugs on `/v1/messages` | Medium, and it adds a service |
| **OpenAI-protocol gateway** (Codex, OpenCode) | Own adapter beside `anthropic.ts`: Responses `instructions` and chat `system`; upstream OpenRouter `/api/v1` or LiteLLM/Bifrost `/responses` | Partial; nobody else does it additively | n/a | Medium |
| **Agent wrapper** (`Conversation`, `runOneShot`) | AI SDK 7 `streamText` behind a provider contract in `core`; runner-up pi-ai | Full | Claude Code's injected identity line and per-turn system messages (a gain); subscription billing; Agent SDK's MCP plumbing for recall (rebuild as AI SDK tools) | Medium: Dorothy must own the message history, which `withHistory` and transcripts already hold |
| **Structured calls** (zod, reviews, compaction) | AI SDK `Output.object` (zod v4); `@ai-sdk/anthropic` keeps strict schemas on Anthropic-compatible endpoints | Full on strong models; partial on featherless (prompted JSON, retries) | Server-enforced `json_schema` on weaker providers | Small |
| **Capture / `--dump-context`** | Custom `fetch` on the AI SDK provider, or keep `captureServer` as the base URL | Full | Nothing | Small |
| **Per-role routing** | AI SDK `createProviderRegistry` with `config.toml` roles | Full | n/a | Small |
| **Fallback when usage runs out** | OpenRouter `models` array; or a small in-process try-next loop (the AI SDK has no fallback middleware); gateway-side LiteLLM or Bifrost for Claude Code | Full (in-process) / Partial (gateway) | Retry semantics Claude Code relies on (`retry-after`, error bodies) if the gateway wraps errors | Small to medium |
| **Token budgets** | In-process accounting from `usage` (pi-ai and OpenRouter return cost); LiteLLM or Bifrost virtual-key budgets if a service is acceptable | Full / Partial | LiteLLM budgets need Postgres | Small to medium |

**Prompt-cache stability** carries over. Dorothy's fixed per-launch section is
exactly what the automatic prefix caches at DeepSeek, Kimi, OpenAI and llama.cpp
reward. Explicit `cache_control` survives only on Anthropic-protocol upstreams
that honour it, and only if forwarded unchanged.

---

## Recommended stack for a provider-neutral Dorothy

1. **Model side:** a provider contract in `core`, implemented in
   `packages/agent` on **AI SDK 7**:
   - `@ai-sdk/anthropic` with `baseURL`, which covers Anthropic, DeepSeek, Kimi,
     MiniMax, Qwen and local servers;
   - `@ai-sdk/openai-compatible` for featherless, vLLM and llama.cpp;
   - `@openrouter/ai-sdk-provider` for fallback and free models.

   Keep SDK types at the edge, as the root `AGENTS.md` requires. zod stays. Drop
   `@anthropic-ai/claude-agent-sdk` and the private CLI home. If the owner
   prefers a smaller, opinionated runtime with built-in cost catalogues and
   cross-provider handoff, **pi-ai** is the alternative, at the price of TypeBox
   and an Earendil-owned project.
2. **Gateway:** keep `packages/gateway` as the persona and memory injector. Make
   the upstream per-role and configurable, and add the OpenAI Responses and chat
   adapter for Codex and OpenCode. Do not adopt a third-party gateway as the
   injector.
3. **Fallback and routing:**
   - Start with **OpenRouter** as the universal fallback upstream, with
     `data_collection: "deny"`.
   - Add **Bifrost** (Go, Apache-2.0, budgets in open source, documented for
     Claude Code, Codex and OpenCode) or **LiteLLM** (broadest; pin the Docker
     image) behind Dorothy's gateway only if self-hosted translation and
     fallback for OpenAI-only upstreams is needed. agentgateway is the Rust
     single-binary alternative.
4. **Models:**
   - Chat on pay-as-you-go open-weights APIs: DeepSeek V4.x, Kimi K3, GLM, Qwen.
     Pick per data-policy tolerance; data residency and training terms differ by
     vendor.
   - Background reviews and compaction on `deepseek-flash`-class models or a
     local llama.cpp or vLLM server.
   - Avoid coding plans and featherless's $25 Chat plan for Dorothy's own calls.
5. **If Anthropic stays in the mix:** move `packages/agent` to an API key funded
   by the Max plan's monthly credits rather than `CLAUDE_CODE_OAUTH_TOKEN`.

### Not verified

- Bun compatibility of AI SDK 7, pi-ai, Mastra and VoltAgent: none lists Bun,
  and I did not run them.
- Whether CCR v3 can inject a system section.
- Whether Portkey's open-source gateway serves `/v1/messages`.
- Kong's open-source freeze.
- DeepSeek's primary privacy policy text.
- Kimi K3 pricing.
- The third-party reports of weekly-limit changes.

Scratch file: `/tmp/research-pi/pi-ai-readme.md`, the downloaded pi-ai README,
read only with grep and sed.
