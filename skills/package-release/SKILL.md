---
name: package-release
description: Prepare, publish, repair, or verify package releases and changelogs. Always use for package/version release, publish, ship, tag, changelog, release notes, registry publication, documentation publication, or GitHub Release work. Distinguish package releases from application deployments before acting.
---

# Package Releases

Release notes are user documentation. `CHANGELOG.md` is their canonical source. Never invent a second narrative during publication.

## Classify the request

- **Update the changelog** — edit `Unreleased` only. Do not bump, tag, push, or publish.
- **Prepare a release** — bump/align versions, roll the changelog, validate, and stop before irreversible actions.
- **Release / publish / ship** — complete every applicable release output: package, package documentation, tag, GitHub Release, and public verification. Do not stop after publishing only one artifact.
- **Repair a release** — derive missing or corrected metadata from the tagged changelog; do not generate replacement prose.
- **Deploy** — this skill does not define application deployment. Clarify when “release” could mean an OTP/app deployment rather than a package version.

A direct request to release, publish, ship, or cut a version authorizes the complete workflow after a clean preflight. Ask only when the version or intent is ambiguous, repository state is unexpected, project instructions require confirmation, or authentication/2FA is needed.

## Non-negotiable release-note contract

- GitHub Release title is exactly the tag, normally `vX.Y.Z`.
- GitHub Release body is exactly the body of the matching `CHANGELOG.md` version section, excluding the level-two version heading.
- Do not add an opening summary, closing sentence, generated prose, commit list, contributor list, checksum, or publication status.
- Do not add Install/Installation sections or dependency snippets.
- Do not append Hex, HexDocs, npm, crates.io, changelog, compare, marketing, or “full changelog” links.
- Never use generated GitHub notes (`--generate-notes`).
- Never embellish terse changelog notes.
- Always pass multiline notes through a file with `--notes-file`; never inline Markdown in `--notes` or a shell string.
- Never use regex, `awk`, or `sed` to determine Markdown section boundaries. Read the Markdown structure directly or use the repository’s canonical parser/extractor.
- Preserve directly relevant issue, pull-request, migration, or security links already present in the canonical changelog. Do not add links during release publication.

## Changelog audience

Every entry must answer:

> What changed for a package user deciding whether or how to upgrade?

Include:

- New public behavior or APIs
- Changed behavior
- User-visible bug fixes
- Observable performance improvements
- Compatibility and platform changes
- Deprecations, removals, security changes, and migration requirements

Exclude:

- Test additions, test counts, CI status, or quality-gate output
- Corpus, calibration, benchmark-gate, precision-ratchet, or release-gate results
- Checksums, publication status, and generated documentation status
- Local paths, path dependencies, dogfooding setup, and maintainer workstation state
- Release preparation and internal workflow changes
- Internal refactors without a user-visible outcome
- Dependency/lockfile updates without compatibility, security, or behavioral impact
- Temporary operational details and implementation-specific validation

Describe internal work through its user-visible outcome. For example, write “Improved analysis performance on large diffs,” not how many packages or tests were used to validate it.

## Canonical changelog format

Use this format for new owned-project release sections unless repository instructions or an upstream fork require preserving another established format:

```markdown
# Changelog

## Unreleased

## 1.2.3 - 2026-07-20

### Breaking changes

- ...

### Added

- ...

### Changed

- ...

### Deprecated

- ...

### Removed

- ...

### Fixed

- ...

### Security

- ...

### Compatibility

- ...
```

Rules:

- Version headings do not include `v`; tags normally do.
- Dates use ISO `YYYY-MM-DD`.
- Keep releases in reverse chronological order.
- Keep an `Unreleased` section at the top.
- Omit empty categories.
- Use only the categories above, in the order above.
- Put upgrade-required source/config/data changes under `Breaking changes`, including for `0.x` packages. Do not duplicate them under `Changed` or `Removed`.
- Use `Compatibility` only for supported Elixir/OTP/runtime/framework versions, operating systems, architectures, or explicit interoperability boundaries—not ordinary dependency bumps.
- Do not use `New`, `Improved`, `Highlights`, `Fixes`, `What's New`, `Tests`, `Validation`, `Links`, or project-specific release headings.
- Do not rewrite historical sections merely to adopt the standard. Normalize `Unreleased` and future releases prospectively.
- Preserve upstream changelog conventions in maintained forks, while still enforcing the audience and exact-release-body rules.

## Discover project release mechanics

Before choosing commands, inspect:

1. Repository instructions (`AGENTS.md`, contributing/release docs)
2. Working-tree and remote synchronization state
3. Current package version(s) and intended tag
4. `CHANGELOG.md` and the exact target section
5. Package manifests and package file lists
6. Tag-triggered workflows and reusable release workflows
7. Existing tag and GitHub Release state
8. Registry authentication and required 2FA

Respect project-specific publication mechanics. They may change command order; they do not override the release-note audience contract.

Common topologies:

- **Manual registry release** — validate, publish package/docs, push the correct tag, create the GitHub Release.
- **Tag-triggered publication** — push the prepared commit and tag, watch the workflow, then verify every output. Do not duplicate local publication.
- **Precompiled/native artifacts** — tag may create the GitHub asset release first. Wait for required assets/checksums, complete package publication, then edit the existing GitHub Release to the canonical title/body instead of creating another release.
- **Monorepo** — determine version alignment, package-specific versus shared tags/changelogs, and every package expected to publish before acting.

Never force-move a release tag unless the user explicitly approves and the project’s release process permits it. Prefer a corrective patch release when immutable artifacts may already exist.

## Prepare and review notes

Before the first irreversible action:

1. Read the target level-two changelog section.
2. Copy only its body to `/tmp/<package>-<version>-release-notes.md`.
3. Read the temporary file back.
4. Reject it if it violates the audience or heading rules.
5. Confirm the package version, commit, tag, release topology, exact title, and exact body.

Show the exact body when it was drafted or changed during the current task. Do not present a separate model-written summary as proposed release notes.

## Publish

Use repository-specific commands. For GitHub, use the notes file:

```bash
gh release create "$tag" \
  --verify-tag \
  --title "$tag" \
  --notes-file "$notes_file"
```

If an artifact workflow already created the release:

```bash
gh release edit "$tag" \
  --title "$tag" \
  --notes-file "$notes_file"
```

Set prerelease/latest state according to the version and project policy. Do not add body text to communicate those states.

If a registry requests 2FA, stop and ask for the current code. Do not retry stale codes or claim publication succeeded after an authentication failure.

## Verify before declaring success

A release is complete only after verifying every applicable item:

- Registry version exists and has the intended metadata
- Package documentation exists
- Remote tag points to the intended commit
- GitHub Release exists for the tag
- Release title exactly equals the tag
- Release body exactly equals the changelog section body
- Draft/prerelease/latest state is correct
- Required native/binary assets exist
- Publish workflows succeeded
- Working tree has no accidental release-created changes
- Downstream dogfood projects no longer use temporary local path dependencies

Use `gh release view "$tag" --json name,tagName,body,isDraft,isPrerelease` and compare the returned body directly with the prepared notes file. If they differ, repair the release before reporting completion.

## Final response

Report only concrete outcomes:

- Version/package published
- Documentation published
- Tag pushed
- GitHub Release created or repaired
- Relevant release checks completed
- Any downstream version update
- Clean/synchronized repository state

Do not reproduce release-note boilerplate or add promotional/footer links unless the user asks.
