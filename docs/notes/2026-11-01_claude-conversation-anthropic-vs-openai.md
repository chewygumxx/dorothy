---
ctime: 2026-11-01
mtime: 2026-11-02
spdx: GPL-3.0-only
title: "Conversation with Claude: Anthropic vs OpenAI"
description: >-
  Exported Claude conversation regarding policy differences between
  Anthropic and OpenAI provided inference APIs.
tags:
  - claude
  - llm
  - anthropic
  - openai
  - featherless
  - api
---

<!--
   -
   - ~chewygumxx/dorothy.git
   - ::: :/docs/notes/2026-11-01_claude-conversation-anthropic-vs-openai.md
   -
   -->

# Conversation with Claude: Anthropic vs OpenAI

## chewygumxx Prompt 1

Anthropic's Messages API is almost everything I could possibly want. It is
however, apparently less aligned with open source ideology than I'd hope, and
has rather prudish limitations with respect to NSFW content than I'd agree
with.

That pushes me toward OpenAI doesn't it?

---

## Claude Response 1

### Short answer

Not really. OpenAI edges out Anthropic on one of your two axes, and on the
other it's less different than its reputation suggests. The option that
actually satisfies both values is **open-weight models**, and you can reach
most of them without giving up the Messages API shape. (I'm Claude, so weigh my
take accordingly.)

### On open source

OpenAI does have something real here: in August 2025 it released two
open-weight models, gpt-oss-120b and gpt-oss-20b, under the permissive Apache
2.0 license, suitable for experimentation, customisation, or commercial
deployment. Anthropic has no equivalent weights release. OpenAI also handed its
Open Responses spec to the Agentic AI Foundation, the Linux Foundation body
that also looks after MCP (MCP being Anthropic's contribution to that same
body).

The catch: the models you would actually call through OpenAI's API are just as
closed as Claude. Moving your API spend from one closed frontier lab to another
doesn't make your stack more open. If the ideology is the point, the labs that
consistently ship weights are Mistral, Qwen, DeepSeek, Kimi and GLM. For
example, Mistral Large 3 is a 675B MoE with 41B active parameters and a 256K
context, licensed Apache 2.0.

### On NSFW content

OpenAI's hosted stance is closer to Anthropic's than you might expect:

- **OpenAI API:** By default it doesn't permit explicit sexual content;
  operators may enable adult content for appropriate platforms with appropriate
  safeguards, but the policy doesn't detail what the eligibility criteria are
  for unlocking it. My read (not a stated rule) is that a personal project isn't
  what that carve-out is aimed at.
- **ChatGPT:** The adult mode has been put on hold indefinitely, per the
  Financial Times, with OpenAI saying it wants long-term research on the
  effects of sexually explicit chats and emotional attachment before proceeding.
- **Anthropic:** Prohibits explicit content without exceptions.
- **xAI:** As of mid 2026, the only major US lab whose published policy permits
  mature themes in clearly fictional works, though its AUP explicitly bans
  depicting likenesses of persons in a pornographic manner.

Where the restriction genuinely disappears is self-hosted open weights. Apache
2.0 carries no usage policy, so your constraints become the law, the model's
training, and your VRAM. gpt-oss-20b, for instance, can run within 16GB of
memory thanks to MXFP4 quantization. Note that third-party hosts serving open
weights each impose their own AUPs, so "open model" doesn't automatically mean
"unrestricted endpoint."

### You don't have to give up the Messages API

This is the part that makes the decision easy. Besides Anthropic, 12 of 20
surveyed providers document an Anthropic-compatible Messages endpoint:
DeepSeek, Moonshot AI (Kimi), Z.ai (GLM), MiniMax, Alibaba Cloud Model Studio
(Qwen), Fireworks AI, OpenRouter, Ollama, LM Studio, vLLM, and Amazon. So a
client written against the Messages shape can talk to a local model by swapping
the base URL:

```ts
import Anthropic from "@anthropic-ai/sdk";

const providers = {
  claude: new Anthropic(),
  local: new Anthropic({
    baseURL: "http://localhost:11434", // Ollama
    authToken: "ollama", // required, ignored
  }),
};
```

Expect partial compatibility: Claude-specific features (prompt caching,
extended thinking, citations, server tools) usually won't carry over, so keep
your core path to plain messages and tool calls.

### What this means for the cyber clone

It largely dissolves the "Messages API vs OpenRouter" question for its provider
layer. Treat it as a router, not a vendor choice:

- **Claude** for code composition and research, where you already find it
  nearly ideal.
- **An open-weight model** (local via Ollama/vLLM, or hosted) for whatever
  Claude declines, selected per task.
- **One canonical internal format.** Messages is a defensible choice given how
  many endpoints now speak it, with OpenRouter as an aggregator for breadth.

### Relevant specifications

- **OpenAI Chat Completions:** the de facto lingua franca; virtually every
  provider and local server implements it.
- **Open Responses:** an open, vendor-neutral specification for LLM APIs
  defining a shared schema, consistent streaming events, and extensible
  tooling, based on OpenAI's Responses API. Backers include Vercel, OpenRouter,
  Hugging Face, LM Studio, Ollama, vLLM and others, but Anthropic and Google are
  not on board for now.
- **Anthropic Messages:** not a formal standard, but now widely cloned, as
  above.

Sources:

- [OpenAI gpt-oss release (iThome)](https://www.ithome.com.tw/news/170433)
- [OpenAI Usage Policies: sexual and adult content (ConductAtlas)](https://conductatlas.com/platform/openai/openai-usage-policies/restrictions-on-sexual-and-adult-content/)
- [OpenAI operator-unlockable behaviours (ConductAtlas)](https://conductatlas.com/platform/openai/openai-usage-policies/operator-unlockable-default-off-behaviors/)
- [OpenAI just nixed ChatGPT's adult mode (PCWorld)](https://www.pcworld.com/article/3099680/openai-just-nixed-chatgpt-erotic-adult-mode.html)
- [OpenAI no longer working on adult mode (Thurrott)](https://www.thurrott.com/a-i/334240/openai-is-no-longer-working-on-adult-mode-for-chatgpt)
- [AI content policies compared (apisrouter)](https://apisrouter.com/it/ai-content-policies-compared)
- [Grok/xAI NSFW policy (Atlas Cloud)](https://www.atlascloud.ai/blog/guides/grok-xai-nsfw-image-generation-policy)
- [Mistral AI in 2026](https://aiidelist.com/blog/mistral-ai-2026.md)
- [API compatibility reference (Developers Digest)](https://www.developersdigest.tech/reference/api-compatibility)
- [Open Responses](https://openresponses.org/)
- [Open Responses and the Agentic AI Foundation (i-SCOOP)](https://www.i-scoop.eu/open-responses/)

---

## chewygumxx Prompt 2

I'm so sick of paternalist model providers. Why must open source be so slow to
compete with proprietary models whose development is so extraordinarily well
funded.

I don't have a spare beefy GPU on hand. Is HuggingFace/Featherless my next best
option for tasks that are beyond the policy of Anthropic>

---

## Claude Response 2

### Why open models trail (and by how much)

The gap is smaller than it feels: since January 2026, the best open-weight
models have trailed frontier closed models by about four months on average,
with the gap widening slightly since October 2025. It persists for structural
reasons more than a lack of talent:

- **Money buys the frontier, and open weights don't pay it back.**
  Frontier-scale open releases mostly come from companies with strategic
  reasons to give weights away (Alibaba, DeepSeek, Moonshot, Zhipu, Mistral),
  not community budgets. Nobody spends frontier money purely to give the result
  away.
- **Post-training is the real moat.** Pretraining recipes are well understood.
  Large RL environments, preference data and eval pipelines are expensive,
  proprietary, and rarely published.
- **Fast followers stay behind by construction.** Reproducing a known
  capability is far cheaper than discovering it, which keeps open models close,
  but always a step back.

The upside: four months behind today's frontier beats anything that existed a
year ago, and for creative or explicit writing the gap matters much less than
it does for long agentic coding runs.

On the paternalism: some of it is ideology, but hosted providers also face
liability, payment processors, app stores and regulators. That's why even
independent hosts end up with similar clauses. The durable fix is controlling
the inference layer, not finding a nicer vendor.

### Featherless: yes, for this lane

Featherless fits this use better than Hugging Face:

- **Pricing:** It charges a flat monthly subscription with unlimited tokens
  rather than billing per token. There are two consumer tiers, Basic at $10 a
  month and Pro at $25. Basic caps you at models up to 15B, 2 concurrent
  connections and 16K context; the higher tier removes the size limit.
- **Logging:** They say they don't log your chats, prompts, or completions.
- **Terms:** The ToS acknowledges that models served there may generate content
  unsuitable for minors, and puts you solely responsible for complying with
  each model's own terms. That last part matters; see the weights section below.
- **API:** It serves open-weight models from the Hugging Face catalog behind an
  OpenAI-compatible REST API, so your router needs a Chat Completions adapter
  alongside the Messages one.

The main costs are concurrency caps and tier limits on size and context.

### Why Hugging Face ranks lower

Inference Providers is a router, not a host:

- **Credits are tiny.** PRO costs $9 a month and includes $2 of Inference
  Provider credits.
- **It's a catalog, not a policy escape.** HF adds no markup over partner
  rates, but the partner actually serving your request applies its own rules.
  For example, Together's terms bar content that is vulgar, obscene, or
  otherwise objectionable.
- **Dedicated Endpoints exist but cost more.** Their GPU rates are above what
  raw cloud rental charges for the same card.

### Full control: rent a GPU by the second

This is the closest thing to owning the hardware:

- **Pods:** RunPod rents an H100 80GB from $1.99/hr on demand, billed per
  second.
- **Serverless:** Flex workers scale to zero. Hourly rates are about $1.10 for
  an RTX 4090 and $4.79 for an H100. The catch is that cold starts of 30 to 60
  seconds are billed.
- **API:** RunPod wraps vLLM with an OpenAI-compatible API, so it slots into
  the same adapter as Featherless.

Use this when you want a specific checkpoint Featherless lacks, long context,
or nobody's rules in the loop except the host's terms and the model licence.

### Choose the weights carefully

- **Licence:** Apache 2.0 and MIT models (Qwen, Mistral, DeepSeek, GLM) carry
  no use policy. Some others attach their own acceptable-use terms (Gemma's
  terms and Llama's community licence, for example), and Featherless's ToS makes
  those binding on you.
- **Training:** A permissive licence doesn't mean a willing model. gpt-oss is
  Apache 2.0 but heavily safety-tuned, so it refuses much of what its licence
  allows. Creative and roleplay fine-tunes, and "abliterated" variants with the
  refusal behaviour removed, trade some capability for willingness. Test them on
  your actual tasks before committing.

### At a glance

| Option                     | Billing                 | Content limits set by            | Best for                          |
| -------------------------- | ----------------------- | -------------------------------- | --------------------------------- |
| **Featherless**            | Flat monthly            | Model licences + Featherless ToS | Default out-of-policy lane        |
| **HF Inference Providers** | Per token, pass-through | Whichever partner serves it      | Quick trials, not policy escape   |
| **RunPod serverless**      | Per second              | Host ToS + model licence         | Specific weights, maximum control |

For the cyber clone, that suggests three lanes: Claude through Messages for
code and research, Featherless as the flat-rate lane for anything beyond
Anthropic's policy, and RunPod serverless as the escape hatch. Featherless and
RunPod both speak OpenAI Chat Completions, the de facto common denominator, so
one adapter covers both.

Sources:

- [Open models lag state-of-the-art closed models by 4 months (Epoch AI)](https://epoch.ai/data-insights/open-closed-eci-gap)
- [The Epoch Brief, June 1, 2026](https://epochai.substack.com/p/the-epoch-brief-june-1-2026)
- [Featherless docs](https://featherless.ai/docs)
- [Featherless Terms of Service](https://featherless.ai/terms)
- [Featherless plans (APIs.io)](https://apis.io/plans/featherless/featherless-plans-pricing/)
- [Featherless (AI Chief)](https://aichief.com/ai-text-tools/featherless-ai/)
- [Featherless provider profile (APIs.io)](https://apis.io/providers/featherless/)
- [Hugging Face pricing explained (eesel)](https://www.eesel.ai/en/blog/hugging-face-pricing)
- [Hugging Face provider overview (ComputePrices)](https://computeprices.com/providers/hugging-face)
- [Together AI prohibited uses (ConductAtlas)](https://conductatlas.com/platform/together-ai/together-ai-terms-of-service/prohibited-uses-and-content-restrictions/)
- [RunPod pricing](https://www.runpod.io/gpu-cloud/pricing)
- [RunPod vs Vast.ai for open-weight LLMs (LLM Configurator)](https://llmconfigurator.com/en/blog/runpod-vs-vast-ai-for-llms)
- [RunPod pricing (Costbench)](https://costbench.com/software/ai-gpu-cloud/runpod/)
- [RunPod review (ChatForest)](https://chatforest.com/reviews/runpod-gpu-cloud-serverless-ai/)

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
