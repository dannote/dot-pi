---
name: pr-review
description: Review GitHub pull requests critically and contextually, including first reviews, re-reviews after requested changes, external reviewer or bot feedback, codebase-fit checks, validation, inline comment drafts, and merge decisions. Use when reviewing a PR, checking whether review comments were addressed, evaluating CodeRabbit or another review, preparing review comments, or deciding whether a PR is ready to merge.
---

# Pull Request Review

Review before mutating. Read the repository's `AGENTS.md`, `CONTRIBUTING.md`, PR template, and relevant bot instructions before judging the change. Treat those files as the project's source of truth; do not import conventions from another repository.

## Choose the workflow

| Context                                    | Role                   | Output                                                                       |
| ------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------- |
| First review                               | Reviewer               | Evidence-based findings and one recommendation                               |
| Re-review after feedback                   | Follow-up reviewer     | Status of each requested change plus regression findings                     |
| Merged or closed PR                        | Auditor                | Retrospective findings and any separate follow-up action                     |
| CodeRabbit, Copilot, or contributor review | Maintainer             | Independently verified classifications                                       |
| CI and checks                              | Reviewer               | Attributed pass, PR failure, infrastructure failure, flake, skip, or unknown |
| Preparing comments                         | Maintainer reviewer    | Exact concise inline-comment draft                                           |
| Approved fix or merge                      | Maintainer/implementer | Scoped action and validation result                                          |

- **First review:** inspect the final diff, history, discussion, checks, and relevant source/tests.
- **Re-review:** compare the reviewed commit SHA with the current head before classifying anything. Build the requested-change list from maintainer reviews, inline threads, author responses, and later commits. Mark each item as maintainer-requested, external suggestion, or newly discovered, then classify it as addressed, partial, unresolved, or obsolete from the current diff. If no commits or relevant changes followed the review, say so directly; do not infer fixes from the PR body or commit message.
- **Merged or closed PR:** review retrospectively. Do not recommend merging, approving, or requesting changes; identify only lessons or a separate follow-up warranted by current code.
- **External review:** verify each CodeRabbit, Copilot, or contributor finding against the current head, current PR body, current conversation, and repository policy; classify it as valid, invalid, stale, duplicate, or low-value. A bot threshold is not a project requirement unless repository guidance or CI makes it one; do not add comments or code solely to satisfy an unsupported metric.
- **CI and checks:** inspect failing logs, not only check summaries. Attribute each relevant result as passing, failing because of the PR, infrastructure failure, flaky, cancelled/blocked, skipped/not applicable, or unverified. Report the actual checks; do not inflate the count with service statuses or infer checks that are not present.
- **Draft comments:** map valid findings to the smallest useful line range, prefer inline comments, remove duplicates, and show the exact draft.
- **Fix or merge:** only act after the user explicitly chooses that action. Use `vibe-merge` when reimplementing selected ideas instead of merging a PR wholesale.

Do not conflate these workflows. A request to review is not permission to comment, request changes, edit code, push, or merge.

## Inspect in this order

1. Establish the PR state, merged/closed time when applicable, base branch, worktree state, PR number, author, scope, current head SHA, and formal review decision.
2. Read repository guidance and the PR template. Check whether guidance files differ between the base and PR branch.
3. Read the PR title, current body, commits, timeline, formal reviews, inline comments, reactions, and issue conversation. Look for maintainer requests, external suggestions, author replies, resolved threads, and changed scope. Do not treat thanks, emoji, or reactions as approval; attribute formal approvals and change requests to their actual authors, and do not mistake a bot approval for maintainer approval.
4. Inspect the complete diff against the correct base. Read surrounding source, analogous existing implementations, definitions of referenced helpers, and nearby tests. Resolve accessible dependencies instead of leaving findings based on assumptions.
5. Check CI and external reviews. Inspect `statusCheckRollup` and failed logs rather than claiming CI is unavailable after a limited query. Separate infrastructure failures from failures caused by the change.
6. Run focused checks and real-runtime or visual validation when the change requires it. Do not claim validation from a command you did not run.

Use `gh` for GitHub data. Prefer structured output and line-aware comments, for example:

```bash
gh pr view <number> --comments --json title,body,author,baseRefName,headRefName,commits,reviews,comments,statusCheckRollup
gh pr diff <number>
gh api repos/OWNER/REPO/pulls/<number>/comments
```

## Review lenses

Check only lenses relevant to the change, but always check codebase fit:

- **Correctness:** behavior, edge cases, regressions, error paths, concurrency, and data loss.
- **Codebase fit:** existing abstractions, package ownership, naming, file layout, dependencies, public APIs, and duplication. Search before adding a helper, type, wrapper, shim, or configuration path.
- **Tests:** behavior and contracts rather than source-text matching; source-domain structure where practical; correct unit/integration/E2E/visual level; existing fixtures and helpers.
- **UX/API compatibility:** documented external behavior, accessibility, framework idioms, and compatibility with the project's target platform or API.
- **Validation:** relevant checks, runtime behavior, screenshots or visual diffs, and whether failures are attributable to the PR.
- **Scope and maintainability:** unnecessary churn, stale compatibility code, path drilling, hand-rolled mechanisms, and misleading names or comments.

Do not reject a change merely because it differs from personal taste. Explain the repository rule, existing analogue, contract, or observed failure that makes a finding actionable.

## Findings

Report findings in severity order. Each finding needs:

- location (`path:line` or a precise current-diff range; retrieve the diff and verify the line before drafting);
- concrete problem;
- why it matters in this repository;
- requested direction only when supported by evidence;
- validation or reproduction, if available.

Keep the report concise. State what was checked and what was not. If there are no actionable findings, say so and list remaining validation limitations.

## Comments and mutations

Default to read-only. Never post a review, inline comment, request changes, approve, edit a PR, push, or merge while merely reviewing.

Before posting comments or taking any approved action:

1. Re-check the current head SHA. If it changed, inspect the new commits and refresh affected findings before continuing. If an existing review targets the current head and no later commits exist, state that the requested changes remain on the same reviewed code.
2. Re-check the full conversation so the comment does not repeat an existing point or ignore an author response. Do not draft a new comment that merely repeats an unresolved maintainer request already visible on the same unchanged head unless the user explicitly wants a follow-up reminder.
3. Prefer one concise inline comment for one actionable issue. Use a summary only for cross-cutting findings.
4. Draft in the repository's tone: concrete, humane, and proportional. Do not expose private speculation, frustration, or unnecessary internal context.
5. Show the exact comments and intended action. Wait for explicit approval unless the user already supplied exact final text and explicitly requested that action.
6. After approval, post only the approved comments and verify what was posted. Do not duplicate existing comments.

Treat short follow-ups such as “go ahead” as authorization for the immediately discussed action only. If the action is unclear, summarize the pending choice instead of guessing.

## Decision output

End with one recommendation appropriate to the current PR state:

- for an open PR: approve, request changes, seek clarification or more evidence, fix selected issues ourselves, re-review after new commits, or merge only when explicitly requested and supported by checks;
- for a merged or closed PR: no PR action, or a separate follow-up only when current code still warrants one.

Do not use missing description polish or a bot warning alone to label a contributor's work low-effort. Evaluate the code and context separately.
