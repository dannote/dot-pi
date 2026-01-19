# Critic Extension Tests

## Quick Start

```bash
cd tests
./run-test.sh <test-name> [main-model] [critic-model]
```

## Available Tests

| Test | Description | What Critic Should Catch |
|------|-------------|-------------------------|
| `buggy-code` | Fix off-by-one errors, null handling | Missed edge cases, incomplete fixes |
| `refactor-task` | Refactor spaghetti code | Poor abstractions, code duplication |
| `security-review` | Fix security vulnerabilities | SQL injection, weak crypto, etc. |

## Example Runs

### Opus as main + Codex as critic
```bash
./run-test.sh buggy-code claude-opus-4-5 gpt-5.2-codex
```

### Sonnet as main + Opus as critic  
```bash
./run-test.sh security-review claude-sonnet-4-5 claude-opus-4-5
```

### Codex as main + Opus as critic
```bash
./run-test.sh refactor-task gpt-5.2-codex claude-opus-4-5
```

## Manual Testing

You can also test manually:

```bash
# Start pi with critic in any directory
pi --model claude-opus-4-5 --critic -e ../index.ts

# Then in pi:
/critic-model gpt-5.2-codex
/critic-trigger   # Choose trigger mode
/critic-prompt    # Edit the prompt
```

## What to Observe

1. **Critic triggers**: Does it run after the right events?
2. **Display**: Are critic messages styled correctly? 
3. **Context isolation**: Critic messages shouldn't affect main conversation
4. **Feedback loop**: Does the agent respond to critic's feedback?
5. **Approval detection**: Does it correctly detect "approved" vs "needs work"?

## Test Scenarios

### Scenario 1: Iterative Improvement
1. Agent makes initial fix
2. Critic finds issue
3. Agent improves based on feedback
4. Critic approves

### Scenario 2: False Positive
1. Agent does good work
2. Critic should approve quickly
3. No unnecessary feedback loop

### Scenario 3: Complex Task
1. Multi-step task
2. Critic reviews each step
3. Final result should be better than without critic
