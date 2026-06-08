# Pi Handbook

Minimal operating notes for this Pi setup.

## Shortcuts

- `/next` — quick state summary and next steps. Use this when momentum matters.
- `/recap` — recover the original/global plan, compare current state, and call out drift.
- `/coach` — deeper orientation. It should inspect this handbook, repo/session state, prompt shortcuts, rules, and skills before recommending one next move.
- `/quote` / `alt+q` — quote assistant text into the editor with `>` prefixes, then write the comment below it. Select text and press `alt+q`; it uses native selection APIs first and avoids stale clipboard text for the shortcut.
- `/ga` — goal-style autonomous work with evidence.
- `/lgtm` — review/verification before trusting changes.
- `/verify` — focused validation.
- `/retry` — recover after failed checks or an interrupted attempt.

## Habits

- Prefer concrete evidence over vibes: commands run, changed files, diffs, checks.
- Keep UX minimal; avoid wizard-style onboarding unless explicitly useful.
- Preserve muscle-memory shortcuts instead of replacing them with extension commands.
- Prefer email-style `>` quoting when commenting on a specific assistant excerpt; select text and press `alt+q`.
- Extract shared extension helpers only after a pattern repeats.
- Favor small, composable extensions over a framework.

## Coach behavior

When `/coach` runs, it should:

1. Understand current task/session state.
2. Inspect git status and relevant files if helpful.
3. Read this handbook and nearby prompts/rules when relevant.
4. Recommend exactly one best next move.
5. Provide the exact prompt or command to run next.

It may inspect, but should not edit files, commit, push, or start implementing by default.
