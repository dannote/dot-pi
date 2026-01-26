/**
 * Critic Extension
 *
 * A "shadow reviewer" that intercepts agent output at configurable trigger points
 * (like after tool calls), evaluates the result using a separate model with its own
 * isolated context, and feeds critique back to the main agent as if from the user.
 *
 * Key features:
 * - Critic runs in isolated context (its messages don't pollute the main conversation)
 * - Critic output is displayed in the TUI but NOT sent to the main model's context
 * - Critic responds to the main model "as the user" to guide further work
 * - Configurable trigger: after specific tools, after each turn, after agent_end
 * - Configurable context mode: full (with thinking), messages only, or results only
 *
 * Usage:
 *   /critic              - Toggle critic mode
 *   /critic-model <id>   - Set critic model
 *   /critic-prompt       - Edit critic system prompt
 *   /critic-trigger      - Set when critic triggers
 *   /critic-context      - Set what context critic sees
 *   /critic-timeout <s>  - Set timeout in seconds
 *   /critic-debug        - Toggle debug logging
 *   --critic             - Start with critic enabled
 *   --critic-debug       - Enable debug logging
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message, TextContent } from "@mariozechner/pi-ai";
import {
	DynamicBorder,
	type ExtensionAPI,
	type ExtensionContext,
	type TurnEndEvent,
	getMarkdownTheme,
} from "@mariozechner/pi-coding-agent";
import { Container, Input, Key, Markdown, matchesKey, type SelectItem, SelectList, Spacer, Text } from "@mariozechner/pi-tui";

/**
 * Get the command to spawn pi subprocess.
 * Returns { command, args } where args should be prepended to the actual pi args.
 */
function getPiCommand(): { command: string; prefixArgs: string[] } {
	// Check if we're running as a compiled Bun binary
	// In that case, process.execPath IS the pi binary
	const isBunBinary = !process.execPath.includes("node") && !process.execPath.includes("bun");
	
	if (isBunBinary) {
		return { command: process.execPath, prefixArgs: [] };
	}
	
	// Running via node/bun runtime - use same runtime with entry script
	if (process.argv[1]) {
		return { command: process.execPath, prefixArgs: [process.argv[1]] };
	}
	
	// Fallback: try to find pi in PATH
	return { command: "pi", prefixArgs: [] };
}

const piCommand = getPiCommand();

const DEFAULT_CRITIC_PROMPT = `You are a code review critic. Your job is to evaluate the agent's work and provide constructive feedback.

IMPORTANT: Do NOT use any tools. You will be given all the context you need in the user message. Just respond with your review directly.

Review the agent's recent actions and output. Consider:
- Is the approach correct and efficient?
- Are there any bugs, edge cases, or potential issues?
- Is the code clean, readable, and well-structured?
- Are there better alternatives?

## Response Format

You MUST end your response with a verdict block in this exact format:

<critic_verdict>
status: APPROVED | NEEDS_WORK | BLOCKED
</critic_verdict>

Use:
- APPROVED: Work is correct and complete, no issues found
- NEEDS_WORK: Minor issues or suggestions that the agent should address
- BLOCKED: Critical issues that must be fixed before proceeding

Your review text comes BEFORE the verdict block. Keep it concise and actionable.`;

const CRITIC_TRIGGER_TOOLS = ["write", "edit", "bash"];
const DEFAULT_TIMEOUT_MS = 60_000;

interface CriticState {
	enabled: boolean;
	model: string | undefined;
	systemPrompt: string;
	triggerMode: "tool_result" | "turn_end" | "agent_end" | "visual";
	triggerTools: string[];
	timeoutMs: number;
	debug: boolean;
	maxReviewsPerPrompt: number;
	contextMode: "full" | "messages" | "results_only";
}

interface CriticRuntimeState {
	reviewsThisPrompt: number;
	lastUserPromptTime: number;
	isProcessingCritic: boolean;
	lastVerdictApproved: boolean | null;
}

interface CriticResult {
	critique: string;
	approved: boolean;
	status?: "APPROVED" | "NEEDS_WORK" | "BLOCKED";
	model?: string;
	usage?: {
		input: number;
		output: number;
		cost: number;
	};
	error?: string;
	timedOut?: boolean;
	durationMs?: number;
}

interface CriticDetails {
	result: CriticResult;
	context: string;
}

const LOG_FILE = path.join(os.tmpdir(), "pi-critic.log");

function logToFile(level: string, ...args: unknown[]): void {
	const timestamp = new Date().toISOString();
	const message = args.map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" ");
	const line = `[${timestamp}] [${level}] ${message}\n`;
	fs.appendFileSync(LOG_FILE, line);
}

function log(ctx: ExtensionContext, debug: boolean, level: "info" | "warn" | "error", ...args: unknown[]): void {
	// Always log to file for debugging
	logToFile(level, ...args);

	if (!debug && level === "info") return;

	const prefix = `[critic:${level}]`;
	const message = args.map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a))).join(" ");
	const fullMessage = `${prefix} ${message}`;

	// Use UI notifications if available
	if (ctx.hasUI) {
		if (level === "error") {
			ctx.ui.notify(fullMessage, "error");
		} else if (level === "warn") {
			ctx.ui.notify(fullMessage, "warning");
		} else if (debug) {
			ctx.ui.notify(fullMessage, "info");
		}
	}
}

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
	return message.content
		.filter((block): block is TextContent => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

type ContextMode = "full" | "messages" | "results_only";

interface ThinkingContent {
	type: "thinking";
	thinking: string;
}

function isThinkingContent(c: unknown): c is ThinkingContent {
	return typeof c === "object" && c !== null && (c as any).type === "thinking";
}

function formatRecentContext(
	messages: AgentMessage[],
	contextMode: ContextMode,
	maxMessages = 10,
): string {
	// In results_only mode, only show the last message
	const messagesToProcess = contextMode === "results_only" ? messages.slice(-1) : messages.slice(-maxMessages);

	const parts: string[] = [];

	for (const msg of messagesToProcess) {
		if (msg.role === "user") {
			const content =
				typeof msg.content === "string"
					? msg.content
					: msg.content
							.filter((c): c is TextContent => c.type === "text")
							.map((c) => c.text)
							.join("\n");
			parts.push(`USER: ${content}`);
		} else if (msg.role === "assistant" && isAssistantMessage(msg)) {
			// In "full" mode, include thinking content
			if (contextMode === "full") {
				const thinking = msg.content.filter(isThinkingContent);
				for (const t of thinking) {
					parts.push(`THINKING: ${t.thinking}`);
				}
			}

			const text = getTextContent(msg);
			const toolCalls = msg.content.filter((c) => c.type === "toolCall");
			if (toolCalls.length > 0) {
				for (const tc of toolCalls) {
					if (tc.type === "toolCall") {
						parts.push(`TOOL CALL: ${tc.name}(${JSON.stringify(tc.arguments).slice(0, 200)}...)`);
					}
				}
			}
			if (text) {
				parts.push(`ASSISTANT: ${text}`);
			}
		} else if (msg.role === "toolResult") {
			const toolMsg = msg as AgentMessage & { toolName?: string; details?: { diff?: string } };
			const content = msg.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => c.text)
				.join("\n");
			
			// For edit tool, include the diff which shows actual changes
			if (toolMsg.toolName === "edit" && toolMsg.details?.diff) {
				parts.push(`TOOL RESULT (edit) - DIFF:\n${toolMsg.details.diff}`);
			} else {
				const preview = content.length > 500 ? content.slice(0, 500) + "..." : content;
				parts.push(`TOOL RESULT (${toolMsg.toolName || "unknown"}): ${preview}`);
			}
		}
	}

	return parts.join("\n\n");
}

function writePromptToTempFile(prompt: string): { dir: string; filePath: string } {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-critic-"));
	const filePath = path.join(tmpDir, "critic-prompt.md");
	fs.writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
	return { dir: tmpDir, filePath };
}

function cleanupTempFiles(tmpPromptPath: string | null, tmpPromptDir: string | null): void {
	if (tmpPromptPath) {
		try {
			fs.unlinkSync(tmpPromptPath);
		} catch {}
	}
	if (tmpPromptDir) {
		try {
			fs.rmdirSync(tmpPromptDir);
		} catch {}
	}
}

function killProcess(proc: ChildProcess): void {
	try {
		proc.kill("SIGTERM");
		setTimeout(() => {
			if (!proc.killed) {
				proc.kill("SIGKILL");
			}
		}, 3000);
	} catch {}
}

function extractImagePaths(text: string): string[] {
	const patterns = [
		/\/tmp\/[^\s"'<>]+\.png/gi,
		/\/var\/[^\s"'<>]+\.png/gi,
	];
	const paths: string[] = [];
	for (const pattern of patterns) {
		const matches = text.match(pattern) || [];
		paths.push(...matches);
	}
	
	// Filter to existing files only
	return [...new Set(paths)].filter(p => {
		try {
			return fs.statSync(p).isFile();
		} catch {
			return false;
		}
	});
}

function runCriticSync(
	cwd: string,
	systemPrompt: string,
	context: string,
	model: string | undefined,
	timeoutMs: number,
	debug: boolean,
	ctx: ExtensionContext,
	imagePaths?: string[],
): CriticResult {
	const startTime = Date.now();
	const args: string[] = ["--mode", "json", "--no-session", "--no-extensions", "--no-skills", "--no-tools"];
	
	if (model) {
		const parts = model.split(" ");
		if (parts.length === 2) {
			args.push("--provider", parts[0], "--model", parts[1]);
		} else {
			args.push("--model", model);
		}
	}

	const result: CriticResult = {
		critique: "",
		approved: false,
	};

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	try {
		const tmp = writePromptToTempFile(systemPrompt);
		tmpPromptDir = tmp.dir;
		tmpPromptPath = tmp.filePath;
		args.push("--system-prompt", tmpPromptPath);

		// Add image files if provided (using @file syntax)
		if (imagePaths && imagePaths.length > 0) {
			for (const imgPath of imagePaths) {
				args.push(`@${imgPath}`);
			}
			log(ctx, debug, "info", `[sync] Attaching ${imagePaths.length} image(s): ${imagePaths.join(", ")}`);
		}

		const task = `Review the following agent activity and provide feedback:\n\n${context}`;
		args.push("-p", task);

		const fullArgs = [...piCommand.prefixArgs, ...args];
		log(ctx, debug, "info", `[sync] Spawning: ${piCommand.command} ${fullArgs.slice(0, 15).join(" ")}`);
		const spawnResult = spawnSync(piCommand.command, fullArgs, {
			cwd,
			timeout: timeoutMs,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "pipe"],
		});

		if (spawnResult.error) {
			log(ctx, debug, "error", `[sync] Spawn error: ${spawnResult.error.message}`);
			result.error = spawnResult.error.message;
			result.durationMs = Date.now() - startTime;
			return result;
		}

		if (spawnResult.signal === "SIGTERM") {
			log(ctx, debug, "warn", `[sync] Critic timed out after ${timeoutMs}ms`);
			result.timedOut = true;
			result.error = "Critic timed out";
			result.durationMs = Date.now() - startTime;
			return result;
		}

		const stdout = spawnResult.stdout || "";
		const lines = stdout.split("\n").filter(Boolean);
		
		for (const line of lines) {
			try {
				const event = JSON.parse(line);
				if (event.type === "message_end" && event.message?.role === "assistant") {
					const msg = event.message;
					const textContent = msg.content?.find((c: any) => c.type === "text");
					if (textContent?.text) {
						result.critique = textContent.text;
					}
					if (msg.usage) {
						result.usage = {
							input: msg.usage.input || 0,
							output: msg.usage.output || 0,
							cost: msg.usage.cost?.total || 0,
						};
					}
					if (msg.model) result.model = msg.model;
					log(ctx, debug, "info", `[sync] Received assistant message`);
				}
			} catch {
				// Skip non-JSON lines
			}
		}

		result.durationMs = Date.now() - startTime;

		// Parse verdict
		const verdictMatch = result.critique.match(/<critic_verdict>\s*status:\s*(APPROVED|NEEDS_WORK|BLOCKED)\s*<\/critic_verdict>/i);
		if (verdictMatch) {
			const status = verdictMatch[1].toUpperCase() as "APPROVED" | "NEEDS_WORK" | "BLOCKED";
			result.status = status;
			result.approved = status === "APPROVED";
			result.critique = result.critique.replace(/<critic_verdict>[\s\S]*<\/critic_verdict>/i, "").trim();
		} else {
			log(ctx, debug, "warn", "[sync] No verdict block found, defaulting to NEEDS_WORK");
			result.status = "NEEDS_WORK";
			result.approved = false;
		}

		logToFile("verdict", {
			status: result.status,
			hasVerdictBlock: !!verdictMatch,
			approved: result.approved,
			critiqueLength: result.critique.length,
		});

		log(ctx, debug, "info", `[sync] Critic completed: approved=${result.approved}, duration=${result.durationMs}ms`);
		return result;
	} catch (err) {
		result.durationMs = Date.now() - startTime;
		result.error = err instanceof Error ? err.message : String(err);
		result.critique = `(Critic error: ${result.error})`;
		log(ctx, debug, "error", `[sync] Critic exception: ${result.error}`);
		return result;
	} finally {
		cleanupTempFiles(tmpPromptPath, tmpPromptDir);
	}
}

async function runCritic(
	cwd: string,
	systemPrompt: string,
	context: string,
	model: string | undefined,
	timeoutMs: number,
	debug: boolean,
	ctx: ExtensionContext,
	signal?: AbortSignal,
): Promise<CriticResult> {
	const startTime = Date.now();
	const args: string[] = ["--mode", "json", "--no-session", "--no-extensions", "--no-skills", "--no-tools"];
	
	// Parse model in format "provider model_id" (e.g., "openrouter google/gemini-2.5-pro")
	if (model) {
		const parts = model.split(" ");
		if (parts.length === 2) {
			// Format: "provider model_id"
			args.push("--provider", parts[0], "--model", parts[1]);
		} else {
			// Format: just model_id
			args.push("--model", model);
		}
	}

	let tmpPromptDir: string | null = null;
	let tmpPromptPath: string | null = null;

	const result: CriticResult = {
		critique: "",
		approved: false,
	};

	log(ctx, debug, "info", `Starting critic with model=${model || "default"}, timeout=${timeoutMs}ms`);
	log(ctx, debug, "info", `Context length: ${context.length} chars`);
	if (context.length < 2000) {
		log(ctx, debug, "info", `Context:\n${context}`);
	} else {
		log(ctx, debug, "info", `Context (first 1000 chars):\n${context.substring(0, 1000)}...`);
	}

	try {
		const tmp = writePromptToTempFile(systemPrompt);
		tmpPromptDir = tmp.dir;
		tmpPromptPath = tmp.filePath;
		args.push("--system-prompt", tmpPromptPath);

		const task = `Review the following agent activity and provide feedback:\n\n${context}`;
		args.push("-p", task);

		log(ctx, debug, "info", `Spawning pi with args: ${args.slice(0, 5).join(" ")}...`);

		const messages: Message[] = [];
		let stderr = "";
		let wasAborted = false;
		let wasTimedOut = false;

		const exitCode = await new Promise<number>((resolve) => {
			const fullArgs = [...piCommand.prefixArgs, ...args];
			log(ctx, debug, "info", `Full command: ${piCommand.command} ${fullArgs.join(" ").slice(0, 200)}...`);
			
			// Use detached: false and keep refs to ensure subprocess completes before main process exits
			const proc = spawn(piCommand.command, fullArgs, { 
				cwd, 
				shell: false, 
				stdio: ["ignore", "pipe", "pipe"],
				detached: false,
			});
			
			// Explicitly ref stdout/stderr to keep event loop alive
			(proc.stdout as NodeJS.ReadableStream & { ref?: () => void })?.ref?.();
			(proc.stderr as NodeJS.ReadableStream & { ref?: () => void })?.ref?.();
			
			log(ctx, debug, "info", `Subprocess PID: ${proc.pid}`);
			let buffer = "";

			const timeoutId = setTimeout(() => {
				wasTimedOut = true;
				log(ctx, debug, "warn", `Critic timed out after ${timeoutMs}ms`);
				killProcess(proc);
			}, timeoutMs);

			const processLine = (line: string) => {
				if (!line.trim()) return;
				let event: any;
				try {
					event = JSON.parse(line);
				} catch {
					return;
				}

				if (event.type === "message_end" && event.message) {
					const msg = event.message as Message;
					messages.push(msg);
					log(ctx, debug, "info", `Received message: role=${msg.role}`);

					if (msg.role === "assistant") {
						const usage = msg.usage;
						if (usage) {
							result.usage = {
								input: usage.input || 0,
								output: usage.output || 0,
								cost: usage.cost?.total || 0,
							};
						}
						if (msg.model) result.model = msg.model;
					}
				}

				if (event.type === "error") {
					log(ctx, debug, "error", `Critic error event: ${event.message}`);
					result.error = event.message;
				}
			};

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				const chunk = data.toString();
				stderr += chunk;
				if (chunk.trim()) {
					log(ctx, debug, "warn", `Subprocess stderr: ${chunk.slice(0, 200)}`);
				}
			});

			proc.on("close", (code) => {
				log(ctx, debug, "info", `Subprocess closed with code ${code}`);
				clearTimeout(timeoutId);
				if (buffer.trim()) processLine(buffer);
				resolve(code ?? 0);
			});

			proc.on("error", (err) => {
				clearTimeout(timeoutId);
				log(ctx, debug, "error", `Process error: ${err.message}`);
				result.error = err.message;
				resolve(1);
			});

			if (signal) {
				const abortHandler = () => {
					wasAborted = true;
					clearTimeout(timeoutId);
					log(ctx, debug, "info", "Critic aborted by signal");
					killProcess(proc);
				};
				if (signal.aborted) {
					abortHandler();
				} else {
					signal.addEventListener("abort", abortHandler, { once: true });
				}
			}
		});

		result.durationMs = Date.now() - startTime;
		result.timedOut = wasTimedOut;

		if (wasTimedOut) {
			result.error = `Critic timed out after ${timeoutMs}ms`;
			result.critique = "(Critic timed out)";
			return result;
		}

		if (wasAborted) {
			result.error = "Critic was aborted";
			result.critique = "(Critic was aborted)";
			return result;
		}

		if (exitCode !== 0) {
			log(ctx, debug, "warn", `Critic exited with code ${exitCode}, stderr: ${stderr.slice(0, 200)}`);
			if (!result.error) {
				result.error = `Critic process exited with code ${exitCode}`;
			}
		}

		// Extract critique from last assistant message
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role === "assistant") {
				for (const part of msg.content) {
					if (part.type === "text") {
						result.critique = part.text;
						break;
					}
				}
				break;
			}
		}

		if (!result.critique && !result.error) {
			result.error = "Critic returned empty response";
			result.critique = "(No response from critic)";
		}

		// Parse structured verdict from critic response
		const verdictMatch = result.critique.match(/<critic_verdict>\s*status:\s*(APPROVED|NEEDS_WORK|BLOCKED)\s*<\/critic_verdict>/i);
		
		type VerdictStatus = "APPROVED" | "NEEDS_WORK" | "BLOCKED";
		let status: VerdictStatus = "NEEDS_WORK";
		if (verdictMatch) {
			status = verdictMatch[1].toUpperCase() as VerdictStatus;
			// Remove verdict block from displayed critique
			result.critique = result.critique.replace(/<critic_verdict>[\s\S]*<\/critic_verdict>/i, "").trim();
		} else {
			// Fallback: if no verdict block, assume NEEDS_WORK (safer default)
			log(ctx, debug, "warn", "Critic response missing <critic_verdict> block, defaulting to NEEDS_WORK");
		}
		
		result.approved = (status as VerdictStatus) === "APPROVED";
		result.status = status;

		logToFile("verdict", {
			status,
			hasVerdictBlock: !!verdictMatch,
			approved: result.approved,
			critiqueLength: result.critique.length,
		});

		log(
			ctx,
			debug,
			"info",
			`Critic completed: approved=${result.approved}, duration=${result.durationMs}ms, ` +
				`usage=${JSON.stringify(result.usage)}`,
		);

		return result;
	} catch (err) {
		result.durationMs = Date.now() - startTime;
		result.error = err instanceof Error ? err.message : String(err);
		result.critique = `(Critic error: ${result.error})`;
		log(ctx, debug, "error", `Critic exception: ${result.error}`);
		return result;
	} finally {
		cleanupTempFiles(tmpPromptPath, tmpPromptDir);
	}
}

export default function criticExtension(pi: ExtensionAPI): void {
	logToFile("init", "Critic extension loaded");
	
	const state: CriticState = {
		enabled: false,
		model: undefined,
		systemPrompt: DEFAULT_CRITIC_PROMPT,
		triggerMode: "turn_end",
		triggerTools: [...CRITIC_TRIGGER_TOOLS],
		timeoutMs: DEFAULT_TIMEOUT_MS,
		debug: false,
		maxReviewsPerPrompt: 3,
		contextMode: "messages",
	};

	const runtime: CriticRuntimeState = {
		reviewsThisPrompt: 0,
		lastUserPromptTime: 0,
		isProcessingCritic: false,
		lastVerdictApproved: null,
	};

	pi.registerFlag("critic", {
		description: "Start with critic mode enabled",
		type: "boolean",
		default: false,
	});

	pi.registerFlag("critic-debug", {
		description: "Enable critic debug logging",
		type: "boolean",
		default: false,
	});

	pi.registerFlag("critic-trigger", {
		description: "When to trigger critic: turn_end, tool_result, agent_end",
		type: "string",
		default: "turn_end",
	});

	pi.registerFlag("critic-model", {
		description: "Model to use for critic reviews",
		type: "string",
	});

	pi.registerFlag("critic-prompt", {
		description: "System prompt for critic (overrides default)",
		type: "string",
	});

	pi.registerFlag("critic-max-reviews", {
		description: "Maximum critic reviews per user prompt (default: 3)",
		type: "string",
	});

	function updateStatus(ctx: ExtensionContext): void {
		if (state.enabled) {
			const modelId = state.model ?? ctx.model?.id ?? "unknown";
			ctx.ui.setStatus("critic", ctx.ui.theme.fg("warning", `👁  critic (${modelId})`));
		} else {
			ctx.ui.setStatus("critic", undefined);
		}
	}

	function persistState(): void {
		pi.appendEntry("critic-state", {
			enabled: state.enabled,
			model: state.model,
			systemPrompt: state.systemPrompt,
			triggerMode: state.triggerMode,
			triggerTools: state.triggerTools,
			timeoutMs: state.timeoutMs,
			contextMode: state.contextMode,
		});
	}

	async function triggerCritic(ctx: ExtensionContext, contextStr: string, useSync = false): Promise<void> {
		if (!state.enabled) return;

		// Prevent concurrent critic runs
		if (runtime.isProcessingCritic) {
			log(ctx, state.debug, "info", "Skipping critic: already processing");
			return;
		}

		// Prevent infinite loops - limit reviews per user prompt
		if (runtime.reviewsThisPrompt >= state.maxReviewsPerPrompt) {
			log(
				ctx,
				state.debug,
				"warn",
				`Skipping critic: reached max reviews (${state.maxReviewsPerPrompt}) for this prompt`,
			);
			
			// If last review was not approved, stop the agent
			if (runtime.lastVerdictApproved === false) {
				log(ctx, state.debug, "warn", "Max reviews reached with NEEDS_WORK - stopping agent");
				pi.sendUserMessage(
					`[Critic]: STOP. Maximum review attempts (${state.maxReviewsPerPrompt}) reached without approval. Wait for user input before continuing.`,
					{ deliverAs: "steer" }
				);
			}
			return;
		}

		runtime.isProcessingCritic = true;
		runtime.reviewsThisPrompt++;

		log(
			ctx,
			state.debug,
			"info",
			`Triggering critic (mode=${state.triggerMode}, review #${runtime.reviewsThisPrompt}/${state.maxReviewsPerPrompt}, sync=${useSync})`,
		);
		ctx.ui.setWorkingMessage(`Critic reviewing (${runtime.reviewsThisPrompt}/${state.maxReviewsPerPrompt})...`);

		try {
			const criticModel = state.model ?? ctx.model?.id;
			
			// Extract image paths from context to attach to critic
			const imagePaths = extractImagePaths(contextStr);
			if (imagePaths.length > 0) {
				log(ctx, state.debug, "info", `Found ${imagePaths.length} image(s) in context: ${imagePaths.join(", ")}`);
			} else {
				// Log what paths we found in text but couldn't use
				const allMatches = contextStr.match(/\/tmp\/[^\s"'<>]+\.png/gi) || [];
				if (allMatches.length > 0) {
					log(ctx, state.debug, "info", `Found paths in text but not usable: ${allMatches.slice(0, 3).join(", ")}`);
				}
			}
			
			// Use sync version for agent_end to ensure completion before process exits
			const result = useSync
				? runCriticSync(
					ctx.cwd,
					state.systemPrompt,
					contextStr,
					criticModel,
					state.timeoutMs,
					state.debug,
					ctx,
					imagePaths,
				)
				: await runCritic(
					ctx.cwd,
					state.systemPrompt,
					contextStr,
					criticModel,
					state.timeoutMs,
					state.debug,
					ctx,
				);

			// Log approval decision details
			logToFile("decision", {
				approved: result.approved,
				hasError: !!result.error,
				critiquePreview: result.critique.slice(0, 200),
				reviewsThisPrompt: runtime.reviewsThisPrompt,
				maxReviews: state.maxReviewsPerPrompt,
			});

			// Track last verdict for stop-on-max-reviews logic
			runtime.lastVerdictApproved = result.approved;
			
			// Display critic output (visible to user, but NOT in main context)
			logToFile("action", "Displaying critic review in TUI (pi.sendMessage with customType)");
			pi.sendMessage(
				{
					customType: "critic-review",
					content: result.critique,
					display: true,
					details: { result, context: contextStr } as CriticDetails,
				},
				{ triggerTurn: false },
			);

			// If not approved and no error, send critique as user message to guide the agent
			// But only if we haven't hit the review limit
			if (!result.approved && !result.error && result.critique.trim()) {
				if (runtime.reviewsThisPrompt < state.maxReviewsPerPrompt) {
					logToFile("action", "NOT approved - sending feedback to agent via pi.sendUserMessage");
					log(ctx, state.debug, "info", "Sending critic feedback to agent");
					await new Promise((r) => setTimeout(r, 100));
					const feedback = `[Critic feedback]: ${result.critique}`;
					pi.sendUserMessage(feedback, { deliverAs: "followUp" });
				} else {
					logToFile("action", "NOT approved but max reviews reached - skipping feedback");
					log(ctx, state.debug, "info", "Critic has issues but max reviews reached, not sending feedback");
				}
			} else if (result.approved) {
				logToFile("action", "APPROVED - no feedback sent to agent");
				log(ctx, state.debug, "info", "Critic approved the work");
			} else if (result.error) {
				logToFile("action", "ERROR - no feedback sent to agent");
			}
		} catch (err) {
			log(ctx, state.debug, "error", `triggerCritic failed: ${err}`);
		} finally {
			runtime.isProcessingCritic = false;
			ctx.ui.setWorkingMessage();
		}
	}

	// Register custom renderer for critic messages
	pi.registerMessageRenderer<CriticDetails>("critic-review", (message, { expanded }, theme) => {
		const details = message.details;
		const result = details?.result;

		const container = new Container();

		const hasError = !!result?.error;
		const status = result?.status || (result?.approved ? "APPROVED" : "NEEDS_WORK");
		
		let borderColor: "error" | "success" | "warning";
		let icon: string;
		
		if (hasError) {
			borderColor = "error";
			icon = "✗";
		} else if (status === "APPROVED") {
			borderColor = "success";
			icon = "✓";
		} else if (status === "BLOCKED") {
			borderColor = "error";
			icon = "⛔";
		} else {
			borderColor = "warning";
			icon = "⚠";
		}

		// Top border
		container.addChild(new DynamicBorder((s: string) => theme.fg(borderColor, s)));

		// Header line
		let header = `${theme.fg(borderColor, icon)} ${theme.fg(borderColor, theme.bold("Critic Review"))}`;
		if (result?.model) {
			header += ` ${theme.fg("muted", `(${result.model})`)}`;
		}
		if (result?.timedOut) {
			header += ` ${theme.fg("error", "[TIMEOUT]")}`;
		}
		container.addChild(new Text(header, 1, 0));

		if (hasError) {
			container.addChild(new Text(theme.fg("error", `Error: ${result.error}`), 1, 0));
		}

		const mdTheme = getMarkdownTheme();
		const contentText =
			typeof message.content === "string"
				? message.content
				: message.content
						.filter((c): c is TextContent => c.type === "text")
						.map((c) => c.text)
						.join("\n");

		if (contentText && !contentText.startsWith("(")) {
			container.addChild(new Markdown(contentText, 1, 0, mdTheme));
		}

		// Stats line
		const statsParts: string[] = [];
		if (result?.usage) {
			statsParts.push(`↑${result.usage.input} ↓${result.usage.output} $${result.usage.cost.toFixed(4)}`);
		}
		if (result?.durationMs) {
			statsParts.push(`${(result.durationMs / 1000).toFixed(1)}s`);
		}
		if (statsParts.length > 0) {
			container.addChild(new Text(theme.fg("dim", statsParts.join(" · ")), 1, 0));
		}

		// Expanded context view
		if (expanded && details?.context) {
			container.addChild(new Spacer(1));
			container.addChild(new Text(theme.fg("muted", "─── Context ───"), 1, 0));
			container.addChild(new Text(theme.fg("dim", details.context), 1, 0));
		}

		// Bottom border
		container.addChild(new DynamicBorder((s: string) => theme.fg(borderColor, s)));

		return container;
	});

	// Command: toggle critic
	pi.registerCommand("critic", {
		description: "Toggle critic mode",
		handler: async (_args, ctx) => {
			state.enabled = !state.enabled;
			updateStatus(ctx);
			persistState();
			ctx.ui.notify(state.enabled ? "Critic enabled" : "Critic disabled", "info");
		},
	});

	// Command: set critic model
	pi.registerCommand("critic-model", {
		description: "Set the model for critic reviews",
		handler: async (args, ctx) => {
			// If argument provided, use it directly
			if (args.trim()) {
				state.model = args.trim();
				updateStatus(ctx);
				persistState();
				ctx.ui.notify(`Critic model set to: ${state.model}`, "info");
				return;
			}

			// Show interactive model selector
			const models = ctx.modelRegistry.getAvailable();
			if (models.length === 0) {
				ctx.ui.notify("No models available", "error");
				return;
			}

			const items: SelectItem[] = [
				{
					value: "",
					label: "(use default model)",
					description: !state.model ? "✓" : "",
				},
				...models.map((m) => ({
					value: m.id,
					label: m.id,
					description: `[${m.provider}]${state.model === m.id ? " ✓" : ""}`,
				})),
			];

			const result = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
				const container = new Container();

				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
				container.addChild(new Text(theme.fg("accent", theme.bold("Select Critic Model")), 1, 0));
				container.addChild(new Spacer(1));

				const searchInput = new Input();
				container.addChild(searchInput);
				container.addChild(new Spacer(1));

				const selectList = new SelectList(items, Math.min(items.length, 12), {
					selectedPrefix: (t) => theme.fg("accent", t),
					selectedText: (t) => theme.fg("accent", t),
					description: (t) => theme.fg("muted", t),
					scrollInfo: (t) => theme.fg("dim", t),
					noMatch: (t) => theme.fg("warning", t),
				});
				selectList.onSelect = (item) => done(item.value);
				selectList.onCancel = () => done(null);
				searchInput.onSubmit = () => {
					const selected = selectList.getSelectedItem();
					if (selected) done(selected.value);
				};
				container.addChild(selectList);

				container.addChild(new Spacer(1));
				container.addChild(new Text(theme.fg("dim", "↑↓ navigate • type to filter • enter select • esc cancel"), 1, 0));
				container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

				return {
					render: (w) => container.render(w),
					invalidate: () => container.invalidate(),
					handleInput: (data) => {
						// Pass navigation/action keys to selectList, text input to searchInput
						if (
							matchesKey(data, Key.up) ||
							matchesKey(data, Key.down) ||
							matchesKey(data, Key.enter) ||
							matchesKey(data, Key.escape) ||
							matchesKey(data, Key.ctrl("c"))
						) {
							selectList.handleInput(data);
						} else {
							searchInput.handleInput(data);
							selectList.setFilter(searchInput.getValue());
						}
						tui.requestRender();
					},
				};
			});

			if (result !== null) {
				state.model = result || undefined;
				updateStatus(ctx);
				persistState();
				ctx.ui.notify(
					state.model ? `Critic model set to: ${state.model}` : "Critic will use default model",
					"info",
				);
			}
		},
	});

	// Command: edit critic prompt
	pi.registerCommand("critic-prompt", {
		description: "Edit the critic system prompt",
		handler: async (_args, ctx) => {
			const newPrompt = await ctx.ui.editor("Critic System Prompt:", state.systemPrompt);
			if (newPrompt && newPrompt.trim()) {
				state.systemPrompt = newPrompt.trim();
				persistState();
				ctx.ui.notify("Critic prompt updated", "info");
			}
		},
	});

	// Command: configure trigger mode
	pi.registerCommand("critic-trigger", {
		description: "Configure when critic triggers (turn_end, tool_result, agent_end)",
		handler: async (_args, ctx) => {
			const choice = await ctx.ui.select("Critic trigger mode:", [
				"turn_end - After each turn",
				"tool_result - After specific tools",
				"agent_end - When agent finishes",
			]);

			if (choice) {
				const mode = choice.split(" - ")[0] as CriticState["triggerMode"];
				state.triggerMode = mode;
				persistState();
				ctx.ui.notify(`Critic trigger set to: ${mode}`, "info");
			}
		},
	});

	// Command: set timeout
	pi.registerCommand("critic-timeout", {
		description: "Set critic timeout in seconds",
		handler: async (args, ctx) => {
			const seconds = parseInt(args.trim(), 10);
			if (isNaN(seconds) || seconds < 5 || seconds > 300) {
				ctx.ui.notify(`Current timeout: ${state.timeoutMs / 1000}s (valid range: 5-300)`, "info");
				return;
			}
			state.timeoutMs = seconds * 1000;
			persistState();
			ctx.ui.notify(`Critic timeout set to ${seconds}s`, "info");
		},
	});

	// Command: toggle debug
	pi.registerCommand("critic-debug", {
		description: "Toggle critic debug logging",
		handler: async (_args, ctx) => {
			state.debug = !state.debug;
			ctx.ui.notify(`Critic debug: ${state.debug ? "ON" : "OFF"}`, "info");
		},
	});

	// Command: set context mode
	pi.registerCommand("critic-context", {
		description: "Set what context critic sees (full, messages, results_only)",
		handler: async (_args, ctx) => {
			const choice = await ctx.ui.select("Critic context mode:", [
				"full - All messages including thinking/reasoning",
				"messages - All messages without thinking",
				"results_only - Only the last message (final result)",
			]);

			if (choice) {
				const mode = choice.split(" - ")[0] as CriticState["contextMode"];
				state.contextMode = mode;
				persistState();
				ctx.ui.notify(`Critic context mode set to: ${mode}`, "info");
			}
		},
	});

	// Filter out critic messages from context sent to LLM
	pi.on("context", async (event) => {
		return {
			messages: event.messages.filter((m) => {
				const msg = m as AgentMessage & { customType?: string };
				return msg.customType !== "critic-review";
			}),
		};
	});

	// Reset review counter on new user prompt (but not on critic feedback or steer)
	pi.on("before_agent_start", async (event, ctx) => {
		// Only reset if this is a real user prompt, not critic feedback/steer
		if (!event.prompt.startsWith("[Critic")) {
			runtime.reviewsThisPrompt = 0;
			runtime.lastUserPromptTime = Date.now();
			runtime.lastVerdictApproved = null;
			log(ctx, state.debug, "info", "New user prompt detected, reset review counter");
		}
	});

	// Trigger critic after turn_end (default mode)
	pi.on("turn_end", async (event: TurnEndEvent, ctx) => {
		if (!state.enabled || state.triggerMode !== "turn_end") return;

		// Get full conversation history from session, not just current turn
		// This ensures critic sees the actual changes (diffs) not just final message
		const branch = ctx.sessionManager.getBranch();
		const messages: AgentMessage[] = branch
			.filter((e) => e.type === "message" && "message" in e)
			.map((e) => (e as { message: AgentMessage }).message);
		
		const contextStr = formatRecentContext(messages, state.contextMode);

		if (contextStr.trim()) {
			// Use sync to ensure critic completes before process might exit
			await triggerCritic(ctx, contextStr, true);
		}
	});

	// Trigger critic after specific tool results
	pi.on("tool_result", async (event, ctx) => {
		if (!state.enabled) return;
		if (state.triggerMode !== "tool_result" && state.triggerMode !== "visual") return;
		if (!state.triggerTools.includes(event.toolName)) return;

		const content = event.content
			.filter((c): c is TextContent => c.type === "text")
			.map((c) => c.text)
			.join("\n");

		// For "visual" mode, only trigger if a png file was created
		if (state.triggerMode === "visual") {
			const input = JSON.stringify(event.input);
			const allText = input + "\n" + content;
			const imagePaths = extractImagePaths(allText);
			
			if (imagePaths.length === 0) {
				log(ctx, state.debug, "info", `[visual] No images found in tool result, skipping`);
				return;
			}
			
			log(ctx, state.debug, "info", `[visual] Found ${imagePaths.length} image(s) after tool: ${imagePaths.join(", ")}`);
			
			// Get full context for better review
			const branch = ctx.sessionManager.getBranch();
			const messages: AgentMessage[] = branch
				.filter((e) => e.type === "message" && "message" in e)
				.map((e) => (e as { message: AgentMessage }).message);
			const contextStr = formatRecentContext(messages, state.contextMode);
			
			await triggerCritic(ctx, contextStr, true);
			return;
		}

		const contextStr = `Tool: ${event.toolName}\nInput: ${JSON.stringify(event.input)}\nResult:\n${content}`;
		// Use sync to ensure critic completes
		await triggerCritic(ctx, contextStr, true);
	});

	// Trigger critic when agent finishes
	pi.on("agent_end", async (event, ctx) => {
		if (!state.enabled || state.triggerMode !== "agent_end") return;

		const contextStr = formatRecentContext(event.messages, state.contextMode);
		if (contextStr.trim()) {
			// Use sync version to ensure critic completes before process exits
			await triggerCritic(ctx, contextStr, true);
		}
	});

	// Restore state on session start
	pi.on("session_start", async (_event, ctx) => {
		logToFile("event", "session_start triggered");
		logToFile("flags", { 
			critic: pi.getFlag("critic"), 
			criticDebug: pi.getFlag("critic-debug"),
			criticTrigger: pi.getFlag("critic-trigger"),
			criticModel: pi.getFlag("critic-model"),
			criticPrompt: pi.getFlag("critic-prompt") ? "(custom)" : "(default)",
			criticMaxReviews: pi.getFlag("critic-max-reviews"),
		});
		
		if (pi.getFlag("critic") === true) {
			state.enabled = true;
		}
		if (pi.getFlag("critic-debug") === true) {
			state.debug = true;
		}
		
		const triggerFlag = pi.getFlag("critic-trigger");
		if (triggerFlag === "turn_end" || triggerFlag === "tool_result" || triggerFlag === "agent_end" || triggerFlag === "visual") {
			state.triggerMode = triggerFlag;
		}
		
		const modelFlag = pi.getFlag("critic-model");
		if (typeof modelFlag === "string" && modelFlag) {
			state.model = modelFlag;
		}

		const promptFlag = pi.getFlag("critic-prompt");
		if (typeof promptFlag === "string" && promptFlag) {
			state.systemPrompt = promptFlag;
		}
		
		const maxReviewsFlag = pi.getFlag("critic-max-reviews");
		const maxReviews = typeof maxReviewsFlag === "number" ? maxReviewsFlag : parseInt(String(maxReviewsFlag), 10);
		if (!isNaN(maxReviews) && maxReviews > 0) {
			state.maxReviewsPerPrompt = maxReviews;
		}

		const entries = ctx.sessionManager.getEntries();
		const stateEntry = entries
			.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === "critic-state")
			.pop() as { data?: Partial<CriticState> } | undefined;

		if (stateEntry?.data) {
			state.enabled = stateEntry.data.enabled ?? state.enabled;
			state.model = stateEntry.data.model ?? state.model;
			state.systemPrompt = stateEntry.data.systemPrompt ?? state.systemPrompt;
			state.triggerMode = stateEntry.data.triggerMode ?? state.triggerMode;
			state.triggerTools = stateEntry.data.triggerTools ?? state.triggerTools;
			state.timeoutMs = stateEntry.data.timeoutMs ?? state.timeoutMs;
			state.contextMode = stateEntry.data.contextMode ?? state.contextMode;
		}

		updateStatus(ctx);
		log(ctx, state.debug, "info", `Critic initialized: enabled=${state.enabled}, model=${state.model}, trigger=${state.triggerMode}`);
	});
}
