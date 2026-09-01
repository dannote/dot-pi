---
name: pr-review
description: Review GitHub pull requests critically and contextually, including first reviews, re-reviews after requested changes, external reviewer or bot feedback, codebase-fit checks, validation, inline comment drafts, and merge decisions. Use when reviewing a PR, checking whether review comments were addressed, evaluating CodeRabbit or another review, preparing review comments, or deciding whether a PR is ready to merge.
---

# Pull Request Review

Review before mutating. Read the repository's `AGENTS.md`, `CONTRIBUTING.md`, PR template, and relevant bot instructions before judging the change. Treat those files as the project's source of truth; do not import conventions from another repository.

## Choose the workflow

| Context | Role | Output |
|---|---|---|
| First review | Reviewer | Evidence-based findings and one recommendation |
| Re-review after feedback | Follow-up reviewer | Status of each requested change plus regression findings |
| CodeRabbit, Copilot, CI, or contributor review | Maintainer | Independently verified classifications |
| Preparing comments | Maintainer reviewer | Exact concise inline-comment draft |
| Approved fix or merge | Maintainer/implementer | Scoped action and validation result |

- **First review:** inspect the final diff, history, discussion, checks, and relevant source/tests.
- **Re-review:** start from the previous review and track every requested change as addressed, partial, unresolved, or obsolete; then inspect the new diff for regressions.
- **External review:** verify each CodeRabbit, Copilot, CI, or contributor finding independently; classify it as valid, invalid, stale, duplicate, or low-value.
- **Draft comments:** map valid findings to the smallest useful line range, prefer inline comments, remove duplicates, and show the exact draft.
- **Fix or merge:** only act after the user explicitly chooses that action. Use `vibe-merge` when reimplementing selected ideas instead of merging a PR wholesale.

Do not conflate these workflows. A request to review is not permission to comment, request changes, edit code, push, or merge.

## Inspect in this order

1. Establish the base branch, worktree state, PR number, author, scope, and current head SHA.
2. Read repository guidance and the PR template. Check whether guidance files differ between the base and PR branch.
3. Read the PR title, body, commits, timeline, reviews, inline comments, and issue conversation. Look for earlier requests, author replies, resolved threads, and changed scope.
4. Inspect the complete diff against the correct base. Read surrounding source and analogous existing implementations.
5. Check CI and external reviews. Separate infrastructure failures from failures caused by the change.
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

- location (`path:line` or a precise range);
- concrete problem;
- why it matters in this repository;
- requested direction only when supported by evidence;
- validation or reproduction, if available.

Keep the report concise. State what was checked and what was not. If there are no actionable findings, say so and list remaining validation limitations.

## Comments and mutations

Default to read-only. Never post a review, inline comment, request changes, approve, edit a PR, push, or merge while merely reviewing.

Before posting comments:

1. Re-check the full conversation so the comment does not repeat an existing point or ignore an author response.
2. Prefer one concise inline comment for one actionable issue. Use a summary only for cross-cutting findings.
3. Draft in the repository's tone: concrete, humane, and proportional. Do not expose private speculation, frustration, or unnecessary internal context.
4. Show the exact comments and intended action. Wait for explicit approval.
5. After approval, post only the approved comments and verify what was posted. Do not duplicate existing comments.

Treat short follow-ups such as “go ahead” as authorization for the immediately discussed action only. If the action is unclear, summarize the pending choice instead of guessing.

## Decision output

End with one recommendation:

- approve;
- request changes;
- needs clarification or more evidence;
- fix selected issues ourselves;
- re-review after new commits; or
- merge, only when explicitly requested and the repository checks support it.

Do not use missing description polish or a bot warning alone to label a contributor's work low-effort. Evaluate the code and context separately.
