/**
 * Decision-Time Guidance Extension
 *
 * Implements Replit's decision-time guidance pattern: inject short, situational
 * instructions exactly when they matter, and only when they matter.
 *
 * Key principles:
 * - Guidance is ephemeral (doesn't persist in conversation history)
 * - Multi-label classifier analyzes trajectory to decide which guidance applies
 * - False positives are cheap (model ignores irrelevant guidance)
 * - Caching stays intact (core prompt never changes)
 *
 * Detects:
 * - Repeated errors in tool output (nudge to read logs)
 * - Doom loops (repeated failures, circular edits)
 * - High-risk changes without confirmation
 * - Stuck patterns (same tool called repeatedly with similar args)
 *
 * Based on: https://blog.replit.com/decision-time-guidance
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
	AssistantMessage,
	TextContent,
	ToolCall as LLMToolCall,
	ToolResultMessage,
} from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

interface GuidanceRule {
	id: string;
	description: string;
	detect: (ctx: TrajectoryContext) => boolean;
	guidance: string;
	priority: number;
}

interface TrajectoryContext {
	recentMessages: AgentMessage[];
	recentToolCalls: ToolCall[];
	recentErrors: ErrorInfo[];
	turnCount: number;
	lastAssistantText: string;
}

interface ToolCall {
	name: string;
	input: Record<string, unknown>;
	result?: string;
	isError?: boolean;
	turnIndex: number;
}

interface ErrorInfo {
	source: "bash" | "tool" | "console";
	message: string;
	turnIndex: number;
}

const MAX_GUIDANCE_INJECTIONS = 2;
const RECENT_TURNS_WINDOW = 5;

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function isToolResultMessage(m: AgentMessage): m is ToolResultMessage {
	return m.role === "toolResult";
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function getToolCalls(message: AssistantMessage): LLMToolCall[] {
	return message.content.filter((block): block is LLMToolCall => block.type === "toolCall");
}

const GUIDANCE_RULES: GuidanceRule[] = [
	{
		id: "repeated-errors",
		description: "Detect repeated errors in recent turns",
		priority: 10,
		detect: (ctx) => {
			const recentErrors = ctx.recentErrors.filter(
				(e) => e.turnIndex >= ctx.turnCount - 3,
			);
			if (recentErrors.length < 2) return false;

			const errorPatterns = new Map<string, number>();
			for (const error of recentErrors) {
				const pattern = error.message.slice(0, 50);
				errorPatterns.set(pattern, (errorPatterns.get(pattern) ?? 0) + 1);
			}
			return Array.from(errorPatterns.values()).some((count) => count >= 2);
		},
		guidance: `[GUIDANCE] Detected repeated errors in recent tool calls. Before continuing:
1. Review the error messages carefully
2. Identify the root cause (don't just retry the same approach)
3. Consider alternative approaches if the current path keeps failing`,
	},

	{
		id: "doom-loop",
		description: "Detect circular/stuck behavior",
		priority: 9,
		detect: (ctx) => {
			const recentCalls = ctx.recentToolCalls.filter(
				(c) => c.turnIndex >= ctx.turnCount - 4,
			);
			if (recentCalls.length < 3) return false;

			const callSignatures = recentCalls.map((c) => {
				const inputStr = JSON.stringify(c.input).slice(0, 100);
				return `${c.name}:${inputStr}`;
			});

			const signatureCounts = new Map<string, number>();
			for (const sig of callSignatures) {
				signatureCounts.set(sig, (signatureCounts.get(sig) ?? 0) + 1);
			}

			return Array.from(signatureCounts.values()).some((count) => count >= 3);
		},
		guidance: `[GUIDANCE] Detected possible doom loop - similar operations repeated multiple times.
STOP and reassess:
1. What outcome are you trying to achieve?
2. Why isn't the current approach working?
3. What alternative approach could succeed?
Consider stepping back to understand the problem differently.`,
	},

	{
		id: "edit-failures",
		description: "Detect repeated edit tool failures",
		priority: 8,
		detect: (ctx) => {
			const recentEdits = ctx.recentToolCalls.filter(
				(c) => c.name === "edit" && c.turnIndex >= ctx.turnCount - 3,
			);
			const failedEdits = recentEdits.filter((c) => c.isError);
			return failedEdits.length >= 2;
		},
		guidance: `[GUIDANCE] Multiple edit operations have failed. Common causes:
- The oldText doesn't match exactly (whitespace, line endings matter)
- The file was modified between read and edit
- Trying to edit content that doesn't exist

Try: Read the file again to get the exact current content before editing.`,
	},

	{
		id: "bash-errors",
		description: "Detect repeated bash command failures",
		priority: 7,
		detect: (ctx) => {
			const recentBash = ctx.recentToolCalls.filter(
				(c) => c.name === "bash" && c.turnIndex >= ctx.turnCount - 3,
			);
			const failedBash = recentBash.filter((c) => c.isError);
			return failedBash.length >= 2;
		},
		guidance: `[GUIDANCE] Multiple bash commands have failed. Consider:
- Check if required tools/binaries are installed
- Verify working directory and file paths
- Check environment variables and permissions
- Read error output carefully for specific hints`,
	},

	{
		id: "long-trajectory",
		description: "Detect long trajectories that may need compaction",
		priority: 3,
		detect: (ctx) => ctx.turnCount > 20,
		guidance: `[GUIDANCE] This is a long conversation. Consider:
- Summarize progress so far if the context is getting cluttered
- Focus on the immediate next step rather than re-explaining history
- If stuck, consider starting fresh with lessons learned`,
	},

	{
		id: "no-progress",
		description: "Detect lack of progress (errors with no successful operations)",
		priority: 6,
		detect: (ctx) => {
			const lastTurns = ctx.recentToolCalls.filter(
				(c) => c.turnIndex >= ctx.turnCount - 3,
			);
			if (lastTurns.length < 3) return false;
			return lastTurns.every((c) => c.isError);
		},
		guidance: `[GUIDANCE] No successful operations in recent turns. This suggests a fundamental issue.
PAUSE and reconsider:
1. Is the current approach viable at all?
2. Are there missing prerequisites or dependencies?
3. Should you ask the user for clarification?
Sometimes the best action is to ask for help rather than keep trying.`,
	},

	{
		id: "file-not-found",
		description: "Detect repeated file not found errors",
		priority: 7,
		detect: (ctx) => {
			const fileErrors = ctx.recentErrors.filter(
				(e) =>
					e.turnIndex >= ctx.turnCount - 3 &&
					(e.message.toLowerCase().includes("no such file") ||
						e.message.toLowerCase().includes("not found") ||
						e.message.toLowerCase().includes("does not exist")),
			);
			return fileErrors.length >= 2;
		},
		guidance: `[GUIDANCE] Multiple "file not found" errors detected. Before continuing:
- Use 'find' or 'ls' to explore the actual directory structure
- Check if you're in the correct working directory
- Verify file names and paths (case sensitivity matters)`,
	},

	{
		id: "syntax-errors",
		description: "Detect repeated syntax/parse errors",
		priority: 8,
		detect: (ctx) => {
			const syntaxErrors = ctx.recentErrors.filter(
				(e) =>
					e.turnIndex >= ctx.turnCount - 3 &&
					(e.message.toLowerCase().includes("syntax error") ||
						e.message.toLowerCase().includes("parse error") ||
						e.message.toLowerCase().includes("unexpected token")),
			);
			return syntaxErrors.length >= 2;
		},
		guidance: `[GUIDANCE] Repeated syntax/parse errors detected. Consider:
- Read the file to see the current state (edits may have corrupted it)
- Check for unclosed brackets, quotes, or template literals
- Ensure proper escaping of special characters
- Consider reverting to a known good state if edits have gone wrong`,
	},
];

function buildTrajectoryContext(
	entries: unknown[],
	currentTurnCount: number,
): TrajectoryContext {
	const recentMessages: AgentMessage[] = [];
	const recentToolCalls: ToolCall[] = [];
	const recentErrors: ErrorInfo[] = [];
	let lastAssistantText = "";

	let turnIndex = 0;

	for (const entry of entries) {
		const e = entry as { type: string; message?: AgentMessage };
		if (e.type !== "message" || !e.message) continue;

		const msg = e.message;

		if (msg.role === "user") {
			turnIndex++;
		}

		if (turnIndex < currentTurnCount - RECENT_TURNS_WINDOW) continue;

		recentMessages.push(msg);

		if (isAssistantMessage(msg)) {
			lastAssistantText = getTextContent(msg);
			for (const toolCall of getToolCalls(msg)) {
				recentToolCalls.push({
					name: toolCall.name,
					input: toolCall.arguments as Record<string, unknown>,
					turnIndex,
				});
			}
		}

		if (isToolResultMessage(msg)) {
			const lastCall = recentToolCalls.filter((c) => c.name === msg.toolName).pop();
			if (lastCall) {
				const content = msg.content;
				const text =
					typeof content === "string"
						? content
						: Array.isArray(content)
							? content
									.filter((c): c is TextContent => c.type === "text")
									.map((c) => c.text)
									.join("\n")
							: "";
				lastCall.result = text;
				lastCall.isError = msg.isError;

				if (msg.isError && text) {
					recentErrors.push({
						source: msg.toolName === "bash" ? "bash" : "tool",
						message: text,
						turnIndex,
					});
				}
			}
		}
	}

	return {
		recentMessages,
		recentToolCalls,
		recentErrors,
		turnCount: currentTurnCount,
		lastAssistantText,
	};
}

function classifyTrajectory(ctx: TrajectoryContext): GuidanceRule[] {
	const matchedRules = GUIDANCE_RULES.filter((rule) => {
		try {
			return rule.detect(ctx);
		} catch {
			return false;
		}
	});

	return matchedRules.sort((a, b) => b.priority - a.priority).slice(0, MAX_GUIDANCE_INJECTIONS);
}

export default function decisionGuidance(pi: ExtensionAPI): void {
	let turnCount = 0;
	let lastInjectedGuidance: string[] = [];

	pi.on("session_start", async (_event, ctx) => {
		turnCount = 0;
		const entries = ctx.sessionManager.getEntries();
		for (const entry of entries) {
			const e = entry as { type: string; message?: AgentMessage };
			if (e.type === "message" && e.message?.role === "user") {
				turnCount++;
			}
		}
	});

	pi.on("turn_start", async () => {
		turnCount++;
		lastInjectedGuidance = [];
	});

	pi.on("context", async (event, ctx) => {
		if (turnCount < 3) return;

		const entries = ctx.sessionManager.getEntries();
		const trajectoryCtx = buildTrajectoryContext(entries, turnCount);
		const matchedRules = classifyTrajectory(trajectoryCtx);

		if (matchedRules.length === 0) return;

		lastInjectedGuidance = matchedRules.map((r) => r.id);

		const guidanceText = matchedRules.map((r) => r.guidance).join("\n\n");

		const guidanceMessage: AgentMessage = {
			role: "user",
			content: [{ type: "text", text: guidanceText }],
			timestamp: Date.now(),
		};

		return {
			messages: [...event.messages, guidanceMessage],
		};
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (lastInjectedGuidance.length > 0 && ctx.hasUI) {
			const ruleIds = lastInjectedGuidance.join(", ");
			ctx.ui.setStatus(
				"guidance",
				ctx.ui.theme.fg("warning", `⚡ guidance: ${ruleIds}`),
			);

			setTimeout(() => {
				ctx.ui.setStatus("guidance", undefined);
			}, 5000);
		}
	});

	pi.registerCommand("guidance", {
		description: "Show active decision-time guidance rules",
		handler: async (_args, ctx) => {
			const entries = ctx.sessionManager.getEntries();
			const trajectoryCtx = buildTrajectoryContext(entries, turnCount);
			const matchedRules = classifyTrajectory(trajectoryCtx);

			if (matchedRules.length === 0) {
				ctx.ui.notify("No guidance rules currently active", "info");
				return;
			}

			const lines = matchedRules.map(
				(r) => `• ${r.id} (priority ${r.priority}): ${r.description}`,
			);
			ctx.ui.notify(`Active guidance:\n${lines.join("\n")}`, "info");
		},
	});

	pi.registerCommand("guidance-test", {
		description: "Show trajectory analysis without injecting guidance",
		handler: async (_args, ctx) => {
			const entries = ctx.sessionManager.getEntries();
			const trajectoryCtx = buildTrajectoryContext(entries, turnCount);

			const stats = [
				`Turn count: ${trajectoryCtx.turnCount}`,
				`Recent tool calls: ${trajectoryCtx.recentToolCalls.length}`,
				`Recent errors: ${trajectoryCtx.recentErrors.length}`,
			];

			const matchedRules = GUIDANCE_RULES.filter((rule) => {
				try {
					return rule.detect(trajectoryCtx);
				} catch {
					return false;
				}
			});

			const ruleStatus = GUIDANCE_RULES.map((rule) => {
				const matched = matchedRules.includes(rule);
				const icon = matched ? "✓" : "○";
				return `${icon} ${rule.id} (p${rule.priority})`;
			});

			ctx.ui.notify(`Trajectory Analysis:\n${stats.join("\n")}\n\nRules:\n${ruleStatus.join("\n")}`, "info");
		},
	});
}
