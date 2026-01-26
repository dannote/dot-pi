/**
 * Git Worktrees Extension
 *
 * Provides tools for managing git worktrees, enabling isolated workspaces
 * for parallel agent work. Each worktree has its own branch and working
 * directory, perfect for running multiple subagents simultaneously.
 *
 * Features:
 * - Create/list/remove worktrees via tools
 * - Auto-detect and run project setup (bun, npm, cargo, etc.)
 * - Status widget showing active worktrees
 * - System prompt injection for LLM awareness
 *
 * Usage with subagent:
 *   1. worktree_create(name: "fix-auth")
 *   2. worktree_create(name: "add-feature")
 *   3. subagent(tasks: [
 *        { agent: "worker", task: "...", cwd: ".worktrees/fix-auth" },
 *        { agent: "worker", task: "...", cwd: ".worktrees/add-feature" },
 *      ])
 *   4. Review changes, merge branches
 *   5. worktree_remove("fix-auth"), worktree_remove("add-feature")
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getSelectListTheme } from "@mariozechner/pi-coding-agent";
import { type Component, Key, matchesKey, type SelectItem, SelectList, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

interface WorktreeInfo {
	path: string;
	branch: string;
	created: number;
	setupCompleted: boolean;
}

interface WorktreeDetails {
	name: string;
	path: string;
	branch: string;
}

interface WorktreeListDetails {
	worktrees: Array<{
		path: string;
		branch: string;
		head: string;
		bare: boolean;
	}>;
}

export default function worktreesExtension(pi: ExtensionAPI) {
	const worktrees = new Map<string, WorktreeInfo>();
	const WORKTREES_DIR = ".worktrees";

	function updateStatusWidget(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		const theme = ctx.ui.theme;
		const count = worktrees.size;

		if (count === 0) {
			ctx.ui.setStatus("worktrees", undefined);
			return;
		}

		// Footer status: count + current worktree name
		const icon = theme.fg("accent", "⎇");
		const names = Array.from(worktrees.keys()).join(", ");
		const text = theme.fg("dim", ` ${count}: ${names}`);
		ctx.ui.setStatus("worktrees", icon + text);
	}

	async function ensureGitignore(cwd: string): Promise<{ added: boolean; error?: string }> {
		const gitignorePath = join(cwd, ".gitignore");

		try {
			// Check if .worktrees is already ignored
			const result = await pi.exec("git", ["check-ignore", "-q", WORKTREES_DIR], { cwd });
			if (result.code === 0) {
				return { added: false };
			}
		} catch {
			// Not ignored, continue to add
		}

		// Add to .gitignore
		try {
			const existingContent = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
			const newline = existingContent.endsWith("\n") || existingContent === "" ? "" : "\n";
			const entry = `${newline}# Git worktrees for parallel agent work\n${WORKTREES_DIR}/\n`;

			appendFileSync(gitignorePath, entry);
			return { added: true };
		} catch (err) {
			return { added: false, error: `Failed to update .gitignore: ${err}` };
		}
	}

	async function detectAndRunSetup(worktreePath: string, onUpdate?: (text: string) => void): Promise<string[]> {
		const steps: string[] = [];

		const lockFiles = [
			{ file: "bun.lock", cmd: "bun", args: ["install"] },
			{ file: "bun.lockb", cmd: "bun", args: ["install"] },
			{ file: "pnpm-lock.yaml", cmd: "pnpm", args: ["install"] },
			{ file: "yarn.lock", cmd: "yarn", args: ["install"] },
			{ file: "package-lock.json", cmd: "npm", args: ["install"] },
			{ file: "package.json", cmd: "bun", args: ["install"] }, // Default to bun
		];

		// JavaScript/TypeScript
		for (const { file, cmd, args } of lockFiles) {
			if (existsSync(join(worktreePath, file))) {
				onUpdate?.(`Running ${cmd} ${args.join(" ")}...`);
				const result = await pi.exec(cmd, args, { cwd: worktreePath, timeout: 120000 });
				if (result.code === 0) {
					steps.push(`${cmd} ${args.join(" ")}`);
				} else {
					steps.push(`${cmd} ${args.join(" ")} (failed: ${result.code})`);
				}
				break;
			}
		}

		// Rust
		if (existsSync(join(worktreePath, "Cargo.toml"))) {
			onUpdate?.("Running cargo build...");
			const result = await pi.exec("cargo", ["build"], { cwd: worktreePath, timeout: 300000 });
			if (result.code === 0) {
				steps.push("cargo build");
			} else {
				steps.push(`cargo build (failed: ${result.code})`);
			}
		}

		// Go
		if (existsSync(join(worktreePath, "go.mod"))) {
			onUpdate?.("Running go mod download...");
			const result = await pi.exec("go", ["mod", "download"], { cwd: worktreePath, timeout: 60000 });
			if (result.code === 0) {
				steps.push("go mod download");
			} else {
				steps.push(`go mod download (failed: ${result.code})`);
			}
		}

		// Python
		if (existsSync(join(worktreePath, "requirements.txt"))) {
			// Check for uv first
			const uvCheck = await pi.exec("which", ["uv"]);
			if (uvCheck.code === 0) {
				onUpdate?.("Running uv pip install...");
				const result = await pi.exec("uv", ["pip", "install", "-r", "requirements.txt"], {
					cwd: worktreePath,
					timeout: 120000,
				});
				steps.push(result.code === 0 ? "uv pip install" : `uv pip install (failed: ${result.code})`);
			} else {
				onUpdate?.("Running pip install...");
				const result = await pi.exec("pip", ["install", "-r", "requirements.txt"], {
					cwd: worktreePath,
					timeout: 120000,
				});
				steps.push(result.code === 0 ? "pip install" : `pip install (failed: ${result.code})`);
			}
		}

		return steps;
	}

	// ============ TOOLS ============

	pi.registerTool({
		name: "worktree_create",
		label: "Create Worktree",
		description: `Create an isolated git worktree for parallel work.
Use when you need to work on multiple independent tasks simultaneously.
Each worktree has its own branch and working directory.
Returns the full path to use as cwd for subsequent commands or subagent tasks.

The worktree is created in .worktrees/<name> with a new branch.
Project setup (npm/bun/cargo/etc.) runs automatically.`,
		parameters: Type.Object({
			name: Type.String({ description: "Short name for the worktree (used as directory and branch name)" }),
			baseBranch: Type.Optional(Type.String({ description: "Branch to base off (default: current HEAD)" })),
		}),
		async execute(_toolCallId, params, onUpdate, ctx, _signal) {
			const { name, baseBranch } = params;
			const worktreePath = join(ctx.cwd, WORKTREES_DIR, name);

			// Check if worktree already exists
			if (worktrees.has(name) || existsSync(worktreePath)) {
				return {
					content: [{ type: "text", text: `Worktree "${name}" already exists at: ${worktreePath}` }],
					details: { name, path: worktreePath, branch: name } satisfies WorktreeDetails,
					isError: true,
				};
			}

			// Ensure .worktrees is in .gitignore
			const gitignoreResult = await ensureGitignore(ctx.cwd);
			let output = "";

			if (gitignoreResult.error) {
				return {
					content: [{ type: "text", text: gitignoreResult.error }],
					details: { name, path: worktreePath, branch: name } satisfies WorktreeDetails,
					isError: true,
				};
			}

			if (gitignoreResult.added) {
				output += `Added ${WORKTREES_DIR}/ to .gitignore\n`;
			}

			// Create the worktree
			onUpdate?.({
				content: [{ type: "text", text: "Creating worktree..." }],
				details: { name, path: worktreePath, branch: name },
			});

			const args = ["worktree", "add", join(WORKTREES_DIR, name), "-b", name];
			if (baseBranch) {
				args.push(baseBranch);
			}

			const createResult = await pi.exec("git", args, { cwd: ctx.cwd });
			if (createResult.code !== 0) {
				const error = createResult.stderr || createResult.stdout || "Unknown error";
				return {
					content: [{ type: "text", text: `Failed to create worktree: ${error}` }],
					details: { name, path: worktreePath, branch: name } satisfies WorktreeDetails,
					isError: true,
				};
			}

			output += `Created worktree at: ${worktreePath}\n`;
			output += `Branch: ${name}${baseBranch ? ` (based on ${baseBranch})` : ""}\n`;

			// Track worktree
			worktrees.set(name, {
				path: worktreePath,
				branch: name,
				created: Date.now(),
				setupCompleted: false,
			});
			updateStatusWidget(ctx);

			// Run project setup
			onUpdate?.({
				content: [{ type: "text", text: `${output}Running project setup...` }],
				details: { name, path: worktreePath, branch: name },
			});

			const setupSteps = await detectAndRunSetup(worktreePath, (text) => {
				onUpdate?.({
					content: [{ type: "text", text: output + text }],
					details: { name, path: worktreePath, branch: name },
				});
			});

			if (setupSteps.length > 0) {
				output += `Setup completed: ${setupSteps.join(", ")}\n`;
			} else {
				output += "No project setup needed\n";
			}

			// Mark setup as complete
			const info = worktrees.get(name);
			if (info) {
				info.setupCompleted = true;
			}
			updateStatusWidget(ctx);

			output += `\nWorktree "${name}" ready at: ${worktreePath}`;

			return {
				content: [{ type: "text", text: output }],
				details: { name, path: worktreePath, branch: name } satisfies WorktreeDetails,
			};
		},
	});

	pi.registerTool({
		name: "worktree_list",
		label: "List Worktrees",
		description: "List all git worktrees in this repository, including the main working directory.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _onUpdate, ctx, _signal) {
			const result = await pi.exec("git", ["worktree", "list", "--porcelain"], { cwd: ctx.cwd });

			if (result.code !== 0) {
				return {
					content: [{ type: "text", text: `Failed to list worktrees: ${result.stderr || result.stdout}` }],
					details: { worktrees: [] } satisfies WorktreeListDetails,
					isError: true,
				};
			}

			// Parse porcelain output
			const worktreeList: WorktreeListDetails["worktrees"] = [];
			const lines = result.stdout.split("\n");
			let current: Partial<WorktreeListDetails["worktrees"][0]> = {};

			for (const line of lines) {
				if (line.startsWith("worktree ")) {
					current.path = line.slice(9);
				} else if (line.startsWith("HEAD ")) {
					current.head = line.slice(5);
				} else if (line.startsWith("branch ")) {
					current.branch = line.slice(7).replace("refs/heads/", "");
				} else if (line === "bare") {
					current.bare = true;
				} else if (line === "detached") {
					current.branch = "(detached)";
				} else if (line === "" && current.path) {
					worktreeList.push({
						path: current.path,
						branch: current.branch || "(unknown)",
						head: current.head || "",
						bare: current.bare || false,
					});
					current = {};
				}
			}

			// Format output
			let output = `Found ${worktreeList.length} worktree${worktreeList.length !== 1 ? "s" : ""}:\n\n`;
			for (const wt of worktreeList) {
				const isMain = !wt.path.includes(WORKTREES_DIR);
				const marker = isMain ? " (main)" : "";
				output += `• ${wt.branch}${marker}\n`;
				output += `  Path: ${wt.path}\n`;
				output += `  HEAD: ${wt.head.slice(0, 8)}\n\n`;
			}

			return {
				content: [{ type: "text", text: output.trim() }],
				details: { worktrees: worktreeList } satisfies WorktreeListDetails,
			};
		},
	});

	pi.registerTool({
		name: "worktree_remove",
		label: "Remove Worktree",
		description: `Remove a worktree after work is complete.
The branch is preserved and can still be merged.
Use force=true to remove even with uncommitted changes.`,
		parameters: Type.Object({
			name: Type.String({ description: "Worktree name to remove" }),
			force: Type.Optional(Type.Boolean({ description: "Force removal even with uncommitted changes" })),
		}),
		async execute(_toolCallId, params, _onUpdate, ctx, _signal) {
			const { name, force } = params;
			const worktreePath = join(ctx.cwd, WORKTREES_DIR, name);

			// Check if worktree exists
			if (!existsSync(worktreePath)) {
				worktrees.delete(name);
				updateStatusWidget(ctx);
				return {
					content: [{ type: "text", text: `Worktree "${name}" not found at: ${worktreePath}` }],
					details: { name, path: worktreePath, branch: name } satisfies WorktreeDetails,
					isError: true,
				};
			}

			const args = ["worktree", "remove", worktreePath];
			if (force) {
				args.push("--force");
			}

			const result = await pi.exec("git", args, { cwd: ctx.cwd });

			if (result.code !== 0) {
				const error = result.stderr || result.stdout || "Unknown error";
				// Check if it's about uncommitted changes
				if (error.includes("uncommitted changes") || error.includes("untracked files")) {
					return {
						content: [
							{
								type: "text",
								text: `Cannot remove worktree "${name}": has uncommitted changes.\nUse force=true to remove anyway, or commit/stash changes first.`,
							},
						],
						details: { name, path: worktreePath, branch: name } satisfies WorktreeDetails,
						isError: true,
					};
				}
				return {
					content: [{ type: "text", text: `Failed to remove worktree: ${error}` }],
					details: { name, path: worktreePath, branch: name } satisfies WorktreeDetails,
					isError: true,
				};
			}

			worktrees.delete(name);
			updateStatusWidget(ctx);

			return {
				content: [
					{
						type: "text",
						text: `Removed worktree "${name}".\nBranch "${name}" is preserved and can still be merged.`,
					},
				],
				details: { name, path: worktreePath, branch: name } satisfies WorktreeDetails,
			};
		},
	});

	pi.registerTool({
		name: "worktree_status",
		label: "Worktree Status",
		description: "Get git status and diff summary for a specific worktree.",
		parameters: Type.Object({
			name: Type.String({ description: "Worktree name" }),
		}),
		async execute(_toolCallId, params, _onUpdate, ctx, _signal) {
			const { name } = params;
			const worktreePath = join(ctx.cwd, WORKTREES_DIR, name);

			if (!existsSync(worktreePath)) {
				return {
					content: [{ type: "text", text: `Worktree "${name}" not found` }],
					details: { name, path: worktreePath, branch: "" },
					isError: true,
				};
			}

			// Get status
			const statusResult = await pi.exec("git", ["status", "--short"], { cwd: worktreePath });
			const diffResult = await pi.exec("git", ["diff", "--stat"], { cwd: worktreePath });
			const branchResult = await pi.exec("git", ["branch", "--show-current"], { cwd: worktreePath });

			const branch = branchResult.stdout.trim();
			const status = statusResult.stdout.trim();
			const diff = diffResult.stdout.trim();

			let output = `Worktree: ${name}\n`;
			output += `Branch: ${branch}\n`;
			output += `Path: ${worktreePath}\n\n`;

			if (status) {
				output += `Changes:\n${status}\n\n`;
			} else {
				output += "No uncommitted changes\n\n";
			}

			if (diff) {
				output += `Diff summary:\n${diff}`;
			}

			return {
				content: [{ type: "text", text: output.trim() }],
				details: { name, path: worktreePath, branch },
			};
		},
	});

	// ============ COMMANDS ============

	pi.registerCommand("worktrees", {
		description: "List all git worktrees",
		handler: async (_args, ctx) => {
			const result = await pi.exec("git", ["worktree", "list"], { cwd: ctx.cwd });
			if (result.code === 0) {
				ctx.ui.notify(result.stdout || "No worktrees found", "info");
			} else {
				ctx.ui.notify(`Error: ${result.stderr || result.stdout}`, "error");
			}
		},
	});

	pi.registerCommand("worktree", {
		description: "Select and manage a worktree (with filtering)",
		handler: async (_args, ctx) => {
			// Get all worktrees
			const result = await pi.exec("git", ["worktree", "list", "--porcelain"], { cwd: ctx.cwd });
			if (result.code !== 0) {
				ctx.ui.notify(`Error: ${result.stderr || result.stdout}`, "error");
				return;
			}

			// Parse worktrees
			interface WorktreeEntry {
				path: string;
				branch: string;
				head: string;
				isMain: boolean;
			}

			const worktreeList: WorktreeEntry[] = [];
			const lines = result.stdout.split("\n");
			let current: Partial<WorktreeEntry> = {};

			for (const line of lines) {
				if (line.startsWith("worktree ")) {
					current.path = line.slice(9);
					current.isMain = !current.path.includes(WORKTREES_DIR);
				} else if (line.startsWith("HEAD ")) {
					current.head = line.slice(5);
				} else if (line.startsWith("branch ")) {
					current.branch = line.slice(7).replace("refs/heads/", "");
				} else if (line === "detached") {
					current.branch = "(detached)";
				} else if (line === "" && current.path) {
					worktreeList.push({
						path: current.path,
						branch: current.branch || "(unknown)",
						head: current.head || "",
						isMain: current.isMain ?? false,
					});
					current = {};
				}
			}

			if (worktreeList.length === 0) {
				ctx.ui.notify("No worktrees found", "info");
				return;
			}

			// Build selection items with value (branch) and description (path)
			const selectItems = worktreeList.map((wt) => ({
				value: wt.branch,
				label: wt.branch + (wt.isMain ? " (main)" : ""),
				description: wt.path,
			}));

			// Show custom filterable selector
			const selectedWorktree = await ctx.ui.custom<WorktreeEntry | undefined>((tui, theme, _keybindings, done) => {
				const selectListTheme = getSelectListTheme();
				let filter = "";
				let cachedLines: string[] | undefined;

				const selectList = new SelectList(selectItems, 10, selectListTheme);

				selectList.onSelect = (item: SelectItem) => {
					const wt = worktreeList.find((w) => w.branch === item.value);
					done(wt);
				};
				selectList.onCancel = () => done(undefined);

				const component: Component = {
					invalidate() {
						cachedLines = undefined;
					},

					render(width: number): string[] {
						if (cachedLines) return cachedLines;

						const lines: string[] = [];
						const add = (s: string) => lines.push(truncateToWidth(s, width));

						add(theme.fg("accent", "─".repeat(width)));
						add(theme.fg("text", " Select worktree:"));
						lines.push("");

						// Filter input display
						const filterDisplay = filter
							? theme.fg("accent", ` Filter: ${filter}`)
							: theme.fg("dim", " Type to filter...");
						add(filterDisplay);
						lines.push("");

						// Render select list
						const listLines = selectList.render(width);
						lines.push(...listLines);

						lines.push("");
						add(theme.fg("dim", " ↑↓ navigate  Enter select  Esc cancel  Type to filter"));
						add(theme.fg("accent", "─".repeat(width)));

						cachedLines = lines;
						return lines;
					},

					handleInput(data: string) {
						// Escape to cancel
						if (matchesKey(data, Key.escape)) {
							done(undefined);
							return;
						}

						// Navigation
						if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
							selectList.handleInput(data);
							cachedLines = undefined;
							tui.requestRender();
							return;
						}

						// Selection
						if (matchesKey(data, Key.enter)) {
							selectList.handleInput(data);
							return;
						}

						// Backspace to delete filter
						if (matchesKey(data, Key.backspace) || data === "\x7f") {
							if (filter.length > 0) {
								filter = filter.slice(0, -1);
								selectList.setFilter(filter);
								cachedLines = undefined;
								tui.requestRender();
							}
							return;
						}

						// Printable characters for filter
						if (data.length === 1 && data >= " " && data <= "~") {
							filter += data;
							selectList.setFilter(filter);
							cachedLines = undefined;
							tui.requestRender();
						}
					},
				};

				return component;
			});

			if (!selectedWorktree) return;

			// Show actions for selected worktree
			const actions = selectedWorktree.isMain
				? ["Show path", "Show status"]
				: ["Show path", "Show status", "Remove worktree"];

			const action = await ctx.ui.select(`${selectedWorktree.branch}:`, actions);
			if (action === undefined) return;

			switch (action) {
				case "Show path": {
					ctx.ui.notify(`Path: ${selectedWorktree.path}`, "info");
					ctx.ui.setEditorText(`cd ${selectedWorktree.path}`);
					break;
				}
				case "Show status": {
					const statusResult = await pi.exec("git", ["status", "--short"], { cwd: selectedWorktree.path });
					const diffResult = await pi.exec("git", ["diff", "--stat"], { cwd: selectedWorktree.path });

					let output = `Branch: ${selectedWorktree.branch}\n`;
					output += `Path: ${selectedWorktree.path}\n\n`;

					const status = statusResult.stdout.trim();
					if (status) {
						output += `Changes:\n${status}\n\n`;
					} else {
						output += "No uncommitted changes\n\n";
					}

					const diff = diffResult.stdout.trim();
					if (diff) {
						output += `Diff:\n${diff}`;
					}

					ctx.ui.notify(output.trim(), "info");
					break;
				}
				case "Remove worktree": {
					const name = selectedWorktree.path.split("/").pop() || "";
					const confirm = await ctx.ui.confirm(
						"Remove worktree?",
						`Remove "${name}"?\nBranch will be preserved for merging.`,
					);
					if (!confirm) return;

					const removeResult = await pi.exec("git", ["worktree", "remove", selectedWorktree.path], {
						cwd: ctx.cwd,
					});
					if (removeResult.code === 0) {
						worktrees.delete(name);
						updateStatusWidget(ctx);
						ctx.ui.notify(`Removed worktree "${name}"`, "info");
					} else {
						const error = removeResult.stderr || removeResult.stdout;
						if (error.includes("uncommitted changes") || error.includes("untracked files")) {
							ctx.ui.notify(`Cannot remove: has uncommitted changes. Commit or use force.`, "error");
						} else {
							ctx.ui.notify(`Error: ${error}`, "error");
						}
					}
					break;
				}
			}
		},
	});

	// ============ SYSTEM PROMPT INJECTION ============

	pi.on("before_agent_start", async (event, ctx) => {
		// Check if in a git repo
		const gitCheck = await pi.exec("git", ["rev-parse", "--git-dir"], { cwd: ctx.cwd });
		if (gitCheck.code !== 0) return;

		const activeWorktrees =
			worktrees.size > 0
				? Array.from(worktrees.entries())
						.map(([name, info]) => `  - ${name}: ${info.path} (branch: ${info.branch})`)
						.join("\n")
				: "  None currently active";

		const injection = `
## Git Worktrees

You have tools for managing git worktrees - isolated workspaces for parallel work:

- **worktree_create**: Create a new worktree with its own branch. Returns the path to use as cwd.
- **worktree_list**: List all worktrees in the repository.
- **worktree_status**: Check git status of a specific worktree.
- **worktree_remove**: Remove a worktree (branch is preserved for merging).

**Active session worktrees:**
${activeWorktrees}

**When to use worktrees:**
- Running multiple subagents in parallel on independent tasks
- Each subagent should work in its own worktree to avoid file conflicts
- After parallel work completes, review and merge branches

**Example workflow with subagent:**
1. worktree_create(name: "task-a")
2. worktree_create(name: "task-b")
3. subagent(tasks: [
     { agent: "worker", task: "...", cwd: ".worktrees/task-a" },
     { agent: "worker", task: "...", cwd: ".worktrees/task-b" }
   ])
4. Review changes with worktree_status
5. Merge branches: git merge task-a && git merge task-b
6. Cleanup: worktree_remove("task-a"), worktree_remove("task-b")
`;

		return { systemPrompt: event.systemPrompt + injection };
	});

	// ============ SESSION EVENTS ============

	pi.on("session_start", async (_event, ctx) => {
		// Discover existing worktrees created by this extension
		const result = await pi.exec("git", ["worktree", "list", "--porcelain"], { cwd: ctx.cwd });
		if (result.code === 0) {
			const lines = result.stdout.split("\n");
			let currentPath = "";

			for (const line of lines) {
				if (line.startsWith("worktree ")) {
					currentPath = line.slice(9);
				} else if (line.startsWith("branch ") && currentPath.includes(WORKTREES_DIR)) {
					const branch = line.slice(7).replace("refs/heads/", "");
					const name = currentPath.split("/").pop() || branch;

					worktrees.set(name, {
						path: currentPath,
						branch,
						created: Date.now(),
						setupCompleted: true, // Assume setup was done
					});
				} else if (line === "") {
					currentPath = "";
				}
			}
		}

		updateStatusWidget(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		// Re-discover worktrees on session switch
		worktrees.clear();

		const result = await pi.exec("git", ["worktree", "list", "--porcelain"], { cwd: ctx.cwd });
		if (result.code === 0) {
			const lines = result.stdout.split("\n");
			let currentPath = "";

			for (const line of lines) {
				if (line.startsWith("worktree ")) {
					currentPath = line.slice(9);
				} else if (line.startsWith("branch ") && currentPath.includes(WORKTREES_DIR)) {
					const branch = line.slice(7).replace("refs/heads/", "");
					const name = currentPath.split("/").pop() || branch;

					worktrees.set(name, {
						path: currentPath,
						branch,
						created: Date.now(),
						setupCompleted: true,
					});
				} else if (line === "") {
					currentPath = "";
				}
			}
		}

		updateStatusWidget(ctx);
	});
}
