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

For the recommended end-user setup, run the bootstrap script. Safer review-first flow:

```bash
curl -fsSLO https://raw.githubusercontent.com/dannote/dot-pi/master/install.sh
less install.sh
sh install.sh
```

Convenience one-liner:

```bash
curl -fsSL https://raw.githubusercontent.com/dannote/dot-pi/master/install.sh | sh
```

The bootstrap is a POSIX `sh` script for macOS, Linux, and WSL. It installs Pi if missing, installs dot-pi with `pi install`, offers `agent-browser`, and explains optional companion packages (`pi-elixir`, `pi-subagents`, `pi-context`, and `pi-computer-use` on macOS) before prompting. `pi-elixir` defaults to yes when Elixir or Mix is detected; other companions default to no.

Headless/non-interactive Linux needs Node.js 22.19.0+ and npm available before Pi can install. Check with `node --version` and `npm --version`; install Node 22+ with your preferred Node manager or distro setup if needed.

Use non-interactive defaults with:

```bash
curl -fsSL https://raw.githubusercontent.com/dannote/dot-pi/master/install.sh | sh -s -- --yes
```

Useful bootstrap options:

```bash
sh install.sh --help
sh install.sh --local              # install dot-pi into the current project
sh install.sh --with-companions    # install all optional companion packages
sh install.sh --no-agent-browser   # skip agent-browser setup
sh install.sh --dry-run            # print commands without running them
DOT_PI_REF=v0.2.1 sh install.sh    # install a specific release/tag
```

Project-local install for a repo/team:

```bash
pi install git:github.com/dannote/dot-pi -l
```

Start Pi and use `pi config` to review or change what is enabled:

```bash
pi config
```

Update Pi and installed packages later with:

```bash
pi update
```

If prompt shortcuts such as `/ga` or `/wn` do not appear, check that `dot-pi` is enabled in `~/.pi/agent/settings.json`:

```json
{
  "packages": ["git:github.com/dannote/dot-pi"]
}
```

Global prompt templates are discovered from `~/.pi/agent/prompts/*.md`; project prompt templates are discovered from `.pi/prompts/*.md` after the project is trusted. For a manual checkout instead of `pi install`, symlink the prompt files:

```bash
mkdir -p ~/.pi/agent/prompts
ln -s /path/to/dot-pi/prompts/*.md ~/.pi/agent/prompts/
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

Recommended external Gmail skill/tool setup:

```bash
# Google Workspace CLI with generated agent skills
# Repo: https://github.com/googleworkspace/cli
# Note: the repo says it is not an officially supported Google product.
npm install -g @googleworkspace/cli

tmp=$(mktemp -d)
cd "$tmp"
gws generate-skills
mkdir -p ~/.pi/agent/skills
cp -R skills/gws-shared skills/gws-gmail* ~/.pi/agent/skills/
```

`gws generate-skills` creates many Workspace skills, not just Gmail. Copy only `gws-shared` and `gws-gmail*` if you want email without Drive/Calendar/Admin/etc. noise. This package's confirmation rules ask before Gmail write actions such as send, reply, forward, modify, trash, or delete.

## What is enabled by default

The default install focuses on broadly useful, low-surprise tools.

### Extensions

| Extension                | Description                                                                            | Extra setup                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ast-grep.ts`            | AST-based code search and rewrite                                                      | `brew install ast-grep`                                                                                |
| `background.ts`          | Start/stop long-running dev servers and watchers                                       | None                                                                                                   |
| `choose-options.ts`      | `choose_from_options` tool: TUI picker for LLM-proposed options/lists                  | None                                                                                                   |
| `codesearch.ts`          | Search public GitHub code via grep.app and fetch matched files with `codefetch`        | Optional `gh` for private/high-rate `codefetch`                                                        |
| `command-priority.ts`    | Reorder slash-command autocomplete using `slashCommandPriority` setting                | Optional settings entry                                                                                |
| `confirm-actions.ts`     | Ask before publish/mutate commands and high-risk local actions                         | None                                                                                                   |
| `context7/`              | Fetch current library docs from Context7                                               | `CONTEXT7_API_KEY`, often via `env-json`                                                               |
| `env-json/`              | Load `~/.pi/agent/env.jsonc` into `process.env` for API-backed extensions              | `~/.pi/agent/env.jsonc`                                                                                |
| `lsp/`                   | LSP tools: definitions, references, diagnostics, rename                                | Install language servers as needed                                                                     |
| `notify.ts`              | Desktop notification when work completes                                               | macOS notifications enabled                                                                            |
| `oracle.ts`              | `/oracle`: ask an expensive model with pre-compaction and aggressive context reduction | Configure `oracle.model` in settings                                                                   |
| `quote.ts`               | `/quote` or `ctrl+/`: insert selected/copied text as `>` email-style quote             | Optional native `selection-hook`; clipboard fallback commands (`pbpaste`, `wl-paste`, `xclip`, `xsel`) |
| `refactor-discipline.ts` | Add semantic refactoring discipline to the system prompt                               | None                                                                                                   |
| `webfetch/`              | Fetch URL content as markdown/text/html/json                                           | None                                                                                                   |
| `websearch/`             | Web search via Exa                                                                     | `EXA_API_KEY`, often via `env-json`                                                                    |
| `workflow-shortcuts.ts`  | `/next` and `/recap` commands with clean optional argument handling                    | None                                                                                                   |
| `worktrees/`             | Git worktree helpers for isolated work                                                 | None                                                                                                   |

Slash command priority can be configured in `~/.pi/agent/settings.json` or `.pi/settings.json`:

```json
{
  "slashCommandPriority": [
    "ga",
    "gaa",
    "all",
    "wn",
    "steps",
    "big",
    "ground",
    "rtfm",
    "minimal",
    "proper",
    "verify",
    "retry",
    "stop",
    "push",
    "release",
    "quote",
    "recap",
    "oracle",
    "nobc",
    "ar"
  ]
}
```

Project settings append after user settings. The extension only changes autocomplete order; commands still come from normal Pi prompt/extension/skill discovery.

Action confirmations use shell-style argv parsing, not regex matching. Defaults cover recursive file deletion, suspicious world-writable modes, privileged commands, publishing/editing GitHub/GitLab issues, PRs/MRs, comments, reviews, repository/release/secret/variable mutations, mutating `gh api` calls, Gmail writes via `gws gmail`, X/Twitter mutations via `bird`, git pushes/risky git actions, package publishing, releases, and common deploy CLIs. Tune groups or add local rules in `~/.pi/agent/settings.json` or `.pi/settings.json`:

```jsonc
{
  "confirmActionGroups": {
    "filesystem": true,
    "privilege": true,
    "github": true,
    "gitlab": true,
    "git": true,
    "gmail": true,
    "twitter": true,
    "publish": true,
    "deploy": true
  },
  "confirmCommands": [
    { "argv": ["gh", "release", "create"], "label": "Publish GitHub release" },
    { "command": "railway up", "label": "Deploy with Railway" }
  ]
}
```

Set a group to `false` to disable those built-in confirmations; custom `confirmCommands` still append after enabled defaults.

### Workflow slash commands

These mirror repeated Pi prompts from real sessions. Keep common prompts short; use explicit prompts when extra intent matters. `/steps` and `/big` use prompt-template defaults, so `/steps` means 7 steps and `/steps 10` means 10 steps. `/recap`, `/quote`, and `/oracle` are extension commands.

My usual coding flow:

1. Use `/ga` for plain “go ahead”.
2. Use `/wn` for quick orientation, `/steps [N]` for lists, and `/big [N]` for coarse work chunks.
3. Use `/rtfm`, `/ground`, `/proper`, or `/minimal` when extra intent matters.
4. Use `/gaa` or `/all` only for already agreed pending items.
5. Use `/retry` for tighter recovery.
6. Use `/stop` when the trajectory is wrong.
7. Use `/push` once work is coherent; use `/release` only for release prep.

| Command          | Use when I would normally type...           | Meaning                                                                                                                        |
| ---------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/all`           | `go ahead with all`, `do all pending`       | Complete currently agreed pending items; do not invent new work.                                                               |
| `/ar`            | `autoresearch loop ended... resume`         | Resume experiment loop from saved state; run and log next experiment.                                                          |
| `/big [N]`       | `next big 10 steps`                         | Exactly N coarse work chunks, no microsteps. Defaults to 7.                                                                    |
| `/ga`            | `go ahead`                                  | Plain approval to continue.                                                                                                    |
| `/gaa`           | `go ahead with all agreed items`            | Personal shorthand alias for `/all`.                                                                                           |
| `/ground`        | `read existing APIs/docs first`             | Inspect existing code/docs/upstream APIs; summarize patterns and minimal path. No edits.                                       |
| `/lgtm`          | `looks good, implement it`                  | Proceed with the agreed implementation, verify, and summarize.                                                                 |
| `/minimal`       | `too many entities`, `clean/minimal`        | Remove unnecessary wrappers/entities/shims/hand-rolled logic; reuse mechanisms.                                                |
| `/nobc`          | `no backward compatibility for new stuff`   | Replace newly introduced names/config cleanly; keep compatibility only for real released users.                                |
| `/oracle [q]`    | `ask the expensive model`                   | Pre-compacts/reduces context, switches model, answers, then restores.                                                          |
| `/proper`        | `do it properly`, `use the pipeline`        | Use existing project pipeline/conventions, not bypasses.                                                                       |
| `/push`          | `push`, `commit and push`, `time to commit` | Review status, commit in repo style, push.                                                                                     |
| `/quote [text]`  | selected assistant excerpt + comment        | Quote args or current selection as `>` lines. Shortcut: `ctrl+/`; `/quote` without args may use clipboard as a final fallback. |
| `/recap [focus]` | `wtf is going on?`, `what was the plan?`    | Reconstruct global context: goal, state, decisions, open threads, drift, and best action.                                      |
| `/release`       | `publish`, `changelog`, `prepare release`   | Prepare release artifacts/checks; do not publish without confirmation.                                                         |
| `/retry`         | `retry`, `try again`, `rerun`               | Diagnose actual failure and retry narrower.                                                                                    |
| `/rtfm`          | `read the docs/source first`                | Read relevant docs/source, then answer from evidence. No guessing.                                                             |
| `/steps [N]`     | `whats next?`, `next 7 steps`               | Brief state, exactly N prioritized next steps, best bounded action. Defaults to 7.                                             |
| `/stop`          | `stop`, `wrong direction`                   | Stop drift, identify failure mode, propose one recovery action. No edits.                                                      |
| `/verify`        | `did you test?`, `use browser`, `run ci`    | Verify with real evidence and report exact checks.                                                                             |
| `/wn`            | `whats next?`                               | One-paragraph state plus the single best bounded next action.                                                                  |

Configure `/oracle` in settings:

```jsonc
{
  "oracle": {
    "model": "anthropic/claude-opus-4-5",
    "thinking": "high",
    "precompact": {
      "enabled": true,
      "mode": "pi",
      "keepRecentTokens": 4000,
      "minTokens": 1000,
      "reserveTokens": 12000
    },
    "context": {
      "maxTokens": 12000,
      "summary": "latest",
      "keepTailTokens": 3000,
      "keepUserTurns": 3,
      "keepAssistantTurns": 2,
      "drop": {
        "thinking": true,
        "toolResults": "all",
        "toolCalls": "names-only",
        "bashOutput": "truncate",
        "images": true,
        "customMessages": true
      }
    },
    "tools": "none",
    "confirm": true,
    "defaultIntent": "review",
    "pricing": { "inputPerMillion": 10, "outputPerMillion": 50 },
    "budget": { "targetOutputTokens": 1500, "maxTotalUsd": 1 }
  }
}
```

Run `/oracle` without args for the native intent picker and cost/context confirmation. Run `/oracle <question>` to skip the intent picker but still preview before sending. `precompact.mode` can be `"pi"`, `"custom"`, or `"off"`. Custom mode uses `precompact.model` when set and `precompact.thinking`; the final one-turn context is still reduced by the `context` policy without deleting session history.

### Skills

| Skill                     | Description                                                                                                                               | Extra setup                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `agent-browser`           | Browser automation via agent-browser CLI. This wrapper loads current docs from `agent-browser skills get core` instead of vendoring them. | `npm install -g agent-browser && agent-browser install` |
| `github-issues`           | Work with GitHub Issues via `gh`                                                                                                          | `gh auth login`                                         |
| `keyboard-layout-decoder` | Decode Russian/English wrong-keyboard-layout text                                                                                         | None                                                    |
| `maintainer-reply`        | Draft concise, context-aware public replies and require appropriate approval before posting                                               | `gh auth login` for posting                             |
| `package-release`         | Prepare, publish, repair, and verify package releases from canonical user-facing changelogs                                               | Registry and GitHub credentials as required             |
| `pr-review`               | Review and re-review PRs with history, codebase fit, checks, external-review triage, and mutation gates                                   | `gh auth login`                                         |
| `skill-discovery`         | Discover agent skills on GitHub                                                                                                           | None                                                    |

## Optional resources

These are included in the repo but not enabled by default because they are experimental, personal, platform-specific, or require extra credentials.

Enable them by replacing the package entry in `~/.pi/agent/settings.json` with an object-form package filter. Use `+path` to opt into resources outside the default manifest.

### Optional extensions

`coach.ts` is the optional extension I recommend to newcomers: it explains the setup, habits, and first workflows. `tutor.ts` gives an in-place Dan-style workflow hint when the user is stuck or drifting. Try one from a local checkout with:

```bash
pi -e /path/to/dot-pi/extensions/coach.ts
```

| Extension              | Why optional                                                                      |
| ---------------------- | --------------------------------------------------------------------------------- |
| `bash-completion/`     | Advanced terminal completion; can be noisy while editing prompts                  |
| `coach.ts`             | Recommended for newcomers copying this setup; explains habits and first workflows |
| `critic/`              | Experimental shadow-review loop                                                   |
| `decision-guidance.ts` | Experimental trajectory guidance                                                  |
| `ghost-tutor.ts`       | Quiet model-generated workflow nudge after the agent stops                        |
| `plan-mode/`           | Experimental read-only planning mode                                              |
| `provider/`            | Experimental dynamic provider registration                                        |
| `rules.ts`             | Personal rule loader for symlinked files in `~/.pi/agent/rules/`                  |
| `tutor.ts`             | In-place Dan-style workflow hints for the current session                         |
| `voice-input/`         | Requires ElevenLabs key and audio setup                                           |

`voice-input/` uses `ELEVENLABS_API_KEY` and `rec` from sox. Optional environment variables: `ELEVENLABS_LANGUAGE`, `ELEVENLABS_KEYTERMS` (comma/newline-separated), `ELEVENLABS_COMMIT_STRATEGY` (`manual` or `vad`), `ELEVENLABS_VAD_SILENCE_THRESHOLD_SECS`, `ELEVENLABS_VAD_THRESHOLD`, `ELEVENLABS_MIN_SPEECH_DURATION_MS`, and `ELEVENLABS_MIN_SILENCE_DURATION_MS`.

### Optional skills

Regular optional skills live under `skills/`. Extra/meta skills live under `skills/extra/` so they do not look like core setup features.

| Skill             | Why optional                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `ai-news`         | Personal AI news workflow using X/Twitter                                                                    |
| `applescript`     | macOS-only automation                                                                                        |
| `bird`            | X/Twitter workflow for my `@dannote/bird-premium` CLI; forked from/credits `steipete/bird`                   |
| `chat-to-skill`   | Meta workflow for creating new skills                                                                        |
| `session-reflect` | Analyze local Pi session history for workflow patterns; writes cache to `~/.pi/agent/cache/session-reflect/` |
| `vibe-merge`      | Specialized PR/branch reimplementation workflow                                                              |

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
      "skills": [
        "+skills/applescript",
        "+skills/session-reflect",
        "+skills/extra/dont-anger-mario"
      ],
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

| Rule                        | Description                                    |
| --------------------------- | ---------------------------------------------- |
| `backward-compatibility.md` | Avoid unnecessary compatibility shims          |
| `comments.md`               | Avoid redundant comments                       |
| `commit-messages.md`        | Follow existing repo commit style              |
| `delete-files.md`           | Use `rm -f` to delete files                    |
| `git-hosting.md`            | Use `gh`/`glab` CLI instead of fetching URLs   |
| `pull-requests.md`          | Short PR drafting and review safety defaults   |
| `ripgrep.md`                | Prefer `rg` over `grep`                        |
| `skills-cli.md`             | Run skill commands from skill directory        |
| `typescript.md`             | TypeScript naming, type safety, imports, async |

## Development

```bash
npm install
npm run format:check
npm run check
npm test
```

Manual workflow smoke test: `docs/smoke-test.md`.

Shared extension helper guide: `extensions/shared/README.md`.

API-backed extension guide: `docs/api-backed-extensions.md`.

## License

MIT
