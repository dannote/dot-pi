---
name: twitter-thread-style
description: Write or revise X/Twitter developer announcement threads in the user's preferred style. Use for technical launch threads, project announcements, release threads, and threads with code screenshots/snippets.
---

# Twitter Thread Style

Use this skill to write developer-facing X/Twitter threads in the user's voice.

This is a generic style skill. Do not bake in one project's facts. Read the current task context, source material, or user notes first, then apply the style rules below.

## Goal

Write a technical announcement thread that works in the timeline.

The reader should be able to understand the project from the first tweet, but the code snippets/screenshots should be what make them stop scrolling.

The thread should feel like a developer showing a real tool, not a company writing a launch page.

## Voice

Prefer:

- plain technical statements
- concrete reasons the thing exists
- direct comparison to a known tool/category when it helps
- understated confidence
- real tradeoffs
- specific capabilities
- attractive code snippets

Avoid:

- slogan speak
- marketing copy
- generic hype
- vague architecture-first explanations
- buzzwords like “unlock”, “seamless”, “delightful”, “empower”, “revolutionary”
- claims that sound bigger than the evidence
- explaining internals before explaining why the reader should care

Bad tone:

```text
This unlocks a delightful new developer experience for modern teams.
```

Better tone:

```text
I wanted the same workflow, but without leaving the stack I already use.
```

## Strict Tweet Shape

Each tweet must follow this shape:

1. A short chunk of text.
2. Then one or more code blocks.

Do not inline code in prose. No backticked identifiers inside the paragraph.

Bad:

```text
Run `my_tool dev` and edit `pages/index.md`.
```

Good:

```text
The dev server is one command.
```

```bash
my_tool dev
```

A tweet can contain multiple code blocks. Use this to increase density.

## First Tweet

The first tweet must be optimized for the timeline.

It should quickly answer:

- what was released
- what familiar category/tool it relates to
- what makes it different
- what the code feels like

The first sentence should be short and direct.

Good patterns:

```text
I published PROJECT.
```

```text
PROJECT is public.
```

```text
FAMILY has a new member: PROJECT.
```

Then use a familiar anchor if possible:

```text
It is like KNOWN_TOOL, but for STACK.
```

```text
I wanted KNOWN_WORKFLOW, but with DIFFERENT_CONSTRAINT.
```

The hook should usually be capability-first, not positioning-first. Lead with what became possible, what shipped, what changed, or what the thing is in familiar terms.

Then show the best code snippet immediately.

## Code Is the Hook

Prioritize snippets that look good as screenshots.

Good snippets usually show:

- compact syntax
- normal language constructs instead of wrapper DSL noise
- typed schemas or validation
- route generation
- small configuration blocks
- pipelines with readable aliases/imports
- components/templates with attractive syntax
- before/after transformation
- one command install/build/dev flow

Use aliases/imports for readability when the language supports them.

Bad:

```elixir
value =
  input
  |> Very.Long.Namespace.Module.step_one()
  |> Very.Long.Namespace.Module.step_two()
```

Better:

```elixir
alias Very.Long.Namespace.Module

value =
  input
  |> Module.step_one()
  |> Module.step_two()
```

Avoid snippets that only show plumbing unless plumbing is the point.

## Text Density

Keep prose short. Let code carry meaning.

A tweet should usually be:

- 1 to 4 short prose lines
- 1 to 3 code blocks

If the prose explains something the code already shows, delete the prose.

## Architecture Comes Later

Do not lead with architecture unless the architecture is the product.

Bad early framing:

```text
The split is intentional.
```

```text
The system has three layers.
```

Better early framing:

```text
The default workflow stays inside one toolchain.
```

```text
The config is just normal language code.
```

Explain architecture through user-visible consequences:

- fewer processes
- fewer config files
- clearer data flow
- better integration with existing tools
- less generated glue
- safer boundaries

## Comparisons

Use comparisons to explain, not to posture.

Good:

```text
I wanted the KNOWN_TOOL workflow, but in STACK.
```

```text
It sits in the same space as KNOWN_TOOL, but the API follows STACK conventions.
```

Avoid:

```text
It is better than KNOWN_TOOL.
```

unless the next line proves a very specific point.

## Concrete Driver

Do not explain a project with abstract positioning first. Explain the concrete driver.

Good drivers include:

- a new capability
- a familiar workflow moved into a different stack
- a measurable improvement
- a missing abstraction extracted from real work
- a new release or integration
- a personal itch or frustration

Examples of good driver shapes:

```text
PROJECT can now DO_THING.
```

```text
I wanted KNOWN_WORKFLOW, but in STACK.
```

```text
I got roughly N× improvement by changing THING.
```

```text
PROJECT now supports INTEGRATION.
```

Do not force every project into a personal-pain story. Pick the real driver for this announcement.

## Story Arc

A good technical announcement thread usually follows this arc:

1. Hook: project/category/difference plus best code.
2. Concrete driver: what became possible, simpler, faster, extracted, or newly supported.
3. Install or minimal usage.
4. Main syntax/API.
5. Data/configuration model.
6. One or two advanced capabilities.
7. Integration with the surrounding ecosystem.
8. Honest limitations or current scope.
9. Links, version, repository/package.

Do not put limitations in the first tweet unless the limitation is central to understanding the project.

## Honesty

Be precise about what exists now and what is future work.

Avoid pretending a roadmap item is implemented.

Good:

```text
This part is static for now. Runtime support needs a separate design.
```

Good:

```text
The first version is small, but the core path works.
```

## When Revising

If the user pushes back, treat it as style data.

Common meanings:

- “Why should the end user care?” means the draft is too architecture-first.
- “Too much slogan speak” means replace marketing phrases with concrete technical facts.
- “No inline code” means prose must not contain backticked identifiers.
- “Use alias for readability” means snippets should be screenshot-readable.
- “Prioritize impressive code snippets” means move the best code earlier and shorten the explanation.
- “Too specific” means abstract the rule; do not force one announcement pattern onto every thread.
- “Generic skill” means remove project-specific facts and keep reusable style rules only.

Do not argue. Rewrite.

## Output Format

Use numbered tweets.

Template:

````text
1/

Short prose. No inline code.

```language
code block
```

```language
optional second code block
```

2/

Short prose.

```language
code block
```
````

Before finalizing, check:

- Does the first tweet have a strong code snippet?
- Is every tweet text-first then code?
- Is there no inline code in prose?
- Is the prose concrete rather than slogan-like?
- Are code snippets readable as screenshots?
- Did the thread explain why the reader should care before internals?
