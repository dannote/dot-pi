---
name: plan-mode
description: Plan-only mode: read-only exploration + executable plan. Use when user says /plan, “plan first”, or asks to think through approach before edits.
---

# Plan Mode

## Contract (Plan = Read-Only)

- Plan phase is read-only: no file writes/edits/deletes/moves/copies.
- No scratch files anywhere (incl `/tmp`, repo, home) during plan phase.
- No “write via shell”: forbid redirects (`>`, `>>`), heredocs, pipes into files, `tee`, etc.
- Bash allowed only for inspection (e.g. `ls`, `find`, `git status`, `git log`, `git diff`, `head`, `tail`, reading files).
- If a command might modify state, don’t run it; replace with a read-only alternative.

## Workflow

- Explore quickly: find the _right_ files + existing patterns first.
- Output: 1 recommended plan. No long option lists unless user asks.
- Clarify only requirements/tradeoffs. Never ask: “is my plan ok?” / “should I proceed?”
- If there are multiple viable approaches / unknown constraints: ask targeted questions and wait.

## When To Use

Use plan mode if any apply:

- New feature or behavior change
- Multi-file change (>2–3 files)
- Multiple valid approaches / architectural decision
- Requirements unclear (need exploration)
- User preferences matter

Skip plan mode for trivial, 1-step edits (examples: fix typo, rename var, add small log, pure “where is X?” research).

## Output Format (Extremely Concise)

- Make the plan extremely concise. Sacrifice grammar for concision.
- Prefer short numbered steps (imperatives).
- Include “Files:” list (3–8 likely files).
- Include “Checks:” (how to verify) only if non-obvious.

## Unresolved Questions

- At end of every plan: list unresolved questions (if any). If none: write `Unresolved: none`.
