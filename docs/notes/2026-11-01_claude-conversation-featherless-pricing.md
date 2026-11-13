---
ctime: 2026-11-01
mtime: 2026-11-01
spdx: GPL-3.0-only
title: "Conversation with Claude: Featherless AI Pricing Options"
description: >-
  Exported Claude conversation regarding pricing options offered by
  https://featherless.ai with respect to subscription and pay-as-you-go
tags:
  - claude
  - llm
  - featherless
  - pricing
  - api
---

<!--
   -
   - ~xxdorothy/dorothy.git
   - ::: :/docs/notes/2026-11-01_claude-conversation-featherless-pricing.md
   -
   -->

# Conversation with Claude: Featherless AI Pricing Options

## chewygumxx Prompt 1

I'm interested in the models <https://featherless.ai> offers however the plans
they offer seem somewhat odd. I would ideally prefer what the developer plan is
offering but without the whole $50/month subscription. Something akin to the
conventional prepaid credits for an API key that I already do with Anthropic,
Hugging Face, OpenAI and OpenRouter.

Is this possible? Could I potentially be misinterpreting Featherless pricing?

---

## Claude Response 1

I'll check Featherless's current pricing and terms to see whether a
pay-as-you-go option exists.

### Short answer

You're partly misreading it, but your instinct is also right. The Developer
plan already _is_ conventional prepaid per-token credit; the $50 isn't a fee on
top of usage, it's $50 of balance. What makes it unusual is the automatic $50
monthly recharge attached to it. There are a few ways around that.

### What the Developer plan actually is

- **It's a credit balance, not a fee.** You pick a monthly credit amount
  (minimum $50), API usage is charged per token against that balance, and
  leftover credit rolls over without ever expiring.
- **Billing works like OpenRouter.** Failed requests are free, and each call
  costs input tokens times the input rate plus output tokens times the output
  rate, priced per million tokens.
- **One-off top-ups exist.** The pricing comparison table lists one-time
  top-ups as supported on Developer, with no commitment.

So it's effectively an OpenRouter-style wallet with a mandatory $50/month
auto-reload attached. The $25 Chat plan isn't a cheaper loophole either: it
excludes app and API traffic, background automation and benchmarking.

### Routes to true pay-as-you-go

#### 1. Featherless's own (barely advertised) Pay-As-You-Go tier

Their Plans documentation lists a separate Pay-As-You-Go plan with no monthly
commitment, where you add credits whenever you need them, with the same 100
concurrent units and 256K context as Developer. However, it doesn't appear on
the public pricing page, and unlike Developer it has no subscribe link in the
docs table. It's likely gated or still rolling out. I'd ask in their Discord or
email support whether you can be moved onto it.

#### 2. Buy one Developer cycle, then cancel

The cancellation rules make this work as a one-time purchase:

- Cancelling takes effect at the end of the billing period, after which monthly
  top-ups stop, your org drops to a free Developer base, and existing credits
  stay usable until spent.
- Once the balance hits zero, calls are blocked unless you restart request
  pricing or add more credits, and the billing page lets eligible
  request-pricing orgs add one-time credits with the saved card.

So you can pay $50 once, cancel straight away, and keep a non-expiring $50
balance. The catch is that the docs don't say whether a cancelled org still
counts as "eligible" for later one-off top-ups. Confirm that with support
before relying on it. Also, $50 is a steeper entry point than the $5 to $10
most providers ask for.

#### 3. Route through Hugging Face (closest to what you already do)

This is probably your best fit, since you already have HF credits.

- **No Featherless account needed.** If no Featherless key is configured,
  requests route through Hugging Face using your HF token and are billed to
  your HF account at standard provider rates.
- **Prepaid credits, no subscription.** Hugging Face passes provider costs
  through with no markup, free users can buy credits, and PRO accounts get $2
  of monthly compute credit.
- **Simple model addressing.** You append `:featherless-ai` to the model ID
  when calling the HF router.

The trade-off is catalogue coverage. Only models that are warm on Featherless
and carry the right Hub metadata get synced to Hugging Face, via an hourly
process. Featherless's page cites 5,000+ models, but it was last edited in
mid-2025. Either way, expect a subset of the 40,000+, and HF-routed traffic may
not get Developer-tier concurrency or priority.

#### What about OpenRouter?

Not a real option. OpenRouter only ever listed one Featherless-served model,
Qrwkv 72B, and that slug has since been reported as returning no endpoints.

### Side by side

| Route                  | Upfront                   | Recurring charge       | Catalogue     | Certainty                                   |
| ---------------------- | ------------------------- | ---------------------- | ------------- | ------------------------------------------- |
| Featherless PAYG tier  | Whatever you top up       | None                   | Full          | Documented, but no visible signup           |
| Developer, then cancel | $50                       | None after cancelling  | Full          | Top-up eligibility after cancelling unclear |
| Hugging Face routing   | Whatever you top up on HF | None (PRO optional)    | Synced subset | High                                        |
| Developer, kept active | $50                       | $50/month (rolls over) | Full          | High                                        |

### Relevant convention

Both Featherless and the HF router implement the **OpenAI Chat Completions
API**, the de facto standard for LLM endpoints. Switching between direct
Featherless and HF-routed access only changes the base URL, key and model ID:

```python
import os
from openai import OpenAI

# Direct to Featherless (needs a Featherless key with credit)
featherless = OpenAI(
    base_url="https://api.featherless.ai/v1",
    api_key=os.environ["FEATHERLESS_API_KEY"],
)

# Routed through Hugging Face, billed to your HF credit balance
hf = OpenAI(
    base_url="https://router.huggingface.co/v1",
    api_key=os.environ["HF_TOKEN"],
)

response = hf.chat.completions.create(
    model="zai-org/GLM-5.3:featherless-ai",
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.choices[0].message.content)
```

### Suggested path

1. Start with Hugging Face routing using your existing HF credits.
2. If a model you want isn't synced to HF, ask Featherless support about the
   Pay-As-You-Go tier.
3. If that tier isn't available, fall back to buying one Developer cycle and
   cancelling.

Sources:

- [Pricing | Featherless](https://featherless.ai/pricing)
- [Developer and Credits | Featherless Docs](https://featherless.ai/docs/request-pricing-and-credits)
- [Plans | Featherless Docs](https://featherless.ai/docs/plans)
- [Hugging Face | Featherless Docs](https://featherless.ai/docs/hugging-face)
- [Pricing and Billing | Hugging Face Inference Providers](https://huggingface.co/docs/inference-providers/pricing)
- [Featherless AI | Hugging Face Inference Providers](https://huggingface.co/docs/inference-providers/providers/featherless-ai)
- [Featherless on OpenRouter](https://openrouter.ai/featherless)
- [models.dev issue #1248](https://github.com/anomalyco/models.dev/issues/1248)

---

## chewygumxx Prompt 2

While Hugging Face seems to be the route with the least friction, it does seem
to surrender the valued minimal logging of requests and access to abliterated
models. The buy one developer cycle, then cancel, seems precarious.
Featherless's own Pay-As-You-Go is obviously most ideal but their own web
portal for managing account plan certainly doesn't seem helpful.

[Attached Image of Featherless AI Account Web Portal Plan Page](./2026-11-01_claude-conversation-featherless-pricing/featherless-ai-web-portal-plan-page.png)

---

## Claude Response 2

Good points, and the screenshot confirms the portal shows no Pay-As-You-Go
option. Let me check two things: whether your Hugging Face concerns hold up,
and whether Featherless has said anything public about the PAYG tier.

<!-- NOTE(@chewygumxx):
   - I haven't omitted any descriptive metadata framing such as subheading or
   - preamble. Claude simply provided the following within a unique email
   - presentation widget at this position.
   -->

```text
Subject: Moving to the Pay-As-You-Go plan (no monthly commitment)

Hi Featherless team,

Your Plans documentation lists a Pay-As-You-Go plan alongside Developer, described as having no monthly commitment, with credits added whenever needed. However, the Plan page in my account only offers Chat, Developer and Business, so I can't find a way to select it.

Could you help with the following?

1. Is the Pay-As-You-Go plan currently available, and if so, can my organization be moved onto it?

2. If it isn't available yet: if I subscribe to Developer at $50 and cancel before renewal, will my organization still be able to buy one-time credit top-ups from the billing page afterwards, without restarting the monthly subscription?

3. While on the post-cancellation "free Developer base" with credit remaining, do the 256K context, 100 concurrent units and full catalogue access (including abliterated models) still apply?

I'm happy to prepay. I'd just prefer to top up on demand rather than commit to a recurring monthly amount, similar to how other API providers handle credits.

Thanks!
```

### Your Hugging Face concerns, checked

Both concerns are weaker than they look, though not baseless.

- **Logging.** Hugging Face states it doesn't store request or response bodies
  when routing to providers, and keeps debugging logs for up to 30 days without
  user data or tokens. Featherless itself never stores prompts on any plan. So
  you don't lose no-logging outright. What you add is a second party that sees
  your traffic in transit and keeps metadata. Whether that's acceptable is your
  call.
- **Abliterated models.** The Hub currently lists 6,707 models served by
  Featherless, and abliterated ones are among the trending results, for example
  `huihui-ai/Huihui-Qwen3.8-27B-abliterated` and
  `OBLITERATUS/Qwen3.8-27B-OBLITERATED`. The real gap is breadth (roughly 6.7k
  versus 40k+), not abliterated models as a category. If the specific models you
  want are in that list, HF routing still works.

### The Pay-As-You-Go tier

Your screenshot matches what I can see publicly. The Plans documentation is the
only place the tier appears. I found no announcement, changelog entry or signup
link for it, and the docs table links only the Developer plan to a subscribe
page.

My guess is that Pay-As-You-Go may simply be the "free Developer base" an
organization drops to after cancelling Developer, since both are described as
credits without a recurring charge. That is unconfirmed.

### Why "buy one cycle, then cancel" is less risky than it looks

The downside is bounded:

- **You can't lose the $50.** After cancelling, existing credits stay usable
  until spent, and credits never expire.
- **The only unknown is future top-ups.** Docs say one-time credits can be
  added by "eligible" request-pricing organizations, without defining eligible.
  If a cancelled org doesn't qualify, the fallback is subscribing for one more
  cycle and cancelling again. That effectively makes it pay-as-you-go in $50
  chunks, which is clunky but not a trap.
- **One practical caution.** Plans renew monthly by default, so cancel right
  after subscribing. Cancellation only takes effect at the end of the paid
  period, so you keep full access until then.

### Suggested next step

Send the draft above to Featherless support (email, or their Discord). It asks
three things in one go: whether the PAYG tier is available, whether top-ups
still work after cancelling Developer, and whether the free Developer base
keeps the 256K context and full catalogue. A "yes" to either of the first two
settles it. Meanwhile, you can check whether your must-have models are in the
HF list, so you know how good your fallback is.

### Sources

- [Security & Compliance | Hugging Face Inference Providers](https://huggingface.co/docs/inference-providers/security)
- [Models available on Featherless AI | Hugging Face](https://huggingface.co/models?inference_provider=featherless-ai&sort=trending)
- [Plans | Featherless Docs](https://featherless.ai/docs/plans)
- [Developer and Credits | Featherless Docs](https://featherless.ai/docs/request-pricing-and-credits)
- [Billing & Payment Methods | Featherless Docs](https://featherless.ai/docs/billing)
- [Pricing | Featherless](https://featherless.ai/pricing)

<!-- vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3: -->
