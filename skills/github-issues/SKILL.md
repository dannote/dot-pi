---
name: github-issues
description: Work with GitHub Issues via gh CLI. Use when user asks to view, triage, fix, or close issues. Covers issue workflows, linking fixes to issues in commits/changelogs/releases, and proper closing etiquette.
---

# GitHub Issues Workflow

## View issue

```bash
gh issue view <number>
```

## Link issues in commits, changelogs, releases

- Commits: `fix: description (#1)` or `fix: description (fixes #1)` — auto-closes on merge to default branch
- Changelog: `([#1](https://github.com/owner/repo/issues/1))`
- Release notes: `fixes #1` — does NOT auto-close, must close manually

## Close with comment

Always thank the reporter and mention the fix version:

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
