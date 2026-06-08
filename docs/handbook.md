# Pi Handbook

Minimal operating notes for this Pi setup.

## Shortcuts

- `/next` — quick state summary and next steps. Use this when momentum matters.
- `/recap` — re-orient both user and agent: original goal, current state, decisions, open threads, drift, best action.
- `/quote` / `alt+q` — quote assistant text into the editor with `>` prefixes, then write the comment below it. Select text and press `alt+q`; it uses native selection APIs first and avoids stale clipboard text for the shortcut.
- `/ga` — minimal approval to continue the current path.
- `/gaa` / `/all` — go ahead with all pending review/plan items, not one-by-one.
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

## Optional newcomer coach

The optional `/coach` extension is for humans copying this setup. It should explain the setup, shortcuts, habits, and first workflows. It may inspect handbook/prompts/rules/skills, but should not edit files, commit, push, or start implementing by default.
