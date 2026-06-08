import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { platform } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);

export type QuoteSource = "argument" | "selection" | "copy-fallback" | "clipboard";
export type QuoteResult = { text: string; source: QuoteSource };

type SelectionHookInstance = {
  start(config?: {
    enableClipboard?: boolean;
    selectionPassiveMode?: boolean;
    debug?: boolean;
  }): boolean;
  stop(): boolean;
  cleanup?(): void;
  getCurrentSelection(): { text?: string } | null;
};

type SelectionHookConstructor = new () => SelectionHookInstance;

function readClipboard(): string {
  const commands: Array<[string, string[]]> = [
    ["pbpaste", []],
    ["wl-paste", ["--no-newline"]],
    ["xclip", ["-selection", "clipboard", "-out"]],
    ["xsel", ["--clipboard", "--output"]],
    ["powershell.exe", ["-NoProfile", "-Command", "Get-Clipboard -Raw"]],
  ];

  for (const [command, args] of commands) {
    try {
      return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      // Try the next clipboard command.
    }
  }

  return "";
}

function writeClipboard(text: string): boolean {
  const commands: Array<[string, string[]]> = [
    ["pbcopy", []],
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--input"]],
    [
      "powershell.exe",
      ["-NoProfile", "-Command", "Set-Clipboard -Value ([Console]::In.ReadToEnd())"],
    ],
  ];

  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { input: text, stdio: ["pipe", "ignore", "ignore"] });
    if (!result.error && result.status === 0) return true;
  }

  return false;
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function readSelectionHook(): QuoteResult | undefined {
  try {
    const mod = require("selection-hook") as
      | SelectionHookConstructor
      | { default?: SelectionHookConstructor };
    const SelectionHook = typeof mod === "function" ? mod : mod.default;
    if (!SelectionHook) return;

    const hook = new SelectionHook();
    try {
      if (!hook.start({ enableClipboard: false, selectionPassiveMode: true, debug: false })) return;
      sleep(30);
      const text = hook.getCurrentSelection()?.text?.trim();
      return text ? { text, source: "selection" } : undefined;
    } finally {
      hook.stop();
      hook.cleanup?.();
    }
  } catch {
    return;
  }
}

function copySelectionIntoClipboard(): boolean {
  const os = platform();

  try {
    if (os === "darwin") {
      execFileSync(
        "osascript",
        ["-e", 'tell application "System Events" to keystroke "c" using command down'],
        { stdio: "ignore" },
      );
      return true;
    }

    if (os === "win32") {
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^c')",
        ],
        { stdio: "ignore" },
      );
      return true;
    }

    for (const [command, args] of [
      ["ydotool", ["key", "29:1", "46:1", "46:0", "29:0"]],
      ["xdotool", ["key", "ctrl+c"]],
    ] satisfies Array<[string, string[]]>) {
      try {
        execFileSync(command, args, { stdio: "ignore" });
        return true;
      } catch {
        // Try the next keyboard automation command.
      }
    }
  } catch {
    return false;
  }

  return false;
}

function readClipboardPreservingCopyFallback(): QuoteResult | undefined {
  const before = readClipboard();
  if (!copySelectionIntoClipboard()) return;

  sleep(100);
  const selected = readClipboard().trim();
  if (selected !== before) writeClipboard(before);

  return selected ? { text: selected, source: "copy-fallback" } : undefined;
}

function readSelection(): QuoteResult | undefined {
  return readSelectionHook() ?? readClipboardPreservingCopyFallback();
}

function readSelectionOrClipboard(): QuoteResult | undefined {
  const result = readSelection();
  if (result) return result;

  const text = readClipboard().trim();
  return text ? { text, source: "clipboard" } : undefined;
}

export function formatQuote(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .split("\n")
    .map((line) => (line.length === 0 ? ">" : `> ${line}`))
    .join("\n");
}

export function appendQuote(current: string, quoted: string): string {
  const separator = current.trim().length === 0 ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  return `${current}${separator}${quoted}\n\n`;
}

function insertQuote(ctx: ExtensionContext, result: QuoteResult | undefined): void {
  const quoted = result ? formatQuote(result.text) : "";
  if (!result || !quoted) {
    ctx.ui.notify("No selected text found", "warning");
    return;
  }

  ctx.ui.setEditorText(appendQuote(ctx.ui.getEditorText(), quoted));

  if (result.source === "clipboard") {
    ctx.ui.notify("Quoted clipboard text; no active selection was found", "info");
  }
}

export default function quoteExtension(pi: ExtensionAPI) {
  pi.registerCommand("quote", {
    description: "Insert selected/copied text as email-style quote",
    async handler(args, ctx) {
      const text = args.trim();
      insertQuote(ctx, text ? { text, source: "argument" } : readSelectionOrClipboard());
    },
  });

  pi.registerShortcut("alt+q", {
    description: "Quote current selection into editor",
    handler(ctx) {
      if (!ctx.hasUI) return;
      insertQuote(ctx, readSelection());
    },
  });
}
