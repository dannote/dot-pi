/**
 * Code Search Tool Extension
 *
 * Searches public code on GitHub using grep.app MCP API.
 * Returns formatted code snippets with repository info.
 */

import {
  type ExtensionAPI,
  getLanguageFromPath,
  highlightCode,
} from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const API_URL = "https://mcp.grep.app/";
const DEFAULT_TIMEOUT = 30000;
const PREVIEW_SNIPPETS = 2;

interface McpResponse {
  result?: {
    content: Array<{ type: string; text: string }>;
  };
  error?: {
    code: number;
    message: string;
  };
}

interface CodeSnippet {
  lineNumber: number;
  code: string;
}

interface SearchResult {
  repo: string;
  path: string;
  url: string;
  license: string;
  snippets: CodeSnippet[];
}

interface CodeSearchDetails {
  query: string;
  results: SearchResult[];
  error?: boolean;
}

interface CodeSearchParams {
  query: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWords?: boolean;
  repo?: string;
  path?: string;
  lang?: string[];
}

const DESCRIPTION = `Find real-world code examples from over a million public GitHub repositories.

**IMPORTANT: This tool searches for literal code patterns (like grep), not keywords.**
- ✅ Good: 'useState(', 'import React from', 'async function'
- ❌ Bad: 'react tutorial', 'best practices', 'how to use'

**When to use this tool:**
- When implementing unfamiliar APIs or libraries and need real usage patterns
- When unsure about correct syntax, parameters, or configuration
- When looking for production-ready examples and best practices
- When needing to understand how different libraries work together

**Perfect for questions like:**
- "How do developers handle auth in Next.js?" → query:'getServerSession' lang:['TypeScript', 'TSX']
- "What are common React error boundary patterns?" → query:'ErrorBoundary' lang:['TSX']
- "Show me useEffect cleanup examples" → query:'(?s)useEffect\\(\\(\\) => {.*removeEventListener' regex:true
- "How to handle CORS in Flask?" → query:'CORS(' caseSensitive:true lang:['Python']

Use regex:true for flexible patterns. Prefix with '(?s)' to match across multiple lines.
Filter by lang (array), repo (string), or path (string) to narrow results.`;

const CodeSearchParamsSchema = Type.Object({
  query: Type.String({
    description: "Code pattern to search for (e.g., 'useState(', 'export function')",
  }),
  regex: Type.Optional(
    Type.Boolean({
      description: "Treat query as regular expression. Prefix with (?s) to match across lines",
    }),
  ),
  caseSensitive: Type.Optional(Type.Boolean({ description: "Case-sensitive search" })),
  wholeWords: Type.Optional(Type.Boolean({ description: "Match whole words only" })),
  repo: Type.Optional(
    Type.String({ description: "Filter by repository (e.g., 'facebook/react', 'vercel/')" }),
  ),
  path: Type.Optional(
    Type.String({ description: "Filter by file path (e.g., 'src/components/', '/route.ts')" }),
  ),
  lang: Type.Optional(
    Type.Array(Type.String(), { description: "Filter by languages (e.g., ['TypeScript', 'TSX'])" }),
  ),
});

/**
 * Parse the raw API response text into structured results
 */
function parseResults(rawText: string): SearchResult[] {
  const results: SearchResult[] = [];
  // Split by "Repository:" to get individual results
  const chunks = rawText.split(/(?=^Repository:)/m).filter(Boolean);

  for (const chunk of chunks) {
    const repoMatch = chunk.match(/^Repository:\s*(.+)$/m);
    const pathMatch = chunk.match(/^Path:\s*(.+)$/m);
    const urlMatch = chunk.match(/^URL:\s*(.+)$/m);
    const licenseMatch = chunk.match(/^License:\s*(.+)$/m);

    if (!repoMatch || !pathMatch) continue;

    const snippets: CodeSnippet[] = [];
    // Match snippet headers and their code
    const snippetRegex = /--- Snippet \d+ \(Line (\d+)\) ---\n([\s\S]*?)(?=\n--- Snippet|\n\n$|$)/g;
    let match;
    while ((match = snippetRegex.exec(chunk)) !== null) {
      const lineNum = match[1];
      const code = match[2];
      if (lineNum && code) {
        snippets.push({
          lineNumber: parseInt(lineNum, 10),
          code: code.trim(),
        });
      }
    }

    const repo = repoMatch[1];
    const path = pathMatch[1];
    if (!repo || !path) continue;

    results.push({
      repo: repo.trim(),
      path: path.trim(),
      url: urlMatch?.[1]?.trim() ?? "",
      license: licenseMatch?.[1]?.trim() ?? "Unknown",
      snippets,
    });
  }

  return results;
}

/**
 * Format results as plain text for LLM consumption
 */
function formatResultsAsText(results: SearchResult[]): string {
  return results
    .map((r) => {
      const snippetsText = r.snippets.map((s) => `Line ${s.lineNumber}:\n${s.code}`).join("\n\n");
      return `Repository: ${r.repo}\nPath: ${r.path}\nURL: ${r.url}\nLicense: ${r.license}\n\n${snippetsText}`;
    })
    .join("\n\n---\n\n");
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "codesearch",
    label: "Code Search",
    description: DESCRIPTION,
    parameters: CodeSearchParamsSchema as any,

    async execute(_toolCallId, params, onUpdate, _ctx, signal) {
      const { query, regex, caseSensitive, wholeWords, repo, path, lang } =
        params as CodeSearchParams;

      onUpdate?.({
        content: [{ type: "text", text: `Searching: ${query}...` }],
        details: { query, results: [] } as CodeSearchDetails,
      });

      const mcpRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "searchGitHub",
          arguments: {
            query,
            useRegexp: regex ?? false,
            matchCase: caseSensitive ?? false,
            matchWholeWords: wholeWords ?? false,
            ...(repo && { repo }),
            ...(path && { path }),
            ...(lang && { language: lang }),
          },
        },
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

      const combinedSignal = signal
        ? AbortSignal.any([controller.signal, signal])
        : controller.signal;

      try {
        const response = await fetch(API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify(mcpRequest),
          signal: combinedSignal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          return {
            content: [{ type: "text", text: `Error: API returned ${response.status}` }],
            details: { query, results: [], error: true } as CodeSearchDetails,
          };
        }

        const text = await response.text();

        // Parse SSE response - find the data line
        const lines = text.split("\n");
        let jsonData = "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            jsonData = line.slice(6);
            break;
          }
        }

        if (!jsonData) {
          return {
            content: [{ type: "text", text: "Error: No data in response" }],
            details: { query, results: [], error: true } as CodeSearchDetails,
          };
        }

        const data: McpResponse = JSON.parse(jsonData);

        if (data.error) {
          return {
            content: [{ type: "text", text: `Error: ${data.error.message}` }],
            details: { query, results: [], error: true } as CodeSearchDetails,
          };
        }

        if (!data.result?.content?.length) {
          return {
            content: [{ type: "text", text: "No results found." }],
            details: { query, results: [] } as CodeSearchDetails,
          };
        }

        // Combine all text content and parse
        const rawOutput = data.result.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n\n");

        const results = parseResults(rawOutput);

        return {
          content: [{ type: "text", text: formatResultsAsText(results) }],
          details: { query, results } as CodeSearchDetails,
        };
      } catch (err) {
        clearTimeout(timeoutId);

        if (err instanceof Error && err.name === "AbortError") {
          return {
            content: [{ type: "text", text: "Search request timed out" }],
            details: { query, results: [], error: true } as CodeSearchDetails,
          };
        }

        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: { query, results: [], error: true } as CodeSearchDetails,
        };
      }
    },

    renderCall(params, theme) {
      const args = params as CodeSearchParams;
      let text = theme.fg("toolTitle", theme.bold("codesearch "));
      text += theme.fg("accent", args.query || "");
      const filters: string[] = [];
      if (args.repo) filters.push(`repo:${args.repo}`);
      if (args.path) filters.push(`path:${args.path}`);
      if (args.lang?.length) filters.push(`lang:${args.lang.join(",")}`);
      if (args.regex) filters.push("regex");
      if (args.caseSensitive) filters.push("case");
      if (filters.length > 0) {
        text += theme.fg("dim", ` [${filters.join(", ")}]`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as CodeSearchDetails | undefined;

      if (details?.error) {
        const text = result.content[0];
        return new Text(theme.fg("error", text?.type === "text" ? text.text : "Error"), 0, 0);
      }

      const results = details?.results ?? [];

      if (results.length === 0) {
        if (isPartial) return new Text(theme.fg("muted", "Searching..."), 0, 0);
        return new Text(theme.fg("muted", "No results found."), 0, 0);
      }

      const container = new Container();

      // Header
      container.addChild(
        new Text(theme.fg("success", "✓ ") + theme.fg("muted", `${results.length} repos`), 0, 0),
      );

      // Determine how many results/snippets to show
      const maxResults = expanded ? results.length : Math.min(PREVIEW_SNIPPETS, results.length);

      for (let i = 0; i < maxResults; i++) {
        const r = results[i];
        if (!r) continue;
        const lang = getLanguageFromPath(r.path);

        // Repo header
        container.addChild(
          new Text(
            "\n" +
              theme.fg("accent", r.repo) +
              theme.fg("dim", " · ") +
              theme.fg("muted", r.path) +
              (r.license !== "Unknown" ? theme.fg("dim", ` [${r.license}]`) : ""),
            0,
            0,
          ),
        );

        // Show snippets (limit in preview mode)
        const maxSnippets = expanded ? r.snippets.length : 1;
        for (let j = 0; j < Math.min(maxSnippets, r.snippets.length); j++) {
          const snippet = r.snippets[j];
          if (!snippet) continue;

          // Line number
          container.addChild(new Text(theme.fg("dim", `Line ${snippet.lineNumber}:`), 0, 0));

          // Highlighted code
          const codeLines = highlightCode(snippet.code, lang);
          container.addChild(new Text(codeLines.join("\n"), 0, 0));
        }

        // Show remaining snippets count if collapsed
        if (!expanded && r.snippets.length > 1) {
          container.addChild(
            new Text(theme.fg("dim", `... ${r.snippets.length - 1} more snippets`), 0, 0),
          );
        }
      }

      // Footer showing hidden content count
      const hiddenResults = results.length - maxResults;
      const totalSnippets = results.reduce((sum, r) => sum + r.snippets.length, 0);

      if (!expanded && (hiddenResults > 0 || totalSnippets > maxResults)) {
        container.addChild(
          new Text(
            theme.fg(
              "dim",
              `\n... ${hiddenResults} more repos, ${totalSnippets - maxResults} more snippets`,
            ),
            0,
            0,
          ),
        );
      }

      return container;
    },
  });
}
