# dot-pi

Extensions, skills, and rules for [Pi](https://github.com/badlogic/pi-mono) coding agent.

## Extensions

| Extension                | Description                                                                                                                        | Origin                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `codesearch.ts`          | Search public GitHub code via [grep.app](https://grep.app) MCP API                                                                 | Original                                                                                                                                         |
| `confirm-destructive.ts` | Confirm before clearing session or switching with unsaved work                                                                     | Based on [pi-mono example](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/confirm-destructive.ts)       |
| `lsp/`                   | Language Server Protocol for code intelligence (definition, references, hover, diagnostics, rename, etc.)                          | Based on [oh-my-pi](https://github.com/can1357/oh-my-pi/tree/41fed50e5861cfa8bac505cf3eb238f55b228ae8/packages/coding-agent/src/core/tools/lsp)  |
| `plan-mode/`             | Read-only plan mode toggle + safe bash allowlist + optional step tracking                                                          | Based on [pi-mono example](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/plan-mode)                    |
| `notify.ts`              | Send desktop notifications on task completion (OSC 777/9)                                                                          | Based on [pi-mono example](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/notify.ts)                    |
| `permission-gate.ts`     | Block dangerous bash commands (rm -rf, sudo, git push, etc.)                                                                       | Based on [pi-mono example](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/permission-gate.ts)           |
| `question.ts`            | Let the LLM ask user questions with selectable options                                                                             | Simplified version of [pi-mono example](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/question.ts)     |
| `rules.ts`               | Load rule files from `~/.pi/agent/rules/` into system prompt                                                                       | Based on [pi-mono claude-rules example](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/claude-rules.ts) |
| `sandbox/`               | **[WIP]** Sandbox bash commands using [@anthropic-ai/sandbox-runtime](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime) | Original                                                                                                                                         |
| `webfetch/`              | Fetch URL content and convert to markdown/text/html                                                                                | Original                                                                                                                                         |
| `websearch.ts`           | Web search via [Exa AI](https://exa.ai) MCP API                                                                                    | Original                                                                                                                                         |

## Skills

| Skill                     | Description                                                                               | Origin                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `agent-browser`           | Browser automation with [agent-browser](https://github.com/vercel-labs/agent-browser) CLI | Adapted from [agent-browser docs](https://github.com/vercel-labs/agent-browser)                                                |
| `applescript`             | AppleScript and JXA automation for macOS                                                  | Adapted from [claude-skills-generator](https://github.com/martinholovsky/claude-skills-generator/tree/main/skills/applescript) |
| `chat-to-skill`           | Convert current chat session into a reusable skill (long-term memory)                     | Original                                                                                                                       |
| `keyboard-layout-decoder` | Decode text typed with wrong keyboard layout (Russian ↔ English)                          | Original                                                                                                                       |

| `skill-discovery`         | Discover agent skills on GitHub via `gh` CLI                                              | Original                                                                                                                       |

## Rules

| Rule                 | Description                                             |
| -------------------- | ------------------------------------------------------- |
| `bun.md`             | Use Bun instead of Node.js/npm                          |
| `comments.md`        | Comment policy — avoid redundant comments               |
| `commit-messages.md` | Follow existing repo commit style                       |
| `delete-files.md`    | Use `rm -f` to delete files                             |
| `typescript.md`      | TypeScript naming, type safety, imports, async patterns |

## Installation

### Extensions

Copy desired extensions to `~/.pi/agent/extensions/`:

```bash
cp extensions/codesearch.ts ~/.pi/agent/extensions/
```

For extensions with dependencies (`sandbox/`, `webfetch/`), copy the whole directory and run `bun install`:

```bash
cp -r extensions/webfetch ~/.pi/agent/extensions/
cd ~/.pi/agent/extensions/webfetch && bun install
```

### Skills

Copy desired skills to `~/.pi/agent/skills/`:

```bash
cp -r skills/chat-to-skill ~/.pi/agent/skills/
```

### Rules

Copy desired rules to `~/.pi/agent/rules/`:

```bash
cp rules/typescript.md ~/.pi/agent/rules/
```

Then add the `rules.ts` extension to load them into the system prompt.

## Development

```bash
bun install
bun run check    # TypeScript check
bun run format   # Format with oxfmt
bun run lint     # Lint with oxlint
```

## License

MIT
