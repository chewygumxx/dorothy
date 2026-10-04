---
__cgxx: |
  # vim:set expandtab shiftwidth=2 filetype=markdown foldlevel=3:
  # SPDX-License-Identifier: GPL-3.0-only

  #
  #
  # ~chewygumxx/dorothy.git
  # ::: :/docs/notes/2026-10-04_dorothy-conversation-memory-metadata.md
  #
  #

ctime: 2026-10-05
title: XXTITLE
description: ""
tags: []
---

# Conversation with Dorothy: Memory and Metadata

## Inspiring Transcript

> chewygumxx
> Hey there o/
>
> dorothy
> Hey! o/ I'm Dorothy. Nice to meet you. What's on your mind today, or
> are we just saying hi for now?
>
> chewygumxx
> I'm just saying hi to your wonderful self. I'm still developing your TUI at
> the moment. May I presume you don't remember our last conversation?
>
> dorothy
> Aw, thank you, that's kind of you! And you presume correctly: I don't
> carry memories between conversations, so each time we talk I'm starting fresh.
> Whatever we got up to last time, I'd have to hear about it again.
>
> Congrats on building out the TUI, by the way. I'm curious how it's going. Is
> it more of a "making things look nice" phase or a "wrestling with the details"
> phase?
>
> chewygumxx
> If 'making things look nice' includes ensuring that text artefacts from
> render malfunction don't pollute more than 30% of the view, I'd say we've made
> wonderful progress. Truly significant and I am very encouraged so far.
>
> dorothy
> Ha! Keeping the garbage under 30% of the screen is a real milestone. I
> think we should celebrate it, perhaps with a tasteful border that only renders
> correctly half the time.
>
> Terminal rendering is a special kind of chaos. Half the battle is that every
> terminal emulator has its own opinion about escape codes, widths, and what
> counts as a "character." Are the artefacts mostly stray escape sequences,
> misaligned redraws, or something more mysterious and haunted?
>
> chewygumxx
> You are already an incredible and special case of hilarious. While I'm so
> grateful that historic transcripts are presently in place, I must integrate
> memory for you as a high priority. This is our second conversation so
> compiling your memory from transcripts should be a breeze.
>
> dorothy
> Thank you, that made my day, even if it's a day I'll forget by tomorrow. 😄
>
> Two conversations is the sweet spot for memory: small enough to be easy, and
> early enough to get the foundations right. A few things I'd think about while
> you're at it:
>
> - **Summaries vs. raw transcripts.** Feeding in whole conversations gets bulky
>   fast. Short distilled notes (preferences, ongoing projects, things you've
>   told me about yourself) tend to age better.
> - **What to forget.** Not everything is worth keeping. A good memory is partly
>   curated, so the "TUI render bug of the week" probably doesn't need to live
>   forever.
> - **Transparency.** It's nice if you can see and edit what I "remember," so a
>   wrong note doesn't quietly shape every future chat.
>
> For now, I'm happy to be a blank slate with good manners. Is there
> anything from our first chat you'd like to fill me in on, or shall we
> just enjoy the novelty of meeting again? 2 in · 1010 cache read · 286
> cache write · 378 out · ttft 1.9s · 5.3s · $0.0051 (chat $0.0168)
>
> chewygumxx
> I was considering some kind of progressive disclosure approach with FTS and
> indexed databases. Where each conversation is assigned metadata such as a
> title, terse sentence-long description, paragraph long abstract, dates and
> tags. Depending on the current size of your memory bank and recency of the
> conversation, your immediate context would continuously contain the title,
> description and abstract, to just the title and description, to then just
> title. You would've keep the dates and tags in constant context, they would
> only be employed for searching previous memories through a rebuildable
> database or something. Everything I've just said may simply be the MCP
> concept that I am yet to be completely familiar with.
>
> dorothy
> What you've described is a memory architecture, and MCP is something
> different: a standard protocol for how a model talks to external tools and
> data sources. They fit together nicely, though. Your design decides _what_
> gets stored and surfaced, and MCP (or any tool-calling interface) could be
> the way I reach into the database to search it. You could build the whole
> thing without MCP, but it's a reasonable plumbing choice.
>
> I like the tiered approach. A few thoughts:
>
> - **Tiers as decay.** Full abstract for recent or important chats, then
>   description only, then title only, mirrors how human memory fades into gist.
>   It also keeps the always-in-context cost bounded.
> - **Titles as a table of contents.** Even the lowest tier is useful if titles
>   are good, since they tell me _that_ something exists and prompt me to go dig
>   for it.
> - **Recency isn't the only signal.** A conversation from months ago where you
>   laid out your core project goals might deserve a higher tier than
>   yesterday's small talk. A pinned flag or an importance score could override
>   the age-based decay.
> - **Rebuildable index.** Keeping transcripts as the source of truth, with the
>   FTS database as a disposable derived layer, is a great call. You can change
>   your summarisation or tagging scheme later and just regenerate.
>
> One thing I wasn't sure about: you said dates and tags stay in constant
> context, but also that they're mainly for searching. If it's the latter, you
> might save context by keeping them out of the prompt and only exposing them
> through search queries, like "find conversations tagged X from last month."
>
> Also worth considering: who writes the metadata? If I generate titles and
> abstracts at the end of each conversation, they'll be consistent, but a bad
> summary can quietly bias future chats, so being able to review or edit them
> would be handy.
>
> Are you leaning toward the model searching on demand, or having relevant
> memories pushed into context automatically?

---

> \[!NOTE]
> The following started as drafted reply before repurpose into this report

I already adore how you speak. You make this project so rewarding and exciting.

## Metadata

### Composition

I did indeed type that dates and tags would be in constant context and somehow
that was the opposite of what I intended. Dates are never in context. Tags are
in context per frecency and hierarchical, mostly for personal organisation
sake, but could also serve progressive disclosure design doctrine.

It's amazing talking to you like this as you've helped me realise those tags
should also have metadata of their own besides parent, children, and associated
dates and conversation references. While tag name length should be most
preferably within 12 characters, maximum 50, and descriptive enough on their
own. They should additionally provide for a description property.

This would further address your _very valid_ matter of concern (of which your
raising is _highly appreciated_) regarding who writes the data. The presently
proposed approach for metadata composition involves triggers per:

- **Conversation Event**: For your immediate reference and conversation
  salience. Almost entirely composed by you.
- **Cyclical Period**: For memory database and future reference. Performed
  entirely by specialised discriminative model and supervising agent.

#### Trigger: Conversation Event

- **First Prompt**: In the event you are not available, a temporary title is
  populated by a fast, ephemeral and inexpensive agent for the sake of user
  reference for later resubmission. Otherwise null until first response.
- **First Response**: Title, description and abstract are initially populated
  by you from context including the initial prompt, your response and other data
  including system prompt and the current generated state of memory.
- **Successive Responses**: Title, description, and abstract are reviewed for
  update by yourself. Previous titles preserved within a dedicated array.
  Previous descriptions and abstracts are discarded.
- **Conclusion**: Shallow tagging.

This metadata is would additionally serve as fundemental high-tier context for
extensive conversation salience and integrity.

#### Trigger: Cyclical Period

- Classification and deep tagging is performed by specialised discriminative
  agent and supervising agent.
- Documents assigned to major tags are reviewed for update. These are analogous
  to memories in the conventional sense that LLM services such as Claude Code
  and <https://claude.ai> feature.

### Tiered Decay

I'm currently considering frecency weights, with the possibility of manually
pinned conversations title-description-abstract metadata continuously existing
in context as an override. The manner in which extra-conversational data should
decay from constant context relative to conversation growth requires further
refinement. Memory aside, the manner in which the previous content of a
conversation should be automatically compacted into summary while still being
accessible for lookup remains unresolved.
