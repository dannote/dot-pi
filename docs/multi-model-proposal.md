# Proposal: Multi-Model Support via Model Slots/Tags

## Problem

Extensions that need to call LLMs for auxiliary tasks (classification, review, planning) currently have to hardcode a specific model, manually look up API keys via `ctx.modelRegistry.getApiKey()`, and hope the user has that model configured.

There's no way to express "I need a fast/cheap model for this lightweight task" and let the user configure which model fulfills that role.

## Motivation: Decision-Time Guidance

Replit recently published [Decision-Time Guidance: Keeping Replit Agent Reliable](https://blog.replit.com/decision-time-guidance), describing a pattern for improving agent reliability on long trajectories:

> A lightweight multi-label classifier analyzes the agent's current trajectory—user messages, recent tool results, error patterns—and decides which guidance, if any, to inject. The classifier runs on a fast, cheap model, so it can fire on every agent iteration without becoming a bottleneck.

The classifier model should be fast (runs on every turn), cheap (runs frequently), and ideally different from the main model to exploit the generator-discriminator gap and reduce self-preference bias.

This pattern is hard to implement cleanly today because there's no way to request "a fast model" without hardcoding, let users configure which model serves that role, or ensure API keys are available for the secondary model.

## Other Use Cases

The [critic extension](https://github.com/dannote/dot-pi/blob/main/extensions/critic/index.ts) is a shadow reviewer that evaluates agent output using a separate model and feeds critique back. Currently it works around the limitation by spawning a separate pi subprocess — functional but heavyweight.

Other cases: dedicated planning models, summarization for compaction, different models for different tool calls.

## Proposed Solution

### Option A: Named Model Slots

```typescript
// Extension registration
pi.registerModelSlot("classifier", {
  description: "Fast model for trajectory classification",
  defaultHint: { provider: "openai", model: "gpt-4o-mini" },
});

// Extension usage
const model = pi.getModelSlot("classifier");
if (model) {
  const apiKey = await ctx.modelRegistry.getApiKey(model);
  const response = await complete(model, messages, { apiKey });
}

// User configuration (settings.json)
{
  "modelSlots": {
    "classifier": { "provider": "google", "model": "gemini-2.0-flash" }
  }
}
```

### Option B: Tagged Model Registry

```typescript
// User configuration (settings.json)
{
  "modelPreferences": {
    "fast": { "provider": "openai", "model": "gpt-4o-mini" },
    "reasoning": { "provider": "anthropic", "model": "claude-sonnet-4-thinking" },
    "cheap": { "provider": "google", "model": "gemini-2.0-flash" }
  }
}

// Extension usage
const model = ctx.modelRegistry.getPreferred("fast");
const apiKey = await ctx.modelRegistry.getApiKey(model);
const response = await complete(model, messages, { apiKey });

// With fallback chain
const model = ctx.modelRegistry.getPreferred("fast") 
  ?? ctx.modelRegistry.getPreferred("cheap")
  ?? ctx.model;
```

### Option C: Convenience Helper

```typescript
// Use configured "fast" model
const response = await ctx.complete(messages, { 
  prefer: "fast",
  timeout: 3000,
});

// Explicit model
const response = await ctx.complete(messages, {
  model: "openai/gpt-4o-mini",
});

// With fallback
const response = await ctx.complete(messages, {
  prefer: ["fast", "cheap", "primary"],
});
```

## Example: Decision-Time Guidance Extension

With the proposed API:

```typescript
export default function decisionGuidance(pi: ExtensionAPI): void {
  pi.on("context", async (event, ctx) => {
    const trajectory = summarizeTrajectory(ctx.sessionManager.getEntries());
    
    // Call classifier model
    const model = ctx.modelRegistry.getPreferred("fast") ?? ctx.model;
    const apiKey = await ctx.modelRegistry.getApiKey(model);
    
    const classification = await complete(model, [{
      role: "user",
      content: CLASSIFIER_PROMPT + trajectory,
      timestamp: Date.now(),
    }], { apiKey, timeout: 3000 });
    
    const issues = parseClassification(classification);
    if (issues.length === 0) return;
    
    const guidance = issues.map(i => GUIDANCE_RULES[i]).join("\n\n");
    return {
      messages: [...event.messages, {
        role: "user",
        content: [{ type: "text", text: guidance }],
        timestamp: Date.now(),
      }],
    };
  });
}
```

## Questions

1. Should slots be pre-defined or fully dynamic?
2. System-wide defaults or per-extension registration?
3. How to handle missing API keys — fail silently, warn, or error?
4. Should `ctx.complete()` helper be added for convenience?

## References

- [Decision-Time Guidance](https://blog.replit.com/decision-time-guidance) — Replit's blog post
- [critic extension](https://github.com/dannote/dot-pi/blob/main/extensions/critic/index.ts) — shadow reviewer using subprocess workaround
- [decision-guidance.ts](https://github.com/dannote/dot-pi/blob/main/extensions/decision-guidance.ts) — current rule-based implementation (no LLM classifier yet)
