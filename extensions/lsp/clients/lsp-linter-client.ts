/**
 * LSP-based linter client.
 */

import type { Diagnostic, TextEdit } from "vscode-languageserver-types";
import { getOrCreateClient, notifySaved, sendRequest, syncContent } from "../client";
import { applyTextEditsToString } from "../edits";
import type { LinterClient, LspClient, ServerConfig } from "../types";
import { fileToUri } from "../utils";

const DEFAULT_FORMAT_OPTIONS = {
  tabSize: 2,
  insertSpaces: true,
  trimTrailingWhitespace: true,
  insertFinalNewline: true,
  trimFinalNewlines: true,
};

export class LspLinterClient implements LinterClient {
  private config: ServerConfig;
  private cwd: string;
  private client: LspClient | null = null;

  constructor(config: ServerConfig, cwd: string) {
    this.config = config;
    this.cwd = cwd;
  }

  private async getClient(): Promise<LspClient> {
    if (!this.client) {
      this.client = await getOrCreateClient(this.config, this.cwd);
    }
    return this.client;
  }

  async format(filePath: string, content: string): Promise<string> {
    const client = await this.getClient();
    const uri = fileToUri(filePath);

    await syncContent(client, filePath, content);

    const caps = client.serverCapabilities;
    if (!caps?.documentFormattingProvider) {
      return content;
    }

    const edits = (await sendRequest(client, "textDocument/formatting", {
      textDocument: { uri },
      options: DEFAULT_FORMAT_OPTIONS,
    })) as TextEdit[] | null;

    if (!edits || edits.length === 0) {
      return content;
    }

    return applyTextEditsToString(content, edits);
  }

  async lint(filePath: string): Promise<Diagnostic[]> {
    const client = await this.getClient();
    const uri = fileToUri(filePath);

    await notifySaved(client, filePath);

    const timeoutMs = 3000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const diagnostics = client.diagnostics.get(uri);
      if (diagnostics !== undefined) {
        return diagnostics;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return client.diagnostics.get(uri) ?? [];
  }

  dispose(): void {
    // Client lifecycle is managed globally
  }
}

export function createLspLinterClient(config: ServerConfig, cwd: string): LinterClient {
  return new LspLinterClient(config, cwd);
}
