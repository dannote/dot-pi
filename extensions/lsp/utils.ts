/**
 * LSP Tool Utilities
 */

import path from "node:path";
import {
  DiagnosticSeverity,
  SymbolKind,
  type Diagnostic,
  type DocumentSymbol,
  type Location,
  type SymbolInformation,
  type WorkspaceEdit,
} from "vscode-languageserver-types";

// =============================================================================
// Language Detection
// =============================================================================

const LANGUAGE_MAP: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescriptreact",
  ".js": "javascript",
  ".jsx": "javascriptreact",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".rs": "rust",
  ".go": "go",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hxx": "cpp",
  ".zig": "zig",
  ".py": "python",
  ".rb": "ruby",
  ".lua": "lua",
  ".sh": "shellscript",
  ".bash": "shellscript",
  ".zsh": "shellscript",
  ".fish": "fish",
  ".pl": "perl",
  ".php": "php",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".scala": "scala",
  ".groovy": "groovy",
  ".clj": "clojure",
  ".cs": "csharp",
  ".fs": "fsharp",
  ".vb": "vb",
  ".html": "html",
  ".htm": "html",
  ".css": "css",
  ".scss": "scss",
  ".sass": "sass",
  ".less": "less",
  ".vue": "vue",
  ".svelte": "svelte",
  ".json": "json",
  ".jsonc": "jsonc",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".toml": "toml",
  ".xml": "xml",
  ".ini": "ini",
  ".md": "markdown",
  ".markdown": "markdown",
  ".rst": "restructuredtext",
  ".adoc": "asciidoc",
  ".tex": "latex",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".proto": "protobuf",
  ".dockerfile": "dockerfile",
  ".tf": "terraform",
  ".hcl": "hcl",
  ".nix": "nix",
  ".ex": "elixir",
  ".exs": "elixir",
  ".erl": "erlang",
  ".hrl": "erlang",
  ".hs": "haskell",
  ".ml": "ocaml",
  ".mli": "ocaml",
  ".swift": "swift",
  ".r": "r",
  ".R": "r",
  ".jl": "julia",
  ".dart": "dart",
  ".elm": "elm",
  ".v": "v",
  ".nim": "nim",
  ".cr": "crystal",
  ".d": "d",
  ".pas": "pascal",
  ".pp": "pascal",
  ".lisp": "lisp",
  ".lsp": "lisp",
  ".rkt": "racket",
  ".scm": "scheme",
  ".ps1": "powershell",
  ".psm1": "powershell",
  ".bat": "bat",
  ".cmd": "bat",
};

export function detectLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const basename = path.basename(filePath).toLowerCase();

  if (basename === "dockerfile" || basename.startsWith("dockerfile.")) {
    return "dockerfile";
  }
  if (basename === "makefile" || basename === "gnumakefile") {
    return "makefile";
  }
  if (basename === "cmakelists.txt" || ext === ".cmake") {
    return "cmake";
  }

  return LANGUAGE_MAP[ext] ?? "plaintext";
}

// =============================================================================
// URI Handling (Cross-Platform)
// =============================================================================

export function fileToUri(filePath: string): string {
  const resolved = path.resolve(filePath);

  if (process.platform === "win32") {
    return `file:///${resolved.replace(/\\/g, "/")}`;
  }

  return `file://${resolved}`;
}

export function uriToFile(uri: string): string {
  if (!uri.startsWith("file://")) {
    return uri;
  }

  let filePath = decodeURIComponent(uri.slice(7));

  if (
    process.platform === "win32" &&
    filePath.startsWith("/") &&
    /^[A-Za-z]:/.test(filePath.slice(1))
  ) {
    filePath = filePath.slice(1);
  }

  return filePath;
}

// =============================================================================
// Diagnostic Formatting
// =============================================================================

const SEVERITY_NAMES: Record<number, string> = {
  [DiagnosticSeverity.Error]: "error",
  [DiagnosticSeverity.Warning]: "warning",
  [DiagnosticSeverity.Information]: "info",
  [DiagnosticSeverity.Hint]: "hint",
};

export function severityToString(severity?: number): string {
  return SEVERITY_NAMES[severity ?? DiagnosticSeverity.Error] ?? "unknown";
}

export function severityToIcon(severity?: number): string {
  switch (severity ?? DiagnosticSeverity.Error) {
    case DiagnosticSeverity.Error:
      return "✗";
    case DiagnosticSeverity.Warning:
      return "⚠";
    case DiagnosticSeverity.Information:
      return "ℹ";
    case DiagnosticSeverity.Hint:
      return "·";
    default:
      return "✗";
  }
}

export function formatDiagnostic(diagnostic: Diagnostic, filePath: string): string {
  const severity = severityToString(diagnostic.severity);
  const line = diagnostic.range.start.line + 1;
  const col = diagnostic.range.start.character + 1;
  const source = diagnostic.source ? `[${diagnostic.source}] ` : "";
  const code = diagnostic.code ? ` (${diagnostic.code})` : "";

  return `${filePath}:${line}:${col} [${severity}] ${source}${diagnostic.message}${code}`;
}

export function formatDiagnosticsSummary(diagnostics: Diagnostic[]): string {
  const counts = { error: 0, warning: 0, info: 0, hint: 0 };

  for (const d of diagnostics) {
    const sev = severityToString(d.severity);
    if (sev in counts) {
      counts[sev as keyof typeof counts]++;
    }
  }

  const parts: string[] = [];
  if (counts.error > 0) parts.push(`${counts.error} error(s)`);
  if (counts.warning > 0) parts.push(`${counts.warning} warning(s)`);
  if (counts.info > 0) parts.push(`${counts.info} info(s)`);
  if (counts.hint > 0) parts.push(`${counts.hint} hint(s)`);

  return parts.length > 0 ? parts.join(", ") : "no issues";
}

// =============================================================================
// Location Formatting
// =============================================================================

export function formatLocation(location: Location, cwd: string): string {
  const file = path.relative(cwd, uriToFile(location.uri));
  const line = location.range.start.line + 1;
  const col = location.range.start.character + 1;
  return `${file}:${line}:${col}`;
}

export function formatPosition(line: number, col: number): string {
  return `${line}:${col}`;
}

// =============================================================================
// WorkspaceEdit Formatting
// =============================================================================

export function formatWorkspaceEdit(edit: WorkspaceEdit, cwd: string): string[] {
  const results: string[] = [];

  if (edit.changes) {
    for (const [uri, textEdits] of Object.entries(edit.changes)) {
      const file = path.relative(cwd, uriToFile(uri));
      results.push(`${file}: ${textEdits.length} edit${textEdits.length > 1 ? "s" : ""}`);
    }
  }

  if (edit.documentChanges) {
    for (const change of edit.documentChanges) {
      if ("edits" in change && "textDocument" in change) {
        const file = path.relative(cwd, uriToFile(change.textDocument.uri));
        results.push(`${file}: ${change.edits.length} edit${change.edits.length > 1 ? "s" : ""}`);
      } else if ("kind" in change) {
        switch (change.kind) {
          case "create":
            results.push(`CREATE: ${path.relative(cwd, uriToFile(change.uri))}`);
            break;
          case "rename":
            results.push(
              `RENAME: ${path.relative(cwd, uriToFile(change.oldUri))} → ${path.relative(cwd, uriToFile(change.newUri))}`,
            );
            break;
          case "delete":
            results.push(`DELETE: ${path.relative(cwd, uriToFile(change.uri))}`);
            break;
        }
      }
    }
  }

  return results;
}

// =============================================================================
// Symbol Formatting
// =============================================================================

const SYMBOL_KIND_ICONS: Record<number, string> = {
  [SymbolKind.File]: "📄",
  [SymbolKind.Module]: "📦",
  [SymbolKind.Namespace]: "📦",
  [SymbolKind.Package]: "📦",
  [SymbolKind.Class]: "🔷",
  [SymbolKind.Method]: "ƒ",
  [SymbolKind.Property]: "·",
  [SymbolKind.Field]: "·",
  [SymbolKind.Constructor]: "ƒ",
  [SymbolKind.Enum]: "∈",
  [SymbolKind.Interface]: "◇",
  [SymbolKind.Function]: "ƒ",
  [SymbolKind.Variable]: "·",
  [SymbolKind.Constant]: "·",
  [SymbolKind.String]: "·",
  [SymbolKind.Number]: "·",
  [SymbolKind.Boolean]: "·",
  [SymbolKind.Array]: "·",
  [SymbolKind.Object]: "·",
  [SymbolKind.Key]: "·",
  [SymbolKind.Null]: "·",
  [SymbolKind.EnumMember]: "·",
  [SymbolKind.Struct]: "🔷",
  [SymbolKind.Event]: "·",
  [SymbolKind.Operator]: "·",
  [SymbolKind.TypeParameter]: "·",
};

export function symbolKindToIcon(kind: number): string {
  return SYMBOL_KIND_ICONS[kind] ?? "·";
}

export function symbolKindToName(kind: number): string {
  const names: Record<number, string> = {
    [SymbolKind.File]: "File",
    [SymbolKind.Module]: "Module",
    [SymbolKind.Namespace]: "Namespace",
    [SymbolKind.Package]: "Package",
    [SymbolKind.Class]: "Class",
    [SymbolKind.Method]: "Method",
    [SymbolKind.Property]: "Property",
    [SymbolKind.Field]: "Field",
    [SymbolKind.Constructor]: "Constructor",
    [SymbolKind.Enum]: "Enum",
    [SymbolKind.Interface]: "Interface",
    [SymbolKind.Function]: "Function",
    [SymbolKind.Variable]: "Variable",
    [SymbolKind.Constant]: "Constant",
    [SymbolKind.String]: "String",
    [SymbolKind.Number]: "Number",
    [SymbolKind.Boolean]: "Boolean",
    [SymbolKind.Array]: "Array",
    [SymbolKind.Object]: "Object",
    [SymbolKind.Key]: "Key",
    [SymbolKind.Null]: "Null",
    [SymbolKind.EnumMember]: "EnumMember",
    [SymbolKind.Struct]: "Struct",
    [SymbolKind.Event]: "Event",
    [SymbolKind.Operator]: "Operator",
    [SymbolKind.TypeParameter]: "TypeParameter",
  };
  return names[kind] ?? "Unknown";
}

export function formatDocumentSymbol(symbol: DocumentSymbol, indent = 0): string[] {
  const prefix = "  ".repeat(indent);
  const icon = symbolKindToIcon(symbol.kind);
  const line = symbol.range.start.line + 1;
  const results = [`${prefix}${icon} ${symbol.name} @ line ${line}`];

  if (symbol.children) {
    for (const child of symbol.children) {
      results.push(...formatDocumentSymbol(child, indent + 1));
    }
  }

  return results;
}

export function formatSymbolInformation(symbol: SymbolInformation, cwd: string): string {
  const icon = symbolKindToIcon(symbol.kind);
  const location = formatLocation(symbol.location, cwd);
  const container = symbol.containerName ? ` (${symbol.containerName})` : "";
  return `${icon} ${symbol.name}${container} @ ${location}`;
}

// =============================================================================
// Hover Content Extraction
// =============================================================================

export function extractHoverText(
  contents:
    | string
    | { kind: string; value: string }
    | { language: string; value: string }
    | unknown[],
): string {
  if (typeof contents === "string") {
    return contents;
  }

  if (Array.isArray(contents)) {
    return contents
      .map((c) => extractHoverText(c as string | { kind: string; value: string }))
      .join("\n\n");
  }

  if (typeof contents === "object" && contents !== null) {
    if ("value" in contents && typeof contents.value === "string") {
      return contents.value;
    }
  }

  return String(contents);
}

// =============================================================================
// General Utilities
// =============================================================================

export function sleep(ms: number): Promise<void> {
  return Bun.sleep(ms);
}

export async function commandExists(command: string): Promise<boolean> {
  return Bun.which(command) !== null;
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return `${str.slice(0, maxLength - 3)}...`;
}

export function groupBy<T, K extends string | number>(
  items: T[],
  keyFn: (item: T) => K,
): Record<K, T[]> {
  const result = {} as Record<K, T[]>;
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }
  return result;
}
