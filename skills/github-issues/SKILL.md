---
name: github-issues
description: Use gh CLI to view, triage, fix, link, create, or close GitHub Issues.
---

# GitHub Issues Workflow

## Markdown bodies: never inline multiline text

Never pass multiline Markdown through `--body "..."`. Shell quoting can leak literal `\n` into GitHub.

Always write Markdown to a temp file and use `--body-file`:

```bash
cat > /tmp/body.md <<'EOF'
## Summary

- ...

## Tests

- `...`
EOF

gh pr create --body-file /tmp/body.md
# or
gh pr edit <number> --body-file /tmp/body.md
# or
gh issue create --body-file /tmp/body.md
```

## Review handoff

For PR inspection, use the `pr-review` skill. This skill handles GitHub issue and PR mechanics such as reading templates, using `--body-file` for multiline Markdown, and checking existing comments before closing or posting.

## View issue

```bash
gh issue view <number>
```

## Create issue safely

For non-trivial bodies, always write the draft to a temp file first. Do not inline long Markdown with shell quoting.

```bash
cat > /tmp/issue.md <<'EOF'
### What happened?

...
EOF

gh issue create --repo OWNER/REPO --title "Short title" --body-file /tmp/issue.md
```

Before creating issues in someone else's repo, check templates/contributing docs and keep the report concise.

```bash
gh api repos/OWNER/REPO/contents/.github/ISSUE_TEMPLATE --jq '.[].name'
gh api repos/OWNER/REPO/contents/CONTRIBUTING.md --jq .content | base64 --decode
```

If `gh issue create` prompts for confirmation, review the preview carefully before accepting.

## Link issues in commits, changelogs, releases

- Commits: `fix: description (#1)` or `fix: description (fixes #1)` — auto-closes on merge to default branch
- Changelog: `([#1](https://github.com/owner/repo/issues/1))`
- Release notes: `fixes #1` — does NOT auto-close, must close manually

## Public replies

Use the `maintainer-reply` skill before drafting or posting issue and PR replies. Read the conversation first; do not apply a generic thank-you or mention a fix version when it is unknown or irrelevant.

## Close with comment

When closing with a reply, mention the fix version when known and thank the reporter when appropriate to the conversation:

```bash
gh issue close <number> --comment "Fixed in v1.2.3. Thanks for the report!"
```

## Test fixes before closing

For npm packages, simulate fresh install:

```bash
npm pack --pack-destination /tmp/
cd /tmp && mkdir test && cd test
echo '{"name":"test"}' > package.json
bun add /tmp/package-name-1.0.0.tgz
./node_modules/.bin/command --help
```
