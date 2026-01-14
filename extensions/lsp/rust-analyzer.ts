/**
 * Rust-analyzer specific operations.
 */

import type { Diagnostic, WorkspaceEdit } from "vscode-languageserver-types";
import { sendNotification, sendRequest } from "./client";
import type { ExpandMacroResult, LspClient, RelatedTest, Runnable } from "./types";
import { fileToUri, sleep } from "./utils";

export async function flycheck(client: LspClient, file?: string): Promise<Diagnostic[]> {
  const textDocument = file ? { uri: fileToUri(file) } : null;

  const countDiagnostics = (diagnostics: Map<string, Diagnostic[]>): number => {
    let count = 0;
    for (const diags of diagnostics.values()) {
      count += diags.length;
    }
    return count;
  };

  const initialDiagnosticsVersion = client.diagnosticsVersion;
  const initialDiagnosticsCount = countDiagnostics(client.diagnostics);

  await sendNotification(client, "rust-analyzer/runFlycheck", { textDocument });

  const pollIntervalMs = 100;
  const maxPollIterations = 80;
  const stabilityThreshold = 3;
  const minStableDurationMs = 2000;
  const startTime = Date.now();
  let lastDiagnosticsVersion = initialDiagnosticsVersion;
  let lastDiagnosticsCount = initialDiagnosticsCount;
  let stableIterations = 0;

  for (let i = 0; i < maxPollIterations; i++) {
    await sleep(pollIntervalMs);

    const currentDiagnosticsVersion = client.diagnosticsVersion;
    const currentDiagnosticsCount = countDiagnostics(client.diagnostics);

    if (
      currentDiagnosticsVersion === lastDiagnosticsVersion &&
      currentDiagnosticsCount === lastDiagnosticsCount
    ) {
      stableIterations++;
      const elapsedMs = Date.now() - startTime;
      const countChangedFromStart = currentDiagnosticsCount !== initialDiagnosticsCount;
      if (
        currentDiagnosticsVersion !== initialDiagnosticsVersion &&
        stableIterations >= stabilityThreshold &&
        (countChangedFromStart || elapsedMs >= minStableDurationMs)
      ) {
        break;
      }
    } else {
      stableIterations = 0;
      lastDiagnosticsVersion = currentDiagnosticsVersion;
      lastDiagnosticsCount = currentDiagnosticsCount;
    }
  }

  const allDiags: Diagnostic[] = [];
  for (const diags of Array.from(client.diagnostics.values())) {
    allDiags.push(...diags);
  }

  return allDiags;
}

export async function expandMacro(
  client: LspClient,
  file: string,
  line: number,
  character: number,
): Promise<ExpandMacroResult | null> {
  const result = (await sendRequest(client, "rust-analyzer/expandMacro", {
    textDocument: { uri: fileToUri(file) },
    position: { line: line - 1, character: character - 1 },
  })) as ExpandMacroResult | null;

  return result;
}

export async function ssr(
  client: LspClient,
  pattern: string,
  replacement: string,
  parseOnly = true,
): Promise<WorkspaceEdit> {
  const result = (await sendRequest(client, "experimental/ssr", {
    query: `${pattern} ==>> ${replacement}`,
    parseOnly,
    textDocument: { uri: "" },
    position: { line: 0, character: 0 },
    selections: [],
  })) as WorkspaceEdit;

  return result;
}

export async function runnables(
  client: LspClient,
  file: string,
  line?: number,
): Promise<Runnable[]> {
  const params: { textDocument: { uri: string }; position?: { line: number; character: number } } =
    {
      textDocument: { uri: fileToUri(file) },
    };

  if (line !== undefined) {
    params.position = { line: line - 1, character: 0 };
  }

  const result = (await sendRequest(client, "experimental/runnables", params)) as Runnable[];
  return result ?? [];
}

export async function relatedTests(
  client: LspClient,
  file: string,
  line: number,
  character: number,
): Promise<string[]> {
  const tests = (await sendRequest(client, "rust-analyzer/relatedTests", {
    textDocument: { uri: fileToUri(file) },
    position: { line: line - 1, character: character - 1 },
  })) as RelatedTest[];

  if (!tests?.length) return [];

  const labels: string[] = [];
  for (const t of tests) {
    if (t.runnable?.label) {
      labels.push(t.runnable.label);
    }
  }

  return labels;
}

export async function reloadWorkspace(client: LspClient): Promise<void> {
  await sendRequest(client, "rust-analyzer/reloadWorkspace", null);
}
