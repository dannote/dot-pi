/**
 * LSP Tool Types
 */

import { StringEnum } from "@mariozechner/pi-ai";
import { type Static, Type } from "@sinclair/typebox";
import type { Subprocess } from "bun";

// Re-export LSP types from vscode-languageserver-types
export type {
  Position,
  Range,
  Location,
  LocationLink,
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticRelatedInformation,
  TextEdit,
  TextDocumentIdentifier,
  VersionedTextDocumentIdentifier,
  OptionalVersionedTextDocumentIdentifier,
  TextDocumentEdit,
  CreateFile,
  RenameFile,
  DeleteFile,
  WorkspaceEdit,
  Command,
  CodeAction,
  CodeActionKind,
  CodeActionContext,
  SymbolKind,
  DocumentSymbol,
  SymbolInformation,
  Hover,
  MarkupContent,
  MarkedString,
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
} from "vscode-languageserver-types";

import type {
  Diagnostic,
  TextEdit,
  WorkspaceEdit,
  DocumentSymbol,
  SymbolInformation,
  CodeAction,
  Command,
  Location,
  LocationLink,
  Hover,
  CallHierarchyItem,
  CallHierarchyIncomingCall,
  CallHierarchyOutgoingCall,
} from "vscode-languageserver-types";

// =============================================================================
// Tool Schema
// =============================================================================

export const lspSchema = Type.Object({
  action: StringEnum(
    [
      // Standard LSP operations
      "diagnostics",
      "workspace_diagnostics",
      "references",
      "definition",
      "hover",
      "symbols",
      "workspace_symbols",
      "rename",
      "actions",
      "incoming_calls",
      "outgoing_calls",
      "status",
      // Rust-analyzer specific operations
      "flycheck",
      "expand_macro",
      "ssr",
      "runnables",
      "related_tests",
      "reload_workspace",
    ],
    { description: "LSP action to perform" },
  ),
  files: Type.Optional(Type.Array(Type.String({ description: "File paths for diagnostics" }))),
  file: Type.Optional(Type.String({ description: "File path for file-specific actions" })),
  line: Type.Optional(Type.Number({ description: "1-based line number" })),
  column: Type.Optional(Type.Number({ description: "1-based column number" })),
  end_line: Type.Optional(Type.Number({ description: "1-based end line number for ranges" })),
  end_character: Type.Optional(
    Type.Number({ description: "1-based end column number for ranges" }),
  ),
  query: Type.Optional(Type.String({ description: "Search query for symbols/SSR pattern" })),
  new_name: Type.Optional(Type.String({ description: "New name for rename action" })),
  replacement: Type.Optional(Type.String({ description: "Replacement for SSR action" })),
  kind: Type.Optional(
    Type.String({ description: "Code action kind filter (quickfix, refactor, source)" }),
  ),
  apply: Type.Optional(
    Type.Boolean({ description: "Apply edits instead of preview (default: true)" }),
  ),
  action_index: Type.Optional(Type.Number({ description: "Index of code action to apply" })),
  include_declaration: Type.Optional(
    Type.Boolean({ description: "Include declaration in references (default: true)" }),
  ),
});

export type LspParams = Static<typeof lspSchema>;

export interface LspToolDetails {
  serverName?: string;
  action: string;
  success: boolean;
}

// =============================================================================
// Linter Client Interface
// =============================================================================

export interface LinterClient {
  format(filePath: string, content: string): Promise<string>;
  lint(filePath: string): Promise<Diagnostic[]>;
  dispose?(): void;
}

export type LinterClientFactory = (config: ServerConfig, cwd: string) => LinterClient;

// =============================================================================
// Server Configuration
// =============================================================================

export interface ServerCapabilities {
  flycheck?: boolean;
  ssr?: boolean;
  expandMacro?: boolean;
  runnables?: boolean;
  relatedTests?: boolean;
}

export interface ServerConfig {
  command: string;
  args?: string[];
  fileTypes: string[];
  rootMarkers: string[];
  initOptions?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  disabled?: boolean;
  capabilities?: ServerCapabilities;
  isLinter?: boolean;
  resolvedCommand?: string;
  createClient?: LinterClientFactory;
}

// =============================================================================
// Client State
// =============================================================================

export interface OpenFile {
  version: number;
  languageId: string;
}

export interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  method: string;
}

export interface LspServerCapabilities {
  renameProvider?: boolean | { prepareProvider?: boolean };
  codeActionProvider?: boolean | { resolveProvider?: boolean };
  hoverProvider?: boolean;
  definitionProvider?: boolean;
  referencesProvider?: boolean;
  documentSymbolProvider?: boolean;
  workspaceSymbolProvider?: boolean;
  documentFormattingProvider?: boolean;
  [key: string]: unknown;
}

export interface LspClient {
  name: string;
  cwd: string;
  config: ServerConfig;
  process: Subprocess;
  requestId: number;
  diagnostics: Map<string, Diagnostic[]>;
  diagnosticsVersion: number;
  openFiles: Map<string, OpenFile>;
  pendingRequests: Map<number, PendingRequest>;
  messageBuffer: Uint8Array;
  isReading: boolean;
  serverCapabilities?: LspServerCapabilities;
  lastActivity: number;
}

// =============================================================================
// Rust-analyzer Specific Types
// =============================================================================

export interface ExpandMacroResult {
  name: string;
  expansion: string;
}

export interface Runnable {
  label: string;
  kind: string;
  args?: {
    workspaceRoot?: string;
    cargoArgs?: string[];
    cargoExtraArgs?: string[];
    executableArgs?: string[];
  };
  location?: {
    targetUri: string;
    targetRange?: import("vscode-languageserver-types").Range;
    targetSelectionRange?: import("vscode-languageserver-types").Range;
  };
}

export interface RelatedTest {
  runnable?: {
    label: string;
    kind: string;
    args?: Runnable["args"];
    location?: Runnable["location"];
  };
}

// =============================================================================
// JSON-RPC Protocol Types
// =============================================================================

export interface LspJsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: unknown;
}

export interface LspJsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface LspJsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}
