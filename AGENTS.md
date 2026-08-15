# Development Guidelines

Pi reads this `AGENTS.md` automatically when working in this repository. Keep durable dot-pi development policy here; use prompt templates for turn-specific intent and `rules/` for optional personal preferences.

## Installation

Install the complete package with Pi:

```bash
pi install git:github.com/dannote/dot-pi
```

For a project-local install:

```bash
pi install git:github.com/dannote/dot-pi -l
```

Use direct symlinks only when enabling individual optional resources from a manual checkout:

```bash
# Extensions
ln -s /path/to/dot-pi/extensions/codesearch.ts ~/.pi/agent/extensions/

# Skills
ln -s /path/to/dot-pi/skills/ai-news ~/.pi/agent/skills/

# Rules
ln -s /path/to/dot-pi/rules/typescript.md ~/.pi/agent/rules/
```

Each symlink points directly to the source file or directory. No intermediate symlinks. Pi discovers this repository's `AGENTS.md` natively; do not symlink it into `~/.pi/agent/`.

## Adding New Components

When adding new extensions, skills, or rules:

1. Add entry to the corresponding table in `README.md`
2. Keep tables alphabetically sorted
3. Include Origin column with link to source if adapted from another project
4. Commit both the component and README update together

## Quality Gates

Before committing changes, run:

```bash
npm run check
npm run test
npm run format:check
```

`npm run check` includes oxlint, TypeScript checking, Vitest, jscpd duplicate detection, and `deps:check` dependency hygiene. Keep shared helpers in `extensions/shared/` when logic appears in more than one extension.

## Native pi Tool Rendering Rules

When adding or changing model-facing tool renderers, follow native pi TUI conventions systematically:

1. Use shared primitives from `extensions/shared/render.ts` instead of ad-hoc `new Text(...)` result styling.
2. Result blocks start with one leading blank line, but do **not** add blanket left padding. Indent only when the structure needs it.
3. Use semantic colors:
   - metadata, paths, counts, hidden-detail text: `meta(...)` / muted
   - primary output/code/content: `primary(...)` / `toolOutput`
   - important headings/names: `title(...)` / bold `toolOutput`
   - additions/removals in diffs: success/error
4. Do not use raw white text for tool output unless it is intentionally neutral prose from the assistant. Tool result content should be styled.
5. Human-readable metadata order is left-to-right: subject first, then attributes, e.g. `https://example.com/ · 559 B`, not `(559 B) → url`.
6. Compact renderers show a summary and a few semantic items only. Raw bodies, long snippets, page text, and full diffs belong in expanded output.
7. If compact output is lossy, show `(ctrl+o to expand)` as a footer with a blank line before it. Do not show the hint when there is nothing hidden.
8. Never duplicate state/mode labels. If the call line says `dry-run`, the result body must not also say `DRY RUN`.
9. Search results should be parsed into semantic rows (`count`, `path:line`, source preview), not dumped as raw command stdout.
10. AST edit dry-run diffs must render like pi's built-in edit diff style; do not expose ast-grep's pseudo-diff format (`1 1│`, etc.).
11. Absolute paths should be muted and avoided in compact primary text when a shorter name is sufficient.
12. After renderer changes, run `npm run check`, `npm run test`, `npm run format:check`, and verify representative cases in tmux/asciinema before claiming the UI is fixed.
