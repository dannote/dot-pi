# Critic Extension

A "shadow reviewer" that evaluates agent output using a separate model with isolated context and feeds critique back to guide further work.

## Features

- **Isolated context** — Critic runs as a separate process, its messages don't pollute the main conversation
- **Visible but filtered** — Critic output displays in TUI but is NOT sent to the main model's context
- **Feedback loop** — Critique is delivered to the agent "as user" to guide improvements
- **Configurable triggers** — Review after each turn, specific tools, or when agent finishes
- **Configurable context** — Control what the critic sees (full reasoning, messages only, or just results)
- **Loop prevention** — Max 3 reviews per user prompt to prevent infinite loops

## Usage

```bash
# Start with critic enabled
pi --critic

# Or toggle in session
/critic
```

### Commands

| Command | Description |
|---------|-------------|
| `/critic` | Toggle critic mode on/off |
| `/critic-model <id>` | Set the model for critic reviews |
| `/critic-prompt` | Edit critic system prompt |
| `/critic-trigger` | Set when critic triggers |
| `/critic-context` | Set what context critic sees |
| `/critic-timeout <s>` | Set timeout in seconds (5-300) |
| `/critic-debug` | Toggle debug logging |

### Flags

| Flag | Description |
|------|-------------|
| `--critic` | Start with critic enabled |
| `--critic-debug` | Enable debug logging |
| `--critic-trigger <mode>` | Set trigger mode (turn_end, tool_result, agent_end, visual) |
| `--critic-model <model>` | Set critic model (format: "provider model_id" or "model_id") |
| `--critic-prompt <text>` | Override default system prompt |
| `--critic-max-reviews <n>` | Max reviews per user prompt (default: 3) |

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        Main Agent Loop                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User Prompt ──► Agent ──► Tool Calls ──► Results ──► Response  │
│                                              │                  │
│                                              ▼                  │
│                                    ┌─────────────────┐          │
│                                    │  Trigger Point  │          │
│                                    │  (configurable) │          │
│                                    └────────┬────────┘          │
│                                             │                   │
└─────────────────────────────────────────────┼───────────────────┘
                                              │
                                              ▼
                              ┌───────────────────────────┐
                              │     Critic Subprocess     │
                              │  (isolated pi instance)   │
                              │                           │
                              │  • Separate model         │
                              │  • Own system prompt      │
                              │  • No shared context      │
                              └─────────────┬─────────────┘
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │      Critic Review        │
                              │                           │
                              │  Approved? ──► Done       │
                              │      │                    │
                              │      ▼                    │
                              │  Issues? ──► Feedback     │
                              └─────────────┬─────────────┘
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │  Display in TUI           │
                              │  (visible to user)        │
                              │                           │
                              │  Filter from LLM context  │
                              │  (invisible to agent)     │
                              └─────────────┬─────────────┘
                                            │
                                            ▼
                              ┌───────────────────────────┐
                              │  Send as User Message     │
                              │  "[Critic feedback]: ..." │
                              │                           │
                              │  Agent continues work     │
                              └───────────────────────────┘
```

## Trigger Modes

### `turn_end` (default)

Triggers after each agent turn completes (after tool results are processed).

```
User ──► Agent ──► Tool ──► Result ──► Agent Response
                                              │
                                              ▼
                                         [CRITIC]
```

### `tool_result`

Triggers after specific tools execute (write, edit, bash by default).

```
User ──► Agent ──► Tool ──► Result ──► [CRITIC] ──► Agent continues
                     │
                     └── Only for: write, edit, bash
```

### `agent_end`

Triggers once when the agent finishes all work.

```
User ──► Agent ──► ... ──► Agent Done
                                │
                                ▼
                           [CRITIC]
```

### `visual`

Triggers after bash commands that create PNG files. **Attaches images to critic** for visual review.

```
User ──► Agent ──► bash (export image) ──► Result + PNG created
                                                   │
                                                   ▼
                                            [CRITIC + IMAGE]
```

Perfect for:
- Figma design review
- Chart/diagram generation
- Screenshot validation
- Any visual output

```bash
# Visual review for Figma work
pi --critic --critic-trigger visual --critic-prompt "You are an art director. Rate this design 1-10. Be harsh."
```

## Context Modes

Control what information the critic receives for review.

### `full`

Critic sees everything including internal reasoning/thinking.

```
┌─────────────────────────────────────┐
│         Critic Receives:            │
├─────────────────────────────────────┤
│  THINKING: Let me analyze this...   │  ◄── Internal reasoning
│  THINKING: I should check for...    │
│  ASSISTANT: Here's my solution...   │  ◄── Response text
│  TOOL CALL: write({"path": ...})    │  ◄── Tool invocations
│  TOOL RESULT: Successfully wrote... │  ◄── Tool outputs
│  USER: Original request...          │  ◄── User messages
└─────────────────────────────────────┘
```

**Use when:** You want the critic to evaluate the agent's reasoning process, not just the output. Good for catching flawed logic or missed considerations.

### `messages` (default)

Critic sees all messages but without thinking/reasoning blocks.

```
┌─────────────────────────────────────┐
│         Critic Receives:            │
├─────────────────────────────────────┤
│  ASSISTANT: Here's my solution...   │  ◄── Response text
│  TOOL CALL: write({"path": ...})    │  ◄── Tool invocations
│  TOOL RESULT: Successfully wrote... │  ◄── Tool outputs
│  USER: Original request...          │  ◄── User messages
└─────────────────────────────────────┘

         ╳ No THINKING blocks
```

**Use when:** You want the critic to focus on what the agent actually did, without being influenced by its internal deliberations. Good for objective code review.

### `results_only`

Critic sees only the final message (last assistant response or tool result).

```
┌─────────────────────────────────────┐
│         Critic Receives:            │
├─────────────────────────────────────┤
│  TOOL RESULT: Successfully wrote... │  ◄── Only the last message
└─────────────────────────────────────┘

         ╳ No conversation history
         ╳ No THINKING blocks
         ╳ No prior messages
```

**Use when:** You want a quick, focused review of just the output. Good for syntax checking, formatting validation, or when context would distract from the immediate result.

## Context Mode Comparison

```
                    ┌──────────────────────────────────────────────┐
                    │              What Critic Sees                │
┌───────────────────┼──────────┬───────────┬───────────┬──────────┤
│      Mode         │ Thinking │ Messages  │ Tools     │ Results  │
├───────────────────┼──────────┼───────────┼───────────┼──────────┤
│ full              │    ✓     │     ✓     │     ✓     │    ✓     │
│ messages          │    ✗     │     ✓     │     ✓     │    ✓     │
│ results_only      │    ✗     │     ✗     │     ✗     │    ✓     │
└───────────────────┴──────────┴───────────┴───────────┴──────────┘
```

## Loop Prevention

To prevent infinite review loops, the critic limits reviews per user prompt:

```
User Prompt
    │
    ▼
Agent Work ──► Critic Review #1 ──► Feedback
    │
    ▼
Agent Work ──► Critic Review #2 ──► Feedback
    │
    ▼
Agent Work ──► Critic Review #3 ──► Feedback
    │
    ▼
Agent Work ──► [MAX REACHED, skip critic]
    │
    ▼
Agent Done
```

Default: 3 reviews per prompt. After reaching the limit:
- If last verdict was `APPROVED`: agent continues normally
- If last verdict was `NEEDS_WORK` or `BLOCKED`: agent is told to stop and ask user for guidance

Override with `--critic-max-reviews <n>`.

## Example Session

```
$ pi --critic --critic-debug

> Fix the bug in utils.ts

[Agent reads file, identifies issue, writes fix]

───────────────────────────────────────────────────────── (yellow border)
 ⚠ Critic Review (gpt-4o)
 The fix addresses the null check but introduces a potential
 issue: the early return on line 42 will skip the cleanup logic
 on line 58. Consider restructuring to ensure cleanup always
 runs.
 ↑1234 ↓567 $0.0023 · 2.1s
─────────────────────────────────────────────────────────

[Agent receives feedback, revises the fix]

───────────────────────────────────────────────────────── (green border)
 ✓ Critic Review (gpt-4o)
 LGTM. The try/finally pattern ensures cleanup runs in all
 cases. Good fix.
 ↑1456 ↓234 $0.0019 · 1.8s
─────────────────────────────────────────────────────────

Done! Fixed the null check bug in utils.ts
```

**Visual indicators:**
- **Yellow border + ⚠** — Issues found, feedback sent to agent
- **Green border + ✓** — Approved, no feedback needed  
- **Red border + ✗** — Error occurred (timeout, process failure)

## Structured Verdict

The critic uses a structured verdict format for reliable decision-making:

```
<critic_verdict>
status: APPROVED | NEEDS_WORK | BLOCKED
</critic_verdict>
```

### Status Values

| Status | Description | Visual | Action |
|--------|-------------|--------|--------|
| `APPROVED` | Work is correct and complete | Green ✓ | No feedback sent |
| `NEEDS_WORK` | Minor issues to address | Yellow ⚠ | Feedback sent to agent |
| `BLOCKED` | Critical issues, cannot proceed | Red ⛔ | Feedback sent to agent |

The critic's review text appears before the verdict block. The verdict block itself is stripped from the displayed output.

### Example Critic Response

```
The code change is correct. The return type annotation matches the 
function's actual return value.

<critic_verdict>
status: APPROVED
</critic_verdict>
```

If the critic doesn't include a verdict block, the extension defaults to `NEEDS_WORK` to be safe.

## Configuration Tips

### Fast iteration with cheap critic
```
/critic-model gpt-4o-mini
/critic-timeout 30
```

### Thorough review with smart critic
```
/critic-model claude-sonnet-4-20250514
/critic-context full
/critic-timeout 120
```

### Security-focused review
```
/critic-prompt
# Edit to focus on security:
# "Review for security vulnerabilities, injection risks, auth issues..."
```

### Visual design review
```bash
pi --critic \
  --critic-trigger visual \
  --critic-model "openrouter google/gemini-2.5-pro" \
  --critic-prompt "You are a brutal art director. Rate 1-10. List ALL problems. Under 40 words. If under 8/10: NEEDS_WORK, else APPROVED." \
  --critic-max-reviews 5
```

### Custom prompt via flag
```bash
# Override system prompt for one-off task
pi --critic --critic-prompt "Focus only on TypeScript type safety. Ignore styling."
```
