# dot-pi

A curated Pi package with extensions, skills, prompt shortcuts, and rules.

## Install

Install Pi first:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Then install this package:

```bash
pi install git:github.com/dannote/dot-pi
```

Project-local install for a repo/team:

```bash
pi install -l git:github.com/dannote/dot-pi
```

If Pi is already installed, you can also let Pi do the setup for you. Start `pi` and paste:

```text
Read https://github.com/dannote/dot-pi and set up dot-pi for me. Install the package, install agent-browser if missing, and offer the optional companion packages pi-computer-use, pi-subagents, and pi-context before installing them.
```

Start Pi and use `pi config` to review or change what is enabled:

```bash
pi config
```

Update Pi and installed packages later with:

```bash
pi update
```

Useful companion packages, installed separately when you want them:

```bash
pi install git:github.com/injaneity/pi-computer-use@v0.2.6  # macOS computer use
pi install npm:pi-elixir                                    # Elixir/BEAM development
pi install npm:pi-subagents                                 # subagent delegation
pi install npm:pi-context                                   # context history tags/checkouts
```

`pi-computer-use` is especially useful for visible macOS apps. It adds semantic window/screenshot tools and prefers Accessibility refs over coordinates.

`pi-elixir` is recommended for Elixir/Phoenix work. It adds a small BEAM-native tool surface (`elixir_eval`, AST search/replace) so Pi can inspect and change running Mix projects through the Elixir runtime instead of shelling out for everything.

## What is enabled by default

The default install focuses on broadly useful, low-surprise tools.

### Extensions

| Extension                | Description                                                               | Extra setup                                                                                            |
| ------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ast-grep.ts`            | AST-based code search and rewrite                                         | `brew install ast-grep`                                                                                |
| `background.ts`          | Start/stop long-running dev servers and watchers                          | None                                                                                                   |
| `codesearch.ts`          | Search public GitHub code via grep.app                                    | None                                                                                                   |
| `command-priority.ts`    | Reorder slash-command autocomplete using `slashCommandPriority` setting   | Optional settings entry                                                                                |
| `confirm-destructive.ts` | Ask before high-risk local actions                                        | None                                                                                                   |
| `context7/`              | Fetch current library docs from Context7                                  | None                                                                                                   |
| `lsp/`                   | LSP tools: definitions, references, diagnostics, rename                   | Install language servers as needed                                                                     |
| `notify.ts`              | Desktop notification when work completes                                  | macOS notifications enabled                                                                            |
| `quote.ts`               | `/quote` or `alt+q`: insert selected/copied text as `>` email-style quote | Optional native `selection-hook`; clipboard fallback commands (`pbpaste`, `wl-paste`, `xclip`, `xsel`) |
| `question.ts`            | Let the agent ask selectable questions                                    | None                                                                                                   |
| `webfetch/`              | Fetch URL content as markdown/text/html/json                              | None                                                                                                   |
| `websearch/`             | Web search via Exa                                                        | `EXA_API_KEY`                                                                                          |
| `worktrees/`             | Git worktree helpers for isolated work                                    | None                                                                                                   |

Slash command priority can be configured in `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "slashCommandPriority": [
    "ga",
    "gaa",
    "lgtm",
    "quote",
    "next",
    "recap",
    "all",
    "verify",
    "retry",
    "push",
    "release",
    "ar"
  ]
}
```

Project settings append after user settings. The extension only changes autocomplete order; commands still come from normal Pi prompt/extension/skill discovery.

### Prompt shortcuts

These mirror my actual repeated Pi prompts from recent coding sessions, so I can type less without losing intent.

My usual coding flow:

1. Ask `/next` when context gets fuzzy. Pi should restate state, list the next concrete steps, and pick the best immediate move.
2. Use `/ga` for a simple approval of the current path. This is the direct replacement for my very frequent “go ahead”.
3. Select assistant text, press `alt+q`, then comment below the inserted email-style quote.
4. Use `/lgtm` when I want more autonomy than `/ga`: proceed, implement the next slice, verify, and summarize.
5. Use `/recap` when `/next` is too local and I need the original plan vs current drift.
6. Use `/all` after reviews/plans when I do not want piecemeal fixes.
7. Use `/verify` when I suspect the agent skipped tests, browser checks, CI, or manual validation.
8. Use `/retry` after a failed/flaky attempt, usually with a tighter diagnosis.
9. Use `/push` once the work is coherent; use `/release` only when changelog/version/publish prep is needed.
10. Use `/ar` for the repeated autoresearch resume loop after context-limit restarts.

| Prompt           | Use when I would normally type...           | Meaning                                                                                                                       |
| ---------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/ga`            | `go ahead`                                  | Minimal approval; continue current path.                                                                                      |
| `/gaa`           | `go ahead with all`                         | Alias for `/all`; complete all pending review/plan items, not one-by-one.                                                     |
| `/lgtm`          | `yes`, `do it`, `okay`                      | Proceed; do not ask unless blocked; verify and summarize.                                                                     |
| `/quote [text]`  | selected assistant excerpt + comment        | Quote args or current selection as `>` lines. Shortcut: `alt+q`; `/quote` without args may use clipboard as a final fallback. |
| `/next [count]`  | `whats next?`, `what are next 7 big steps?` | Brief state, prioritized next steps, best immediate action.                                                                   |
| `/recap [focus]` | `wtf is going on?`, `what was the plan?`    | Reconstruct global context: goal, state, decisions, open threads, drift, and best action.                                     |
| `/ar`            | `autoresearch loop ended... resume`         | Resume experiment loop from saved state; run and log next experiment.                                                         |
| `/verify`        | `did you test?`, `use browser`, `run ci`    | Run relevant checks, fix failures, rerun focused checks.                                                                      |
| `/all`           | `fix all`, `do all`, `all pending items`    | Same intent as `/gaa`; complete all pending review/plan items, not one-by-one.                                                |
| `/push`          | `push`, `commit and push`, `time to commit` | Review status, commit in repo style, push.                                                                                    |
| `/release`       | `publish`, `changelog`, `prepare release`   | Prepare release artifacts/checks; do not publish without confirmation.                                                        |
| `/retry`         | `retry`, `try again`, `rerun`               | Diagnose previous failure, retry tighter, verify.                                                                             |

### Skills

| Skill                     | Description                                                                                                                               | Extra setup                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `agent-browser`           | Browser automation via agent-browser CLI. This wrapper loads current docs from `agent-browser skills get core` instead of vendoring them. | `npm install -g agent-browser && agent-browser install` |
| `github-issues`           | Work with GitHub Issues via `gh`                                                                                                          | `gh auth login`                                         |
| `keyboard-layout-decoder` | Decode Russian/English wrong-keyboard-layout text                                                                                         | None                                                    |
| `skill-discovery`         | Discover agent skills on GitHub                                                                                                           | None                                                    |

## Optional resources

These are included in the repo but not enabled by default because they are experimental, personal, platform-specific, or require extra credentials.

Enable them by replacing the package entry in `~/.pi/agent/settings.json` with an object-form package filter. Use `+path` to opt into resources outside the default manifest.

### Optional extensions

`coach.ts` is the optional extension I recommend to newcomers: it explains the setup, habits, and first workflows. Try it from a local checkout with:

```bash
pi -e /path/to/dot-pi/extensions/coach.ts
```

| Extension              | Why optional                                                                      |
| ---------------------- | --------------------------------------------------------------------------------- |
| `bash-completion/`     | Advanced terminal completion; can be noisy while editing prompts                  |
| `coach.ts`             | Recommended for newcomers copying this setup; explains habits and first workflows |
| `critic/`              | Experimental shadow-review loop                                                   |
| `decision-guidance.ts` | Experimental trajectory guidance                                                  |
| `env-json/`            | Only useful if you keep secrets in `~/.pi/agent/env.jsonc`                        |
| `permission-gate.ts`   | Opinionated command blocking                                                      |
| `plan-mode/`           | Experimental read-only planning mode                                              |
| `provider/`            | Experimental dynamic provider registration                                        |
| `rules.ts`             | Personal rule loader for symlinked files in `~/.pi/agent/rules/`                  |
| `sandbox/`             | Experimental OS-level sandboxing                                                  |
| `voice-input/`         | Requires ElevenLabs key and audio setup                                           |

### Optional skills

Regular optional skills live under `skills/`. Extra/meta skills live under `skills/extra/` so they do not look like core setup features.

| Skill           | Why optional                                    |
| --------------- | ----------------------------------------------- |
| `ai-news`       | Personal AI news workflow using X/Twitter       |
| `applescript`   | macOS-only automation                           |
| `bird`          | X/Twitter workflow; requires bird CLI/auth      |
| `chat-to-skill` | Meta workflow for creating new skills           |
| `vibe-merge`    | Specialized PR/branch reimplementation workflow |

### Extra skills

| Skill              | Why extra                                                            |
| ------------------ | -------------------------------------------------------------------- |
| `dont-anger-mario` | Meta etiquette for drafting concise pi issues/contribution proposals |

Example package filter enabling only voice input, AppleScript, and the extra Mario etiquette skill:

```json
{
  "packages": [
    {
      "source": "git:github.com/dannote/dot-pi",
      "extensions": ["+extensions/voice-input"],
      "skills": ["+skills/applescript", "+skills/extra/dont-anger-mario"],
      "prompts": ["prompts"]
    }
  ]
}
```

## Rules

Rules are intentionally not enabled through the package. They are personal preference files. Symlink the ones you want into `~/.pi/agent/rules/`:

```bash
mkdir -p ~/.pi/agent/rules
ln -s /path/to/dot-pi/rules/typescript.md ~/.pi/agent/rules/
```

| Rule                        | Description                                         |
| --------------------------- | --------------------------------------------------- |
| `backward-compatibility.md` | Avoid unnecessary compatibility shims               |
| `bun.md`                    | Use Bun instead of Node.js/npm                      |
| `comments.md`               | Avoid redundant comments                            |
| `commit-messages.md`        | Follow existing repo commit style                   |
| `delete-files.md`           | Use `rm -f` to delete files                         |
| `git-hosting.md`            | Use `gh`/`glab` CLI instead of fetching URLs        |
| `pull-requests.md`          | PR workflow: study templates, preview before submit |
| `ripgrep.md`                | Prefer `rg` over `grep`                             |
| `skills-cli.md`             | Run skill commands from skill directory             |
| `typescript.md`             | TypeScript naming, type safety, imports, async      |

## Development

```bash
bun install
bun run check
bun run lint
```

## License

MIT
