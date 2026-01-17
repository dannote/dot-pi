/**
 * Bash Completion Extension
 *
 * Provides intelligent bash completions for shell-mode commands (`!` / `!!`).
 * When typing shell commands, Tab completion will use actual bash completions
 * (e.g., `!git comm` + Tab → `commit`, `!docker ` + Tab → container, image, etc.)
 *
 * Usage: Symlink or copy to ~/.pi/agent/extensions/
 */

import { CustomEditor, type ExtensionAPI, type KeybindingsManager } from "@mariozechner/pi-coding-agent";
import {
	type AutocompleteItem,
	type AutocompleteProvider,
	CombinedAutocompleteProvider,
	type EditorTheme,
	type TUI,
} from "@mariozechner/pi-tui";
import { spawnSync } from "child_process";
import { type Dirent, readdirSync, statSync } from "fs";
import { delimiter, extname, join } from "path";

import { bashCompletionScript } from "./bash-completion-script.js";

/**
 * Extended autocomplete provider that adds bash completion support for shell commands.
 */
class BashCompletionAutocompleteProvider implements AutocompleteProvider {
	private baseProvider: CombinedAutocompleteProvider;
	private shellPath: string;
	private commandCache: { pathValue: string; commands: string[] } | null = null;

	constructor(baseProvider: CombinedAutocompleteProvider, shellPath: string = "bash") {
		this.baseProvider = baseProvider;
		this.shellPath = shellPath;
	}

	getSuggestions(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
	): { items: AutocompleteItem[]; prefix: string } | null {
		const currentLine = lines[cursorLine] || "";

		// Check if we're in shell mode (! or !!)
		const shellContext = this.getShellCompletionContext(currentLine, cursorCol);
		if (shellContext) {
			const suggestions = this.getShellSuggestions(shellContext);
			if (suggestions) {
				return suggestions;
			}
		}

		// Fall back to base provider for non-shell completions
		return this.baseProvider.getSuggestions(lines, cursorLine, cursorCol);
	}

	applyCompletion(
		lines: string[],
		cursorLine: number,
		cursorCol: number,
		item: AutocompleteItem,
		prefix: string,
	): { lines: string[]; cursorLine: number; cursorCol: number } {
		return this.baseProvider.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
	}

	private getShellCompletionContext(
		currentLine: string,
		cursorCol: number,
	): { commandLine: string; commandCursor: number; prefix: string } | null {
		const trimmedLine = currentLine.trimStart();
		if (!trimmedLine.startsWith("!")) {
			return null;
		}

		const leadingWhitespace = currentLine.length - trimmedLine.length;
		const bangCount = trimmedLine.startsWith("!!") ? 2 : 1;
		const commandStart = leadingWhitespace + bangCount;

		if (cursorCol < commandStart) {
			return null;
		}

		const rawCommandLine = currentLine.slice(commandStart);
		const rawCursor = cursorCol - commandStart;
		const trimmedCommandLine = rawCommandLine.trimStart();
		const trimOffset = rawCommandLine.length - trimmedCommandLine.length;
		const commandCursor = Math.max(0, rawCursor - trimOffset);
		const commandLine = trimmedCommandLine;
		const boundedCursor = Math.min(commandCursor, commandLine.length);
		const commandBeforeCursor = commandLine.slice(0, boundedCursor);
		const prefix = this.getShellCompletionPrefix(commandBeforeCursor);

		return {
			commandLine,
			commandCursor: boundedCursor,
			prefix,
		};
	}

	private getShellCompletionPrefix(commandBeforeCursor: string): string {
		const lastDelimiterIndex = Math.max(
			commandBeforeCursor.lastIndexOf(" "),
			commandBeforeCursor.lastIndexOf("\t"),
			commandBeforeCursor.lastIndexOf('"'),
			commandBeforeCursor.lastIndexOf("'"),
			commandBeforeCursor.lastIndexOf("="),
		);

		return lastDelimiterIndex === -1 ? commandBeforeCursor : commandBeforeCursor.slice(lastDelimiterIndex + 1);
	}

	private getShellSuggestions(context: {
		commandLine: string;
		commandCursor: number;
		prefix: string;
	}): { items: AutocompleteItem[]; prefix: string } | null {
		const { commandLine, commandCursor, prefix } = context;

		// Try bash completions first
		const bashSuggestions = this.getBashCompletions(commandLine, commandCursor);
		if (bashSuggestions.length > 0) {
			const unique = Array.from(new Set(bashSuggestions));
			const filtered = prefix
				? unique.filter((value) => value.toLowerCase().startsWith(prefix.toLowerCase()))
				: unique;
			if (filtered.length > 0) {
				return {
					items: filtered.map((value) => ({ value, label: value })),
					prefix,
				};
			}
		}

		if (!prefix) {
			return null;
		}

		// Fall back to command name completion for first word
		if (!commandLine.includes(" ") || commandLine.trim() === prefix) {
			const commands = this.getCommandSuggestions(prefix);
			if (commands.length > 0) {
				return { items: commands, prefix };
			}
		}

		return null;
	}

	private getBashCompletions(commandLine: string, cursorCol: number): string[] {
		if (!commandLine.trim()) {
			return [];
		}

		const result = spawnSync(this.shellPath, ["--noprofile", "--norc", "-ic", bashCompletionScript], {
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
			env: {
				...process.env,
				PI_BASH_COMPLETION_LINE: commandLine,
				PI_BASH_COMPLETION_POINT: String(cursorCol),
			},
			maxBuffer: 1024 * 1024,
			timeout: 5000,
		});

		if (result.error || result.status !== 0 || !result.stdout) {
			return [];
		}

		const suggestions = result.stdout.split(/\r?\n/).filter((line) => line.length > 0);
		const seen = new Set<string>();
		for (const suggestion of suggestions) {
			if (!seen.has(suggestion)) {
				seen.add(suggestion);
			}
		}

		return Array.from(seen).slice(0, 200);
	}

	private getCommandSuggestions(prefix: string): AutocompleteItem[] {
		if (!prefix) return [];

		const commands = this.getCommandList();
		if (commands.length === 0) return [];

		const lowerPrefix = prefix.toLowerCase();
		const filtered = commands.filter((cmd) => cmd.toLowerCase().startsWith(lowerPrefix)).slice(0, 100);

		return filtered.map((command) => ({
			value: command,
			label: command,
		}));
	}

	private getCommandList(): string[] {
		const pathValue = process.env.PATH ?? "";
		if (this.commandCache && this.commandCache.pathValue === pathValue) {
			return this.commandCache.commands;
		}

		const commandSet = new Set<string>();
		const directories = pathValue.split(delimiter).filter((dir) => dir.length > 0);
		const windowsExtensions = this.getWindowsPathExtensions();

		for (const dir of directories) {
			let entries: Dirent[];
			try {
				entries = readdirSync(dir, { withFileTypes: true });
			} catch {
				continue;
			}

			for (const entry of entries) {
				if (entry.isDirectory()) {
					continue;
				}

				const name = entry.name;
				const fullPath = join(dir, name);

				let stats: ReturnType<typeof statSync>;
				try {
					stats = statSync(fullPath);
				} catch {
					continue;
				}

				if (!stats.isFile()) {
					continue;
				}

				if (process.platform === "win32") {
					const normalized = this.normalizeWindowsCommandName(name, windowsExtensions);
					if (normalized) {
						commandSet.add(normalized);
					}
					continue;
				}

				if ((stats.mode & 0o111) === 0) {
					continue;
				}

				commandSet.add(name);
			}
		}

		const commands = Array.from(commandSet).sort((a, b) => a.localeCompare(b));
		this.commandCache = { pathValue, commands };
		return commands;
	}

	private getWindowsPathExtensions(): string[] {
		const pathext = process.env.PATHEXT;
		const extensions = pathext ? pathext.split(";") : [".COM", ".EXE", ".BAT", ".CMD"];
		return extensions.map((ext) => ext.trim().toLowerCase()).filter((ext) => ext.length > 0);
	}

	private normalizeWindowsCommandName(fileName: string, extensions: string[]): string | null {
		const extension = extname(fileName).toLowerCase();
		if (!extension) {
			return fileName;
		}

		if (extensions.includes(extension)) {
			return fileName.slice(0, -extension.length);
		}

		return null;
	}
}

/**
 * Custom editor that wraps the base editor with bash completion support.
 */
class BashCompletionEditor extends CustomEditor {
	private bashProvider: BashCompletionAutocompleteProvider | null = null;
	private shellPath: string;

	// Fix for pi 0.48.0+: CustomEditor constructor now requires TUI as first argument
	constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager, shellPath: string = "bash") {
		super(tui, theme, keybindings);
		this.shellPath = shellPath;
	}

	setAutocompleteProvider(provider: AutocompleteProvider): void {
		if (provider instanceof CombinedAutocompleteProvider) {
			this.bashProvider = new BashCompletionAutocompleteProvider(provider, this.shellPath);
			super.setAutocompleteProvider(this.bashProvider);
		} else {
			super.setAutocompleteProvider(provider);
		}
	}
}

// TODO: Use getShellConfig() from @mariozechner/pi-coding-agent when exported
// Currently it's internal in utils/shell.ts
function getShellPath(): string {
	const shell = process.env.SHELL;
	if (shell && shell.includes("bash")) {
		return shell;
	}
	return "bash";
}

export default function (pi: ExtensionAPI) {
	const shellPath = getShellPath();

	pi.on("session_start", (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			return new BashCompletionEditor(tui, theme, keybindings, shellPath);
		});
	});
}
