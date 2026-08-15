# Pi Handbook

Minimal operating notes for this Pi setup.

## Shortcuts

- `/next` — extension command for quick state summary and next steps. Optional count defaults cleanly to 7; use `/next big` or `/next b 3` for coarse-grained work chunks instead of micro-actions.
- `/discuss` — talk through tradeoffs before acting; no file edits, commands, commits, or pushes yet.
- `/recap` — extension command to re-orient both user and agent: original goal, current state, decisions, open threads, drift, best action.
- `choose_from_options` — LLM-triggered TUI picker for numbered options/next-step lists; use it when the user should choose instead of typing `1,3`.
- `/quote` / `ctrl+/` — quote assistant text into the editor with `>` prefixes, then write the comment below it. Select text and press `ctrl+/`; it uses native selection APIs first and avoids stale clipboard text for the shortcut.
- `/ga` — minimal approval to continue the current path.
- `/gaa` / `/all` — aliases for all currently agreed pending items; do not invent scope or proceed one-by-one.
- `/lgtm` — proceed with the agreed implementation, then verify and summarize.
- `/verify` — run relevant project checks and real runtime/UI validation when applicable.
- `/retry` — recover after failed checks or an interrupted attempt.
- `/nobc` — do not keep backward compatibility for names/config introduced in the current unreleased change.

## Habits

- Prefer concrete evidence over vibes: commands run, changed files, diffs, checks.
- Keep UX minimal; avoid wizard-style onboarding unless explicitly useful.
- Preserve muscle-memory shortcuts instead of replacing them with extension commands.
- Prefer email-style `>` quoting when commenting on a specific assistant excerpt; select text and press `ctrl+/`.
- Extract shared extension helpers only after a pattern repeats.
- Favor small, composable extensions over a framework.

## Optional newcomer coach

The optional `/coach` extension is for humans copying this setup. It should explain the setup, shortcuts, habits, and first workflows. It may inspect handbook/prompts/rules/skills, but should not edit files, commit, push, or start implementing by default.
