---
name: maintainer-reply
description: Draft concise, natural, context-aware public replies to GitHub issues, pull requests, reviews, and contributor follow-ups. Use when replying to a contributor, preparing an issue or PR comment, thanking or apologizing publicly, explaining a project decision, or composing a response that must fit an existing conversation.
---

# Maintainer Reply

Draft before posting. Read the relevant issue or PR conversation, repository guidance, and the user's stated goal before writing. A technically correct reply can still be wrong if it ignores what the recipient already knows or reveals private context.

## Identify the reply

Before drafting, establish:

- recipient and relationship;
- issue, PR, review, or thread;
- purpose: answer, clarify, thank, apologize, request information, request changes, close, or explain a decision;
- what has already been said;
- what the recipient already knows;
- the state and time slice the reply must reflect, especially when testing or reconstructing an earlier point in a conversation;
- whether this is a draft or an approved post.

Keep these separate:

```text
private reasoning → review findings, frustration, speculation, roadmap, internal comparisons
public reply      → relevant facts, concrete request, brief rationale, appropriate next step
```

Do not leak private reasoning merely because it informed the decision.

## Style

Write in the maintainer's natural voice:

- concise and humane;
- specific to this conversation;
- proportionate to the issue and contributor;
- direct without sounding automated or corporate.

Avoid generic filler, obvious restatements, excessive headings, long technical explanations, forced gratitude, unexplained jargon, and LLM-shaped phrases such as “I’ve provided detailed feedback below” when the context already makes that clear. Avoid intensifiers and stock support language such as “sincerely,” “we appreciate your effort,” and “thanks for your understanding” unless they fit the maintainer's established voice and this specific exchange. Do not mention bots, internal agents, or project politics unless the user explicitly wants that included.

Appreciate useful contributions sincerely. Do not treat a good-faith contributor like a low-effort or automated submission without clear evidence. If apologizing, name the concrete mistake and the correction; do not over-explain.

## Workflow

1. Read the relevant conversation and inspect linked context when the reply depends on it. If drafting for an earlier moment, use only facts known at that point and do not copy or rely on later replies.
2. Summarize privately in one sentence what the reply needs to accomplish.
3. Draft the shortest complete reply that accomplishes that purpose.
4. Check every sentence: already known, private, generic, unsupported, or unnecessary sentences should be removed. Never promise a future action or say it is happening “now” unless the user approved it and the current workflow will perform it.
5. Show the exact draft and intended destination unless the user already supplied exact final text and explicitly asked to post it.
6. Wait for explicit approval when the text or action is not already explicit. A request to draft or review is not permission to post.
7. Before posting, re-check the conversation for newer replies. Post exactly the approved text and verify the result.

If the user says “go ahead,” use the immediately preceding draft and action as the scope. Do not infer permission for unrelated comments, edits, labels, closing, or merging.

## Review and PR comments

For technical review feedback, use `pr-review` for the review itself. Prefer concise inline comments for line-specific findings and avoid repeating comments already present in the thread. The summary should state only cross-cutting context or the final decision.

For a reply after review, distinguish:

- first review;
- response to author changes;
- unresolved requested changes;
- selected ideas reimplemented through `vibe-merge`;
- approval or closure.

Use the current conversation to choose the correct one rather than sending a generic review message.
