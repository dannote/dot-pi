/**
 * Biome CLI-based linter client.
 */

import path from "node:path";
import { DiagnosticSeverity, type Diagnostic } from "vscode-languageserver-types";
import type { LinterClient, ServerConfig } from "../types";

interface BiomeJsonOutput {
  diagnostics: BiomeDiagnostic[];
}

interface BiomeDiagnostic {
  category: string;
  severity: "error" | "warning" | "info" | "hint";
  description: string;
  location?: {
    path?: { file: string };
    span?: [number, number];
    sourceCode?: string;
  };
}

function offsetToPosition(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  let byteIndex = 0;

  for (const ch of source) {
    const byteLen = Buffer.byteLength(ch);
    if (byteIndex + byteLen > offset) {
      break;
    }
    if (ch === "\n") {
      line++;
      column = 1;
    } else {
      column++;
    }
    byteIndex += byteLen;
  }

  return { line, column };
}

function parseSeverity(severity: string): DiagnosticSeverity {
  switch (severity) {
    case "error":
      return DiagnosticSeverity.Error;
    case "warning":
      return DiagnosticSeverity.Warning;
    case "info":
      return DiagnosticSeverity.Information;
    case "hint":
      return DiagnosticSeverity.Hint;
    default:
      return DiagnosticSeverity.Warning;
  }
}

async function runBiome(
  args: string[],
  cwd: string,
  resolvedCommand?: string,
): Promise<{ stdout: string; stderr: string; success: boolean }> {
  const command = resolvedCommand ?? "biome";

  try {
    const proc = Bun.spawn([command, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    return { stdout, stderr, success: exitCode === 0 };
  } catch (err) {
    return { stdout: "", stderr: String(err), success: false };
  }
}

export class BiomeClient implements LinterClient {
  private config: ServerConfig;
  private cwd: string;

  constructor(config: ServerConfig, cwd: string) {
    this.config = config;
    this.cwd = cwd;
  }

  async format(filePath: string, content: string): Promise<string> {
    await Bun.write(filePath, content);

    const result = await runBiome(
      ["format", "--write", filePath],
      this.cwd,
      this.config.resolvedCommand,
    );

    if (result.success) {
      return await Bun.file(filePath).text();
    }

    return content;
  }

  async lint(filePath: string): Promise<Diagnostic[]> {
    const result = await runBiome(
      ["lint", "--reporter=json", filePath],
      this.cwd,
      this.config.resolvedCommand,
    );

    return this.parseJsonOutput(result.stdout, filePath);
  }

  private parseJsonOutput(jsonOutput: string, targetFile: string): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    try {
      const parsed: BiomeJsonOutput = JSON.parse(jsonOutput);

      for (const diag of parsed.diagnostics) {
        const location = diag.location;
        if (!location?.path?.file) continue;

        const diagFile = path.isAbsolute(location.path.file)
          ? location.path.file
          : path.join(this.cwd, location.path.file);

        if (path.resolve(diagFile) !== path.resolve(targetFile)) {
          continue;
        }

        let startLine = 1;
        let startColumn = 1;
        let endLine = 1;
        let endColumn = 1;

        if (location.span && location.sourceCode) {
          const startPos = offsetToPosition(location.sourceCode, location.span[0]);
          const endPos = offsetToPosition(location.sourceCode, location.span[1]);
          startLine = startPos.line;
          startColumn = startPos.column;
          endLine = endPos.line;
          endColumn = endPos.column;
        }

        diagnostics.push({
          range: {
            start: { line: startLine - 1, character: startColumn - 1 },
            end: { line: endLine - 1, character: endColumn - 1 },
          },
          severity: parseSeverity(diag.severity),
          message: diag.description,
          source: "biome",
          code: diag.category,
        });
      }
    } catch {
      // JSON parse failed
    }

    return diagnostics;
  }

  dispose(): void {
    // Nothing to dispose for CLI client
  }
}

export function createBiomeClient(config: ServerConfig, cwd: string): LinterClient {
  return new BiomeClient(config, cwd);
}
