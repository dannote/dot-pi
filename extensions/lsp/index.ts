/**
 * LSP Tool Extension
 *
 * Provides Language Server Protocol operations for code intelligence.
 * Supports: definition, references, hover, symbols, rename, code actions,
 * workspace diagnostics, call hierarchy, and rust-analyzer specific operations.
 */

import {
  type ExtensionAPI,
  getLanguageFromPath,
  highlightCode,
} from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  CodeAction,
  Command,
  Diagnostic,
  DocumentSymbol,
  Hover,
  Location,
  LocationLink,
  SymbolInformation,
  WorkspaceEdit,
} from "vscode-languageserver-types";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import {
  ensureFileOpen,
  getActiveClients,
  getOrCreateClient,
  refreshFile,
  sendRequest,
  setIdleTimeout,
  shutdownAll,
  WARMUP_TIMEOUT_MS,
} from "./client";
import { getLinterClient } from "./clients";
import {
  getServerForFile,
  getServersForFile,
  hasCapability,
  loadConfig,
  type LspConfig,
} from "./config";
import { applyWorkspaceEdit } from "./edits";
import * as rustAnalyzer from "./rust-analyzer";
import type { LspParams, LspToolDetails, ServerConfig } from "./types";
import { lspSchema } from "./types";
import {
  extractHoverText,
  fileToUri,
  formatDiagnostic,
  formatDiagnosticsSummary,
  formatDocumentSymbol,
  formatLocation,
  formatSymbolInformation,
  formatWorkspaceEdit,
  sleep,
  symbolKindToIcon,
  uriToFile,
} from "./utils";

// =============================================================================
// Tool Description
// =============================================================================

const DESCRIPTION = `Interact with Language Server Protocol (LSP) servers for code intelligence.

**Actions:**
- \`definition\` - Go to definition of symbol at position
- \`references\` - Find all references to symbol at position
- \`hover\` - Get type/documentation info at position
- \`symbols\` - List all symbols in a file
- \`workspace_symbols\` - Search symbols across workspace (requires \`query\`)
- \`diagnostics\` - Get errors/warnings for file(s)
- \`workspace_diagnostics\` - Check entire project for issues
- \`rename\` - Rename symbol (requires \`new_name\`)
- \`actions\` - Get/apply code actions at position
- \`incoming_calls\` - Find callers of function at position
- \`outgoing_calls\` - Find functions called by function at position
- \`status\` - Show active LSP servers

**Rust-analyzer specific:**
- \`flycheck\` - Run cargo check
- \`expand_macro\` - Expand macro at position
- \`ssr\` - Structural search/replace (requires \`query\`, \`replacement\`)
- \`runnables\` - List runnable targets
- \`related_tests\` - Find tests for code at position
- \`reload_workspace\` - Reload Cargo workspace

**Parameters:**
- \`file\` - File path (required for most actions)
- \`line\`, \`column\` - 1-based position (required for position-based actions)
- \`query\` - Search query for workspace_symbols/ssr
- \`new_name\` - New name for rename action
- \`apply\` - Apply changes (default: true for rename, false for ssr)
- \`action_index\` - Index of code action to apply

**Supported languages:** TypeScript, JavaScript, Rust, Go, Python, C/C++, and many more.
**Note:** Requires LSP servers to be installed (typescript-language-server, rust-analyzer, gopls, pyright, etc.)`;

// =============================================================================
// Helpers
// =============================================================================

function resolveToCwd(filePath: string, cwd: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
}

async function waitForDiagnostics(
  client: { diagnostics: Map<string, Diagnostic[]> },
  uri: string,
  timeoutMs = 3000,
): Promise<Diagnostic[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const diagnostics = client.diagnostics.get(uri);
    if (diagnostics !== undefined) return diagnostics;
    await sleep(100);
  }
  return client.diagnostics.get(uri) ?? [];
}

function detectProjectType(cwd: string): { type: string; command?: string[]; description: string } {
  if (existsSync(path.join(cwd, "Cargo.toml"))) {
    return {
      type: "rust",
      command: ["cargo", "check", "--message-format=short"],
      description: "Rust (cargo check)",
    };
  }
  if (existsSync(path.join(cwd, "tsconfig.json"))) {
    return {
      type: "typescript",
      command: ["npx", "tsc", "--noEmit"],
      description: "TypeScript (tsc --noEmit)",
    };
  }
  if (existsSync(path.join(cwd, "go.mod"))) {
    return { type: "go", command: ["go", "build", "./..."], description: "Go (go build)" };
  }
  if (
    existsSync(path.join(cwd, "pyproject.toml")) ||
    existsSync(path.join(cwd, "pyrightconfig.json"))
  ) {
    return { type: "python", command: ["pyright"], description: "Python (pyright)" };
  }
  return { type: "unknown", description: "Unknown project type" };
}

function getLspServers(config: LspConfig): Array<[string, ServerConfig]> {
  return (Object.entries(config.servers) as Array<[string, ServerConfig]>).filter(
    ([, serverConfig]) => !serverConfig.createClient,
  );
}

function getLspServerForFile(config: LspConfig, filePath: string): [string, ServerConfig] | null {
  const servers = getServersForFile(config, filePath).filter(
    ([, serverConfig]) => !serverConfig.createClient,
  );
  return servers.length > 0 ? servers[0] : null;
}

function getRustServer(config: LspConfig): [string, ServerConfig] | null {
  const entries = getLspServers(config);
  const byName = entries.find(
    ([name, server]) => name === "rust-analyzer" || server.command === "rust-analyzer",
  );
  if (byName) return byName;

  for (const [name, server] of entries) {
    if (hasCapability(server, "flycheck")) {
      return [name, server];
    }
  }

  return null;
}

function getServerForWorkspaceAction(
  config: LspConfig,
  action: string,
): [string, ServerConfig] | null {
  const entries = getLspServers(config);
  if (entries.length === 0) return null;

  if (action === "workspace_symbols") {
    return entries[0];
  }

  if (
    action === "flycheck" ||
    action === "ssr" ||
    action === "runnables" ||
    action === "reload_workspace"
  ) {
    return getRustServer(config);
  }

  return null;
}

const FILE_SEARCH_MAX_DEPTH = 5;
const IGNORED_DIRS = new Set(["node_modules", "target", "dist", "build", ".git"]);

function findFileByExtensions(
  baseDir: string,
  extensions: string[],
  maxDepth: number,
): string | null {
  const normalized = extensions.map((ext) => ext.toLowerCase());
  const search = (dir: string, depth: number): string | null => {
    if (depth > maxDepth) return null;
    let entries: string[] = [];
    try {
      entries = Array.from(new Bun.Glob("*").scanSync({ cwd: dir, onlyFiles: false }));
    } catch {
      return null;
    }

    for (const name of entries) {
      if (name.startsWith(".")) continue;
      if (IGNORED_DIRS.has(name)) continue;
      const fullPath = path.join(dir, name);
      try {
        const stat = statSync(fullPath);
        if (stat.isFile()) {
          const lowerName = name.toLowerCase();
          if (normalized.some((ext) => lowerName.endsWith(ext))) {
            return fullPath;
          }
        } else if (stat.isDirectory()) {
          const found = search(fullPath, depth + 1);
          if (found) return found;
        }
      } catch {
        continue;
      }
    }
    return null;
  };

  return search(baseDir, 0);
}

// =============================================================================
// Config Cache
// =============================================================================

const configCache = new Map<string, LspConfig>();

async function getConfig(cwd: string): Promise<LspConfig> {
  let config = configCache.get(cwd);
  if (!config) {
    config = await loadConfig(cwd);
    setIdleTimeout(config.idleTimeoutMs);
    configCache.set(cwd, config);
  }
  return config;
}

// =============================================================================
// Diagnostics Helpers
// =============================================================================

async function getDiagnosticsForFile(
  absolutePath: string,
  cwd: string,
  servers: Array<[string, ServerConfig]>,
  signal?: AbortSignal,
): Promise<{ server?: string; messages: string[]; summary: string; errored: boolean } | undefined> {
  if (servers.length === 0) {
    return undefined;
  }

  const uri = fileToUri(absolutePath);
  const relPath = path.relative(cwd, absolutePath);
  const allDiagnostics: Diagnostic[] = [];
  const serverNames: string[] = [];

  const results = await Promise.allSettled(
    servers.map(async ([serverName, serverConfig]) => {
      signal?.throwIfAborted();
      if (serverConfig.createClient) {
        const linterClient = getLinterClient(serverName, serverConfig, cwd);
        const diagnostics = await linterClient.lint(absolutePath);
        return { serverName, diagnostics };
      }

      const client = await getOrCreateClient(serverConfig, cwd);
      signal?.throwIfAborted();
      const diagnostics = await waitForDiagnostics(client, uri, 3000);
      return { serverName, diagnostics };
    }),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      serverNames.push(result.value.serverName);
      allDiagnostics.push(...result.value.diagnostics);
    }
  }

  if (serverNames.length === 0) {
    return undefined;
  }

  if (allDiagnostics.length === 0) {
    return {
      server: serverNames.join(", "),
      messages: [],
      summary: "OK",
      errored: false,
    };
  }

  const seen = new Set<string>();
  const uniqueDiagnostics: Diagnostic[] = [];
  for (const d of allDiagnostics) {
    const key = `${d.range.start.line}:${d.range.start.character}:${d.range.end.line}:${d.range.end.character}:${d.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueDiagnostics.push(d);
    }
  }

  const formatted = uniqueDiagnostics.map((d) => formatDiagnostic(d, relPath));
  const summary = formatDiagnosticsSummary(uniqueDiagnostics);
  const hasErrors = uniqueDiagnostics.some((d) => d.severity === 1);

  return {
    server: serverNames.join(", "),
    messages: formatted,
    summary,
    errored: hasErrors,
  };
}

async function runWorkspaceDiagnostics(
  cwd: string,
  config: LspConfig,
): Promise<{ output: string; projectType: { type: string; description: string } }> {
  const projectType = detectProjectType(cwd);

  if (projectType.type === "rust") {
    const rustServer = getRustServer(config);
    if (rustServer && hasCapability(rustServer[1], "flycheck")) {
      const [, serverConfig] = rustServer;
      try {
        const client = await getOrCreateClient(serverConfig, cwd);
        await rustAnalyzer.flycheck(client);

        const collected: Array<{ filePath: string; diagnostic: Diagnostic }> = [];
        for (const [diagUri, diags] of client.diagnostics.entries()) {
          const relPath = path.relative(cwd, uriToFile(diagUri));
          for (const diag of diags) {
            collected.push({ filePath: relPath, diagnostic: diag });
          }
        }

        if (collected.length === 0) {
          return { output: "No issues found", projectType };
        }

        const summary = formatDiagnosticsSummary(collected.map((d) => d.diagnostic));
        const formatted = collected
          .slice(0, 50)
          .map((d) => formatDiagnostic(d.diagnostic, d.filePath));
        const more = collected.length > 50 ? `\n  ... and ${collected.length - 50} more` : "";
        return {
          output: `${summary}:\n${formatted.map((f) => `  ${f}`).join("\n")}${more}`,
          projectType,
        };
      } catch {
        // Fall through to shell command
      }
    }
  }

  if (!projectType.command) {
    return {
      output: `Cannot detect project type. Supported: Rust (Cargo.toml), TypeScript (tsconfig.json), Go (go.mod), Python (pyproject.toml)`,
      projectType,
    };
  }

  try {
    const proc = Bun.spawn(projectType.command, {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;

    const combined = (stdout + stderr).trim();
    if (!combined) {
      return { output: "No issues found", projectType };
    }

    const lines = combined.split("\n");
    if (lines.length > 50) {
      return {
        output: `${lines.slice(0, 50).join("\n")}\n... and ${lines.length - 50} more lines`,
        projectType,
      };
    }

    return { output: combined, projectType };
  } catch (e) {
    return { output: `Failed to run ${projectType.command.join(" ")}: ${e}`, projectType };
  }
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (pi: ExtensionAPI) {
  const cwd = process.cwd();

  pi.registerTool({
    name: "lsp",
    label: "LSP",
    description: DESCRIPTION,
    parameters: lspSchema,

    async execute(_toolCallId, params: LspParams, onUpdate) {
      const {
        action,
        file,
        files,
        line,
        column,
        end_line,
        end_character,
        query,
        new_name,
        replacement,
        kind,
        apply,
        action_index,
        include_declaration,
      } = params;

      const config = await getConfig(cwd);

      // Status action
      if (action === "status") {
        const servers = Object.keys(config.servers);
        const output =
          servers.length > 0
            ? `Active language servers: ${servers.join(", ")}`
            : "No language servers configured for this project";
        return {
          content: [{ type: "text", text: output }],
          details: { action, success: true },
        };
      }

      // Workspace diagnostics
      if (action === "workspace_diagnostics") {
        const result = await runWorkspaceDiagnostics(cwd, config);
        return {
          content: [
            {
              type: "text",
              text: `Workspace diagnostics (${result.projectType.description}):\n${result.output}`,
            },
          ],
          details: { action, success: true },
        };
      }

      // Diagnostics (batch or single-file)
      if (action === "diagnostics") {
        const targets = files?.length ? files : file ? [file] : null;
        if (!targets) {
          return {
            content: [
              { type: "text", text: "Error: file or files parameter required for diagnostics" },
            ],
            details: { action, success: false },
          };
        }

        const detailed = Boolean(files?.length);
        const results: string[] = [];
        const allServerNames = new Set<string>();

        for (const target of targets) {
          const resolved = resolveToCwd(target, cwd);
          const servers = getServersForFile(config, resolved);
          if (servers.length === 0) {
            results.push(`✗ ${target}: No language server found`);
            continue;
          }

          const uri = fileToUri(resolved);
          const relPath = path.relative(cwd, resolved);
          const allDiagnostics: Diagnostic[] = [];

          for (const [serverName, serverConfig] of servers) {
            allServerNames.add(serverName);
            try {
              if (serverConfig.createClient) {
                const linterClient = getLinterClient(serverName, serverConfig, cwd);
                const diagnostics = await linterClient.lint(resolved);
                allDiagnostics.push(...diagnostics);
                continue;
              }
              const client = await getOrCreateClient(serverConfig, cwd);
              await refreshFile(client, resolved);
              const diagnostics = await waitForDiagnostics(client, uri);
              allDiagnostics.push(...diagnostics);
            } catch {
              // Server failed
            }
          }

          const seen = new Set<string>();
          const uniqueDiagnostics: Diagnostic[] = [];
          for (const d of allDiagnostics) {
            const key = `${d.range.start.line}:${d.range.start.character}:${d.range.end.line}:${d.range.end.character}:${d.message}`;
            if (!seen.has(key)) {
              seen.add(key);
              uniqueDiagnostics.push(d);
            }
          }

          if (!detailed && targets.length === 1) {
            if (uniqueDiagnostics.length === 0) {
              return {
                content: [{ type: "text", text: "No diagnostics" }],
                details: {
                  action,
                  serverName: Array.from(allServerNames).join(", "),
                  success: true,
                },
              };
            }

            const summary = formatDiagnosticsSummary(uniqueDiagnostics);
            const formatted = uniqueDiagnostics.map((d) => formatDiagnostic(d, relPath));
            const output = `${summary}:\n${formatted.map((f) => `  ${f}`).join("\n")}`;
            return {
              content: [{ type: "text", text: output }],
              details: { action, serverName: Array.from(allServerNames).join(", "), success: true },
            };
          }

          if (uniqueDiagnostics.length === 0) {
            results.push(`✓ ${relPath}: no issues`);
          } else {
            const summary = formatDiagnosticsSummary(uniqueDiagnostics);
            results.push(`✗ ${relPath}: ${summary}`);
            for (const diag of uniqueDiagnostics) {
              results.push(`  ${formatDiagnostic(diag, relPath)}`);
            }
          }
        }

        return {
          content: [{ type: "text", text: results.join("\n") }],
          details: { action, serverName: Array.from(allServerNames).join(", "), success: true },
        };
      }

      // Check if file is required
      const requiresFile =
        !file &&
        action !== "workspace_symbols" &&
        action !== "flycheck" &&
        action !== "ssr" &&
        action !== "runnables" &&
        action !== "reload_workspace";

      if (requiresFile) {
        return {
          content: [{ type: "text", text: "Error: file parameter required for this action" }],
          details: { action, success: false },
        };
      }

      const resolvedFile = file ? resolveToCwd(file, cwd) : null;
      const serverInfo = resolvedFile
        ? getLspServerForFile(config, resolvedFile)
        : getServerForWorkspaceAction(config, action);

      if (!serverInfo) {
        return {
          content: [{ type: "text", text: "No language server found for this action" }],
          details: { action, success: false },
        };
      }

      const [serverName, serverConfig] = serverInfo;

      try {
        const client = await getOrCreateClient(serverConfig, cwd);
        let targetFile = resolvedFile;
        if (action === "runnables" && !targetFile) {
          targetFile = findFileByExtensions(cwd, serverConfig.fileTypes, FILE_SEARCH_MAX_DEPTH);
          if (!targetFile) {
            return {
              content: [{ type: "text", text: "Error: no matching files found for runnables" }],
              details: { action, serverName, success: false },
            };
          }
        }

        if (targetFile) {
          await ensureFileOpen(client, targetFile);
        }

        const uri = targetFile ? fileToUri(targetFile) : "";
        const position = { line: (line || 1) - 1, character: (column || 1) - 1 };

        let output: string;

        switch (action) {
          case "definition": {
            const result = (await sendRequest(client, "textDocument/definition", {
              textDocument: { uri },
              position,
            })) as Location | Location[] | LocationLink | LocationLink[] | null;

            if (!result) {
              output = "No definition found";
            } else {
              const raw = Array.isArray(result) ? result : [result];
              const locations = raw.flatMap((loc) => {
                if ("uri" in loc) {
                  return [loc as Location];
                }
                if ("targetUri" in loc) {
                  const link = loc as LocationLink;
                  return [
                    { uri: link.targetUri, range: link.targetSelectionRange ?? link.targetRange },
                  ];
                }
                return [];
              });

              if (locations.length === 0) {
                output = "No definition found";
              } else {
                output = `Found ${locations.length} definition(s):\n${locations
                  .map((loc) => `  ${formatLocation(loc, cwd)}`)
                  .join("\n")}`;
              }
            }
            break;
          }

          case "references": {
            const result = (await sendRequest(client, "textDocument/references", {
              textDocument: { uri },
              position,
              context: { includeDeclaration: include_declaration ?? true },
            })) as Location[] | null;

            if (!result || result.length === 0) {
              output = "No references found";
            } else {
              const lines = result.map((loc) => `  ${formatLocation(loc, cwd)}`);
              output = `Found ${result.length} reference(s):\n${lines.join("\n")}`;
            }
            break;
          }

          case "hover": {
            const result = (await sendRequest(client, "textDocument/hover", {
              textDocument: { uri },
              position,
            })) as Hover | null;

            if (!result || !result.contents) {
              output = "No hover information";
            } else {
              output = extractHoverText(result.contents);
            }
            break;
          }

          case "symbols": {
            const result = (await sendRequest(client, "textDocument/documentSymbol", {
              textDocument: { uri },
            })) as (DocumentSymbol | SymbolInformation)[] | null;

            if (!result || result.length === 0) {
              output = "No symbols found";
            } else if (!targetFile) {
              return {
                content: [{ type: "text", text: "Error: file parameter required for symbols" }],
                details: { action, serverName, success: false },
              };
            } else {
              const relPath = path.relative(cwd, targetFile);
              if ("selectionRange" in result[0]) {
                const lines = (result as DocumentSymbol[]).flatMap((s) => formatDocumentSymbol(s));
                output = `Symbols in ${relPath}:\n${lines.join("\n")}`;
              } else {
                const lines = (result as SymbolInformation[]).map((s) => {
                  const line = s.location.range.start.line + 1;
                  const icon = symbolKindToIcon(s.kind);
                  return `${icon} ${s.name} @ line ${line}`;
                });
                output = `Symbols in ${relPath}:\n${lines.join("\n")}`;
              }
            }
            break;
          }

          case "workspace_symbols": {
            if (!query) {
              return {
                content: [
                  { type: "text", text: "Error: query parameter required for workspace_symbols" },
                ],
                details: { action, serverName, success: false },
              };
            }

            const result = (await sendRequest(client, "workspace/symbol", { query })) as
              | SymbolInformation[]
              | null;

            if (!result || result.length === 0) {
              output = `No symbols matching "${query}"`;
            } else {
              const lines = result.map((s) => formatSymbolInformation(s, cwd));
              output = `Found ${result.length} symbol(s) matching "${query}":\n${lines.map((l) => `  ${l}`).join("\n")}`;
            }
            break;
          }

          case "rename": {
            if (!new_name) {
              return {
                content: [{ type: "text", text: "Error: new_name parameter required for rename" }],
                details: { action, serverName, success: false },
              };
            }

            const result = (await sendRequest(client, "textDocument/rename", {
              textDocument: { uri },
              position,
              newName: new_name,
            })) as WorkspaceEdit | null;

            if (!result) {
              output = "Rename returned no edits";
            } else {
              const shouldApply = apply !== false;
              if (shouldApply) {
                const applied = await applyWorkspaceEdit(result, cwd);
                output = `Applied rename:\n${applied.map((a) => `  ${a}`).join("\n")}`;
              } else {
                const preview = formatWorkspaceEdit(result, cwd);
                output = `Rename preview:\n${preview.map((p) => `  ${p}`).join("\n")}`;
              }
            }
            break;
          }

          case "actions": {
            if (!targetFile) {
              return {
                content: [{ type: "text", text: "Error: file parameter required for actions" }],
                details: { action, serverName, success: false },
              };
            }

            await refreshFile(client, targetFile);
            const diagnostics = await waitForDiagnostics(client, uri);
            const endLine = (end_line ?? line ?? 1) - 1;
            const endCharacter = (end_character ?? column ?? 1) - 1;
            const range = { start: position, end: { line: endLine, character: endCharacter } };
            const relevantDiagnostics = diagnostics.filter(
              (d) => d.range.start.line <= range.end.line && d.range.end.line >= range.start.line,
            );

            const codeActionContext: { diagnostics: Diagnostic[]; only?: string[] } = {
              diagnostics: relevantDiagnostics,
            };
            if (kind) {
              codeActionContext.only = [kind];
            }

            const result = (await sendRequest(client, "textDocument/codeAction", {
              textDocument: { uri },
              range,
              context: codeActionContext,
            })) as Array<CodeAction | Command> | null;

            if (!result || result.length === 0) {
              output = "No code actions available";
            } else if (action_index !== undefined) {
              if (action_index < 0 || action_index >= result.length) {
                return {
                  content: [
                    {
                      type: "text",
                      text: `Error: action_index ${action_index} out of range (0-${result.length - 1})`,
                    },
                  ],
                  details: { action, serverName, success: false },
                };
              }

              const isCommand = (candidate: CodeAction | Command): candidate is Command =>
                typeof (candidate as Command).command === "string";
              const isCodeAction = (candidate: CodeAction | Command): candidate is CodeAction =>
                !isCommand(candidate);
              const getCommandPayload = (
                candidate: CodeAction | Command,
              ): { command: string; arguments?: unknown[] } | null => {
                if (isCommand(candidate)) {
                  return { command: candidate.command, arguments: candidate.arguments };
                }
                if (candidate.command) {
                  return {
                    command: candidate.command.command,
                    arguments: candidate.command.arguments,
                  };
                }
                return null;
              };

              const codeAction = result[action_index];

              let resolvedAction = codeAction;
              if (
                isCodeAction(codeAction) &&
                !codeAction.edit &&
                codeAction.data &&
                client.serverCapabilities?.codeActionProvider
              ) {
                const provider = client.serverCapabilities.codeActionProvider;
                if (typeof provider === "object" && provider.resolveProvider) {
                  resolvedAction = (await sendRequest(
                    client,
                    "codeAction/resolve",
                    codeAction,
                  )) as CodeAction;
                }
              }

              if (isCodeAction(resolvedAction) && resolvedAction.edit) {
                const applied = await applyWorkspaceEdit(resolvedAction.edit, cwd);
                output = `Applied "${codeAction.title}":\n${applied.map((a) => `  ${a}`).join("\n")}`;
              } else {
                const commandPayload = getCommandPayload(resolvedAction);
                if (commandPayload) {
                  await sendRequest(client, "workspace/executeCommand", commandPayload);
                  output = `Executed "${codeAction.title}"`;
                } else {
                  output = `Code action "${codeAction.title}" has no edits or command to apply`;
                }
              }
            } else {
              const lines = result.map((actionItem, i) => {
                if ("kind" in actionItem || "isPreferred" in actionItem || "edit" in actionItem) {
                  const actionDetails = actionItem as CodeAction;
                  const preferred = actionDetails.isPreferred ? " (preferred)" : "";
                  const kindInfo = actionDetails.kind ? ` [${actionDetails.kind}]` : "";
                  return `  [${i}] ${actionDetails.title}${kindInfo}${preferred}`;
                }
                return `  [${i}] ${actionItem.title}`;
              });
              output = `Available code actions:\n${lines.join("\n")}\n\nUse action_index parameter to apply a specific action.`;
            }
            break;
          }

          case "incoming_calls":
          case "outgoing_calls": {
            const prepareResult = (await sendRequest(client, "textDocument/prepareCallHierarchy", {
              textDocument: { uri },
              position,
            })) as CallHierarchyItem[] | null;

            if (!prepareResult || prepareResult.length === 0) {
              output = "No callable symbol found at this position";
              break;
            }

            const item = prepareResult[0];

            if (action === "incoming_calls") {
              const calls = (await sendRequest(client, "callHierarchy/incomingCalls", { item })) as
                | CallHierarchyIncomingCall[]
                | null;

              if (!calls || calls.length === 0) {
                output = `No callers found for "${item.name}"`;
              } else {
                const lines = calls.map((call) => {
                  const loc = { uri: call.from.uri, range: call.from.selectionRange };
                  const detail = call.from.detail ? ` (${call.from.detail})` : "";
                  return `  ${call.from.name}${detail} @ ${formatLocation(loc, cwd)}`;
                });
                output = `Found ${calls.length} caller(s) of "${item.name}":\n${lines.join("\n")}`;
              }
            } else {
              const calls = (await sendRequest(client, "callHierarchy/outgoingCalls", { item })) as
                | CallHierarchyOutgoingCall[]
                | null;

              if (!calls || calls.length === 0) {
                output = `"${item.name}" doesn't call any functions`;
              } else {
                const lines = calls.map((call) => {
                  const loc = { uri: call.to.uri, range: call.to.selectionRange };
                  const detail = call.to.detail ? ` (${call.to.detail})` : "";
                  return `  ${call.to.name}${detail} @ ${formatLocation(loc, cwd)}`;
                });
                output = `"${item.name}" calls ${calls.length} function(s):\n${lines.join("\n")}`;
              }
            }
            break;
          }

          // Rust-analyzer specific
          case "flycheck": {
            if (!hasCapability(serverConfig, "flycheck")) {
              return {
                content: [{ type: "text", text: "Error: flycheck requires rust-analyzer" }],
                details: { action, serverName, success: false },
              };
            }

            await rustAnalyzer.flycheck(client, resolvedFile ?? undefined);
            const collected: Array<{ filePath: string; diagnostic: Diagnostic }> = [];
            for (const [diagUri, diags] of client.diagnostics.entries()) {
              const relPath = path.relative(cwd, uriToFile(diagUri));
              for (const diag of diags) {
                collected.push({ filePath: relPath, diagnostic: diag });
              }
            }

            if (collected.length === 0) {
              output = "Flycheck: no issues found";
            } else {
              const summary = formatDiagnosticsSummary(collected.map((d) => d.diagnostic));
              const formatted = collected
                .slice(0, 20)
                .map((d) => formatDiagnostic(d.diagnostic, d.filePath));
              const more = collected.length > 20 ? `\n  ... and ${collected.length - 20} more` : "";
              output = `Flycheck ${summary}:\n${formatted.map((f) => `  ${f}`).join("\n")}${more}`;
            }
            break;
          }

          case "expand_macro": {
            if (!hasCapability(serverConfig, "expandMacro")) {
              return {
                content: [{ type: "text", text: "Error: expand_macro requires rust-analyzer" }],
                details: { action, serverName, success: false },
              };
            }

            if (!targetFile) {
              return {
                content: [
                  { type: "text", text: "Error: file parameter required for expand_macro" },
                ],
                details: { action, serverName, success: false },
              };
            }

            const result = await rustAnalyzer.expandMacro(
              client,
              targetFile,
              line || 1,
              column || 1,
            );
            if (!result) {
              output = "No macro expansion at this position";
            } else {
              output = `Macro: ${result.name}\n\nExpansion:\n${result.expansion}`;
            }
            break;
          }

          case "ssr": {
            if (!hasCapability(serverConfig, "ssr")) {
              return {
                content: [{ type: "text", text: "Error: ssr requires rust-analyzer" }],
                details: { action, serverName, success: false },
              };
            }

            if (!query) {
              return {
                content: [
                  { type: "text", text: "Error: query parameter (pattern) required for ssr" },
                ],
                details: { action, serverName, success: false },
              };
            }

            if (!replacement) {
              return {
                content: [{ type: "text", text: "Error: replacement parameter required for ssr" }],
                details: { action, serverName, success: false },
              };
            }

            const shouldApply = apply === true;
            const result = await rustAnalyzer.ssr(client, query, replacement, !shouldApply);

            if (shouldApply) {
              const applied = await applyWorkspaceEdit(result, cwd);
              output =
                applied.length > 0
                  ? `Applied SSR:\n${applied.map((a) => `  ${a}`).join("\n")}`
                  : "SSR: no matches found";
            } else {
              const preview = formatWorkspaceEdit(result, cwd);
              output =
                preview.length > 0
                  ? `SSR preview:\n${preview.map((p) => `  ${p}`).join("\n")}`
                  : "SSR: no matches found";
            }
            break;
          }

          case "runnables": {
            if (!hasCapability(serverConfig, "runnables")) {
              return {
                content: [{ type: "text", text: "Error: runnables requires rust-analyzer" }],
                details: { action, serverName, success: false },
              };
            }

            if (!targetFile) {
              return {
                content: [{ type: "text", text: "Error: file parameter required for runnables" }],
                details: { action, serverName, success: false },
              };
            }

            const result = await rustAnalyzer.runnables(client, targetFile, line);
            if (result.length === 0) {
              output = "No runnables found";
            } else {
              const lines = result.map((r) => {
                const args = r.args?.cargoArgs?.join(" ") || "";
                return `  [${r.kind}] ${r.label}${args ? ` (cargo ${args})` : ""}`;
              });
              output = `Found ${result.length} runnable(s):\n${lines.join("\n")}`;
            }
            break;
          }

          case "related_tests": {
            if (!hasCapability(serverConfig, "relatedTests")) {
              return {
                content: [{ type: "text", text: "Error: related_tests requires rust-analyzer" }],
                details: { action, serverName, success: false },
              };
            }

            if (!targetFile) {
              return {
                content: [
                  { type: "text", text: "Error: file parameter required for related_tests" },
                ],
                details: { action, serverName, success: false },
              };
            }

            const result = await rustAnalyzer.relatedTests(
              client,
              targetFile,
              line || 1,
              column || 1,
            );
            if (result.length === 0) {
              output = "No related tests found";
            } else {
              output = `Found ${result.length} related test(s):\n${result.map((t) => `  ${t}`).join("\n")}`;
            }
            break;
          }

          case "reload_workspace": {
            await rustAnalyzer.reloadWorkspace(client);
            output = "Workspace reloaded successfully";
            break;
          }

          default:
            output = `Unknown action: ${action}`;
        }

        return {
          content: [{ type: "text", text: output }],
          details: { serverName, action, success: true, file: targetFile },
        };
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `LSP error: ${errorMessage}` }],
          details: { serverName, action, success: false, file: resolvedFile },
        };
      }
    },

    renderCall(args, theme) {
      const p = args as LspParams & { file?: string; files?: string[] };

      let text = theme.fg("toolTitle", theme.bold("lsp "));
      text += theme.fg("accent", p.action || "?");

      if (p.file) {
        text += ` ${theme.fg("muted", p.file)}`;
      } else if (p.files?.length) {
        text += ` ${theme.fg("muted", `${p.files.length} file(s)`)}`;
      }

      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as LspToolDetails | undefined;
      const content = result.content?.[0];

      if (!content || content.type !== "text" || !("text" in content)) {
        return new Text(theme.fg("error", "No result"), 0, 0);
      }

      const text = content.text;

      if (!details?.success) {
        return new Text(theme.fg("error", text), 0, 0);
      }

      const icon = theme.fg("success", "✓");

      // Detect language from file path
      const fileLang = details.file ? getLanguageFromPath(details.file) : undefined;

      // Detect code blocks and apply syntax highlighting
      const formatOutput = (raw: string): string => {
        // Match ```language ... ``` blocks, use detected lang as fallback
        return raw.replace(/```(\w+)?\n([\s\S]*?)```/g, (_match, blockLang, code) => {
          const language = blockLang || fileLang || "text";
          const highlighted = highlightCode(code.trim(), language);
          return highlighted.join("\n");
        });
      };

      const lines = text.split("\n");
      const PREVIEW_LINES = 8;

      if (!expanded && lines.length > PREVIEW_LINES) {
        const preview = lines.slice(0, PREVIEW_LINES).join("\n");
        const hiddenCount = lines.length - PREVIEW_LINES;
        return new Text(
          `${icon} ${theme.fg("muted", details.action)}\n${formatOutput(preview)}\n${theme.fg("dim", `... ${hiddenCount} more lines`)}`,
          0,
          0,
        );
      }

      return new Text(`${icon} ${theme.fg("muted", details.action)}\n${formatOutput(text)}`, 0, 0);
    },
  });

  // Cleanup on shutdown
  pi.on("session_shutdown", async () => {
    shutdownAll();
    configCache.clear();
  });
}
