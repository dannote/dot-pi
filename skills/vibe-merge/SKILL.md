---
name: vibe-merge
description: 'Use when the user wants to "vibe-merge"/"vibe-marge" a PR or branch: independently reimplement good ideas, avoid blind merging/cherry-picking, preserve quality, and credit the contributor as co-author.'
---

# Vibe Merge

Vibe-merge means: mine a PR/branch for good ideas, implement the worthwhile parts ourselves in small reviewable commits, and credit the original contributor with `Co-authored-by` trailers. Do not merge the branch wholesale unless the user explicitly asks.

## Workflow

1. **Inspect the source**
   - Read the PR/branch metadata, diff, commits, discussion, requested changes, external reviews, and checks.
   - Identify the original author name/email from commits when possible:
     - `git show -s --format='%an <%ae>' <commit>`
     - If the email is private/unusable, use the GitHub noreply identity from the PR author when available.
   - Write down the useful ideas and the risky parts separately.

2. **Pick one idea at a time**
   - Start from the target base branch, not from the PR branch.
   - Implement the idea in the project's style and architecture.
   - Prefer smaller commits over a broad mixed rewrite.
   - Do not copy large code blocks blindly; adapt or reimplement to fit current abstractions.
   - Keep unrelated PR churn out of the commit.

3. **Validate each idea**
   - Run focused tests for the touched area.
   - Run the repo's normal check command before finalizing if feasible.
   - If the PR idea has known review findings, fix them during the reimplementation instead of importing the bug.

4. **Credit the contributor**
   - Every commit that incorporates a contributor's idea must include a trailer:

     ```text
     Co-authored-by: Contributor Name <email@example.com>
     ```

   - If multiple contributors materially influenced the idea, include multiple trailers.
   - Do not claim sole authorship for ideas mined from external PRs.

5. **Communicate clearly**
   - Say which PR/branch the idea came from.
   - Mention that it was reimplemented rather than merged directly.
   - Draft any reply after reading the full conversation; do not repeat context the contributor already knows or expose private reasoning.
   - Show the exact reply and wait for approval before posting.
   - When closing or commenting on the original PR, thank the contributor and explain briefly that selected ideas landed with co-author credit.

## Commit shape

Use the repository's normal commit style. Keep the body useful and include the co-author trailer at the end:

```text
perf(canvas): cache retained scene backing

- Rebuild backing surfaces incrementally during viewport movement
- Fall back to direct rendering if CanvasKit cannot allocate an offscreen surface

Co-authored-by: Joey Cumines <123456+joeycumines@users.noreply.github.com>
```

## Guardrails

- Do not squash many unrelated ideas into one commit.
- Do not preserve a PR's bugs just to stay close to the source.
- Do not omit attribution because the implementation was rewritten.
- Do not force-push protected/shared branches unless explicitly requested.
- If the contributor has an open PR, avoid making comments that sound dismissive; frame it as incorporating their good ideas safely.
