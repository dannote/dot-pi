import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { platform } from "node:os";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);

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
    try {
      spawnSync(command, args, { input: text, stdio: ["pipe", "ignore", "ignore"] });
      return true;
    } catch {
      // Try the next clipboard command.
    }
  }

  return false;
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function readSelectionHook(): string {
  try {
    const mod = require("selection-hook") as
      | SelectionHookConstructor
      | { default?: SelectionHookConstructor };
    const SelectionHook = typeof mod === "function" ? mod : mod.default;
    if (!SelectionHook) return "";

    const hook = new SelectionHook();
    try {
      if (!hook.start({ enableClipboard: false, selectionPassiveMode: true, debug: false }))
        return "";
      sleep(30);
      return hook.getCurrentSelection()?.text?.trim() ?? "";
    } finally {
      hook.stop();
      hook.cleanup?.();
    }
  } catch {
    return "";
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

function readClipboardPreservingCopyFallback(): string {
  const before = readClipboard();
  if (!copySelectionIntoClipboard()) return "";

  sleep(100);
  const selected = readClipboard();
  if (selected !== before) writeClipboard(before);

  return selected;
}

function readSelectedText(): string {
  return readSelectionHook() || readClipboardPreservingCopyFallback() || readClipboard();
}

function quote(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .split("\n")
    .map((line) => (line.length === 0 ? ">" : `> ${line}`))
    .join("\n");
}

function insertQuote(ctx: ExtensionContext, text: string): void {
  const quoted = quote(text);
  if (!quoted) {
    ctx.ui.notify("No selection or clipboard text found", "warning");
    return;
  }

  const current = ctx.ui.getEditorText();
  const separator = current.trim().length === 0 ? "" : current.endsWith("\n") ? "\n" : "\n\n";
  ctx.ui.setEditorText(`${current}${separator}${quoted}\n\n`);
}

export default function quoteExtension(pi: ExtensionAPI) {
  pi.registerCommand("quote", {
    description: "Insert selected/copied text as email-style quote",
    async handler(args, ctx) {
      insertQuote(ctx, args.trim() || readSelectedText());
    },
  });

  pi.registerShortcut("alt+q", {
    description: "Quote current selection into editor",
    handler(ctx) {
      if (!ctx.hasUI) return;
      insertQuote(ctx, readSelectedText());
    },
  });
}
