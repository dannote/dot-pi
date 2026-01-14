/**
 * LSP Client Management
 */

import * as fs from "node:fs";
import type { Diagnostic, WorkspaceEdit } from "vscode-languageserver-types";
import { applyWorkspaceEdit } from "./edits";
import type {
  LspClient,
  LspJsonRpcNotification,
  LspJsonRpcRequest,
  LspJsonRpcResponse,
  ServerConfig,
} from "./types";
import { detectLanguageId, fileToUri } from "./utils";

const clients = new Map<string, LspClient>();
const clientLocks = new Map<string, Promise<LspClient>>();
const fileOperationLocks = new Map<string, Promise<void>>();

let idleTimeoutMs: number | null = null;
let idleCheckInterval: ReturnType<typeof setInterval> | null = null;
const IDLE_CHECK_INTERVAL_MS = 60 * 1000;

export function setIdleTimeout(ms: number | null | undefined): void {
  idleTimeoutMs = ms ?? null;

  if (idleTimeoutMs && idleTimeoutMs > 0) {
    startIdleChecker();
  } else {
    stopIdleChecker();
  }
}

function startIdleChecker(): void {
  if (idleCheckInterval) return;
  idleCheckInterval = setInterval(() => {
    if (!idleTimeoutMs) return;
    const now = Date.now();
    for (const [key, client] of Array.from(clients.entries())) {
      if (now - client.lastActivity > idleTimeoutMs) {
        shutdownClient(key);
      }
    }
  }, IDLE_CHECK_INTERVAL_MS);
}

function stopIdleChecker(): void {
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
    idleCheckInterval = null;
  }
}

const CLIENT_CAPABILITIES = {
  textDocument: {
    synchronization: {
      didSave: true,
      dynamicRegistration: false,
      willSave: false,
      willSaveWaitUntil: false,
    },
    hover: {
      contentFormat: ["markdown", "plaintext"],
      dynamicRegistration: false,
    },
    definition: {
      dynamicRegistration: false,
      linkSupport: true,
    },
    references: {
      dynamicRegistration: false,
    },
    documentSymbol: {
      dynamicRegistration: false,
      hierarchicalDocumentSymbolSupport: true,
      symbolKind: {
        valueSet: [
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
          26,
        ],
      },
    },
    rename: {
      dynamicRegistration: false,
      prepareSupport: true,
    },
    codeAction: {
      dynamicRegistration: false,
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: [
            "quickfix",
            "refactor",
            "refactor.extract",
            "refactor.inline",
            "refactor.rewrite",
            "source",
            "source.organizeImports",
            "source.fixAll",
          ],
        },
      },
      resolveSupport: {
        properties: ["edit"],
      },
    },
    formatting: {
      dynamicRegistration: false,
    },
    rangeFormatting: {
      dynamicRegistration: false,
    },
    publishDiagnostics: {
      relatedInformation: true,
      versionSupport: false,
      tagSupport: { valueSet: [1, 2] },
      codeDescriptionSupport: true,
      dataSupport: true,
    },
  },
  workspace: {
    applyEdit: true,
    workspaceEdit: {
      documentChanges: true,
      resourceOperations: ["create", "rename", "delete"],
      failureHandling: "textOnlyTransactional",
    },
    configuration: true,
    symbol: {
      dynamicRegistration: false,
      symbolKind: {
        valueSet: [
          1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
          26,
        ],
      },
    },
  },
  experimental: {
    snippetTextEdit: true,
  },
};

function parseMessage(
  buffer: Uint8Array,
): { message: LspJsonRpcResponse | LspJsonRpcNotification; remaining: Uint8Array } | null {
  const headerEndIndex = findHeaderEnd(buffer);
  if (headerEndIndex === -1) return null;

  const headerText = new TextDecoder().decode(buffer.slice(0, headerEndIndex));
  const contentLengthMatch = headerText.match(/Content-Length: (\d+)/i);
  if (!contentLengthMatch) return null;

  const contentLength = Number.parseInt(contentLengthMatch[1], 10);
  const messageStart = headerEndIndex + 4;
  const messageEnd = messageStart + contentLength;

  if (buffer.length < messageEnd) return null;

  const messageBytes = buffer.slice(messageStart, messageEnd);
  const messageText = new TextDecoder().decode(messageBytes);
  const remaining = buffer.slice(messageEnd);

  return {
    message: JSON.parse(messageText),
    remaining,
  };
}

function findHeaderEnd(buffer: Uint8Array): number {
  for (let i = 0; i < buffer.length - 3; i++) {
    if (buffer[i] === 13 && buffer[i + 1] === 10 && buffer[i + 2] === 13 && buffer[i + 3] === 10) {
      return i;
    }
  }
  return -1;
}

function concatBuffers(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

async function writeMessage(
  sink: import("bun").FileSink,
  message: LspJsonRpcRequest | LspJsonRpcNotification | LspJsonRpcResponse,
): Promise<void> {
  const content = JSON.stringify(message);
  const contentBytes = new TextEncoder().encode(content);
  const header = `Content-Length: ${contentBytes.length}\r\n\r\n`;
  const fullMessage = new TextEncoder().encode(header + content);

  sink.write(fullMessage);
  await sink.flush();
}

async function startMessageReader(client: LspClient): Promise<void> {
  if (client.isReading) return;
  client.isReading = true;

  const reader = (client.process.stdout as ReadableStream<Uint8Array>).getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const currentBuffer = concatBuffers(client.messageBuffer, value);
      client.messageBuffer = currentBuffer;

      let workingBuffer = currentBuffer;
      let parsed = parseMessage(workingBuffer);
      while (parsed) {
        const { message, remaining } = parsed;
        workingBuffer = remaining;

        if ("id" in message && message.id !== undefined) {
          const pending = client.pendingRequests.get(message.id);
          if (pending) {
            client.pendingRequests.delete(message.id);
            if ("error" in message && message.error) {
              pending.reject(new Error(`LSP error: ${message.error.message}`));
            } else {
              pending.resolve(message.result);
            }
          } else if ("method" in message) {
            await handleServerRequest(client, message as LspJsonRpcRequest);
          }
        } else if ("method" in message) {
          if (message.method === "textDocument/publishDiagnostics" && message.params) {
            const params = message.params as { uri: string; diagnostics: Diagnostic[] };
            client.diagnostics.set(params.uri, params.diagnostics);
            client.diagnosticsVersion += 1;
          }
        }

        parsed = parseMessage(workingBuffer);
      }

      client.messageBuffer = workingBuffer;
    }
  } catch (err) {
    for (const pending of Array.from(client.pendingRequests.values())) {
      pending.reject(new Error(`LSP connection closed: ${err}`));
    }
    client.pendingRequests.clear();
  } finally {
    reader.releaseLock();
    client.isReading = false;
  }
}

async function handleConfigurationRequest(
  client: LspClient,
  message: LspJsonRpcRequest,
): Promise<void> {
  if (typeof message.id !== "number") return;
  const params = message.params as { items?: Array<{ section?: string }> };
  const items = params?.items ?? [];
  const result = items.map((item) => {
    const section = item.section ?? "";
    return client.config.settings?.[section] ?? {};
  });
  await sendResponse(client, message.id, result, "workspace/configuration");
}

async function handleApplyEditRequest(
  client: LspClient,
  message: LspJsonRpcRequest,
): Promise<void> {
  if (typeof message.id !== "number") return;
  const params = message.params as { edit?: WorkspaceEdit };
  if (!params?.edit) {
    await sendResponse(
      client,
      message.id,
      { applied: false, failureReason: "No edit provided" },
      "workspace/applyEdit",
    );
    return;
  }

  try {
    await applyWorkspaceEdit(params.edit, client.cwd);
    await sendResponse(client, message.id, { applied: true }, "workspace/applyEdit");
  } catch (err) {
    await sendResponse(
      client,
      message.id,
      { applied: false, failureReason: String(err) },
      "workspace/applyEdit",
    );
  }
}

async function handleServerRequest(client: LspClient, message: LspJsonRpcRequest): Promise<void> {
  if (message.method === "workspace/configuration") {
    await handleConfigurationRequest(client, message);
    return;
  }
  if (message.method === "workspace/applyEdit") {
    await handleApplyEditRequest(client, message);
    return;
  }
  if (typeof message.id !== "number") return;
  await sendResponse(client, message.id, null, message.method, {
    code: -32601,
    message: `Method not found: ${message.method}`,
  });
}

async function sendResponse(
  client: LspClient,
  id: number,
  result: unknown,
  method: string,
  error?: { code: number; message: string; data?: unknown },
): Promise<void> {
  const response: LspJsonRpcResponse = {
    jsonrpc: "2.0",
    id,
    ...(error ? { error } : { result }),
  };

  try {
    await writeMessage(client.process.stdin as import("bun").FileSink, response);
  } catch (err) {
    console.error("LSP failed to respond.", { method, error: String(err) });
  }
}

export const WARMUP_TIMEOUT_MS = 5000;

export async function getOrCreateClient(
  config: ServerConfig,
  cwd: string,
  initTimeoutMs?: number,
): Promise<LspClient> {
  const key = `${config.command}:${cwd}`;

  const existingClient = clients.get(key);
  if (existingClient) {
    existingClient.lastActivity = Date.now();
    return existingClient;
  }

  const existingLock = clientLocks.get(key);
  if (existingLock) {
    return existingLock;
  }

  const clientPromise = (async () => {
    const args = config.args ?? [];
    const command = config.resolvedCommand ?? config.command;
    const proc = Bun.spawn([command, ...args], {
      cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    const client: LspClient = {
      name: key,
      cwd,
      process: proc,
      config,
      requestId: 0,
      diagnostics: new Map(),
      diagnosticsVersion: 0,
      openFiles: new Map(),
      pendingRequests: new Map(),
      messageBuffer: new Uint8Array(0),
      isReading: false,
      lastActivity: Date.now(),
    };
    clients.set(key, client);

    proc.exited.then(() => {
      clients.delete(key);
      clientLocks.delete(key);
    });

    startMessageReader(client);

    try {
      const initResult = (await sendRequest(
        client,
        "initialize",
        {
          processId: process.pid,
          rootUri: fileToUri(cwd),
          rootPath: cwd,
          capabilities: CLIENT_CAPABILITIES,
          initializationOptions: config.initOptions ?? {},
          workspaceFolders: [{ uri: fileToUri(cwd), name: cwd.split("/").pop() ?? "workspace" }],
        },
        undefined,
        initTimeoutMs,
      )) as { capabilities?: unknown };

      if (!initResult) {
        throw new Error("Failed to initialize LSP: no response");
      }

      client.serverCapabilities = initResult.capabilities as LspClient["serverCapabilities"];

      await sendNotification(client, "initialized", {});

      return client;
    } catch (err) {
      clients.delete(key);
      clientLocks.delete(key);
      proc.kill();
      throw err;
    } finally {
      clientLocks.delete(key);
    }
  })();

  clientLocks.set(key, clientPromise);
  return clientPromise;
}

export async function ensureFileOpen(client: LspClient, filePath: string): Promise<void> {
  const uri = fileToUri(filePath);
  const lockKey = `${client.name}:${uri}`;

  if (client.openFiles.has(uri)) {
    return;
  }

  const existingLock = fileOperationLocks.get(lockKey);
  if (existingLock) {
    await existingLock;
    return;
  }

  const openPromise = (async () => {
    if (client.openFiles.has(uri)) {
      return;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const languageId = detectLanguageId(filePath);

    await sendNotification(client, "textDocument/didOpen", {
      textDocument: {
        uri,
        languageId,
        version: 1,
        text: content,
      },
    });

    client.openFiles.set(uri, { version: 1, languageId });
    client.lastActivity = Date.now();
  })();

  fileOperationLocks.set(lockKey, openPromise);
  try {
    await openPromise;
  } finally {
    fileOperationLocks.delete(lockKey);
  }
}

export async function syncContent(
  client: LspClient,
  filePath: string,
  content: string,
  signal?: AbortSignal,
): Promise<void> {
  const uri = fileToUri(filePath);
  const lockKey = `${client.name}:${uri}`;
  signal?.throwIfAborted();

  const existingLock = fileOperationLocks.get(lockKey);
  if (existingLock) {
    await existingLock;
  }

  const syncPromise = (async () => {
    client.diagnostics.delete(uri);

    const info = client.openFiles.get(uri);

    if (!info) {
      const languageId = detectLanguageId(filePath);
      signal?.throwIfAborted();
      await sendNotification(client, "textDocument/didOpen", {
        textDocument: {
          uri,
          languageId,
          version: 1,
          text: content,
        },
      });
      client.openFiles.set(uri, { version: 1, languageId });
      client.lastActivity = Date.now();
      return;
    }

    const version = ++info.version;
    signal?.throwIfAborted();
    await sendNotification(client, "textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text: content }],
    });
    client.lastActivity = Date.now();
  })();

  fileOperationLocks.set(lockKey, syncPromise);
  try {
    await syncPromise;
  } finally {
    fileOperationLocks.delete(lockKey);
  }
}

export async function notifySaved(
  client: LspClient,
  filePath: string,
  signal?: AbortSignal,
): Promise<void> {
  const uri = fileToUri(filePath);
  const info = client.openFiles.get(uri);
  if (!info) return;

  signal?.throwIfAborted();
  await sendNotification(client, "textDocument/didSave", {
    textDocument: { uri },
  });
  client.lastActivity = Date.now();
}

export async function refreshFile(client: LspClient, filePath: string): Promise<void> {
  const uri = fileToUri(filePath);
  const lockKey = `${client.name}:${uri}`;

  const existingLock = fileOperationLocks.get(lockKey);
  if (existingLock) {
    await existingLock;
  }

  const refreshPromise = (async () => {
    const info = client.openFiles.get(uri);

    if (!info) {
      await ensureFileOpen(client, filePath);
      return;
    }

    const content = fs.readFileSync(filePath, "utf-8");
    const version = ++info.version;

    await sendNotification(client, "textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text: content }],
    });

    await sendNotification(client, "textDocument/didSave", {
      textDocument: { uri },
      text: content,
    });

    client.lastActivity = Date.now();
  })();

  fileOperationLocks.set(lockKey, refreshPromise);
  try {
    await refreshPromise;
  } finally {
    fileOperationLocks.delete(lockKey);
  }
}

export function shutdownClient(key: string): void {
  const client = clients.get(key);
  if (!client) return;

  for (const pending of Array.from(client.pendingRequests.values())) {
    pending.reject(new Error("LSP client shutdown"));
  }
  client.pendingRequests.clear();

  sendRequest(client, "shutdown", null).catch(() => {});

  client.process.kill();
  clients.delete(key);
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

export async function sendRequest(
  client: LspClient,
  method: string,
  params: unknown,
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  const id = ++client.requestId;
  if (signal?.aborted) {
    const reason = signal.reason instanceof Error ? signal.reason : new Error("Operation aborted");
    return Promise.reject(reason);
  }

  const request: LspJsonRpcRequest = {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };

  client.lastActivity = Date.now();

  return new Promise((resolve, reject) => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (signal) {
        signal.removeEventListener("abort", abortHandler);
      }
    };
    const abortHandler = () => {
      if (client.pendingRequests.has(id)) {
        client.pendingRequests.delete(id);
      }
      if (timeout) clearTimeout(timeout);
      cleanup();
      const reason =
        signal?.reason instanceof Error ? signal.reason : new Error("Operation aborted");
      reject(reason);
    };

    timeout = setTimeout(() => {
      if (client.pendingRequests.has(id)) {
        client.pendingRequests.delete(id);
        const err = new Error(`LSP request ${method} timed out`);
        cleanup();
        reject(err);
      }
    }, timeoutMs);
    if (signal) {
      signal.addEventListener("abort", abortHandler, { once: true });
      if (signal.aborted) {
        abortHandler();
        return;
      }
    }

    client.pendingRequests.set(id, {
      resolve: (result) => {
        if (timeout) clearTimeout(timeout);
        cleanup();
        resolve(result);
      },
      reject: (err) => {
        if (timeout) clearTimeout(timeout);
        cleanup();
        reject(err);
      },
      method,
    });

    writeMessage(client.process.stdin as import("bun").FileSink, request).catch((err) => {
      if (timeout) clearTimeout(timeout);
      client.pendingRequests.delete(id);
      cleanup();
      reject(err);
    });
  });
}

export async function sendNotification(
  client: LspClient,
  method: string,
  params: unknown,
): Promise<void> {
  const notification: LspJsonRpcNotification = {
    jsonrpc: "2.0",
    method,
    params,
  };

  client.lastActivity = Date.now();
  await writeMessage(client.process.stdin as import("bun").FileSink, notification);
}

export function shutdownAll(): void {
  for (const client of Array.from(clients.values())) {
    for (const pending of Array.from(client.pendingRequests.values())) {
      pending.reject(new Error("LSP client shutdown"));
    }
    client.pendingRequests.clear();

    sendRequest(client, "shutdown", null).catch(() => {});

    client.process.kill();
  }
  clients.clear();
}

export interface LspServerStatus {
  name: string;
  status: "connecting" | "ready" | "error";
  fileTypes: string[];
  error?: string;
}

export function getActiveClients(): LspServerStatus[] {
  return Array.from(clients.values()).map((client) => ({
    name: client.config.command,
    status: "ready" as const,
    fileTypes: client.config.fileTypes,
  }));
}

if (typeof process !== "undefined") {
  process.on("beforeExit", shutdownAll);
  process.on("SIGINT", () => {
    shutdownAll();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    shutdownAll();
    process.exit(0);
  });
}
