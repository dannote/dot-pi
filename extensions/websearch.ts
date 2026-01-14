/**
 * Web Search Tool Extension
 *
 * Searches the web using Exa AI MCP endpoint.
 * Provides real-time web search with configurable crawling modes.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const API_CONFIG = {
  BASE_URL: "https://mcp.exa.ai",
  ENDPOINTS: {
    SEARCH: "/mcp",
  },
  DEFAULT_NUM_RESULTS: 8,
  DEFAULT_TIMEOUT: 25000,
} as const;

const PREVIEW_RESULTS = 2;
const PREVIEW_TEXT_LENGTH = 200;

interface McpSearchRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: {
    name: string;
    arguments: {
      query: string;
      numResults?: number;
      livecrawl?: "fallback" | "preferred";
      type?: "auto" | "fast" | "deep";
      contextMaxCharacters?: number;
    };
  };
}

interface McpSearchResponse {
  jsonrpc: string;
  result: {
    content: Array<{
      type: string;
      text: string;
    }>;
  };
}

interface SearchResult {
  title: string;
  url: string;
  author?: string;
  date?: string;
  text: string;
}

interface WebSearchDetails {
  query: string;
  results: SearchResult[];
  error?: boolean;
}

interface WebSearchParams {
  query: string;
  numResults?: number;
  livecrawl?: "fallback" | "preferred";
  type?: "auto" | "fast" | "deep";
  contextMaxCharacters?: number;
}

const DESCRIPTION = `Search the web using Exa AI - performs real-time web searches and returns content from relevant websites.

Usage notes:
- Provides up-to-date information beyond knowledge cutoff
- Supports live crawling modes: 'fallback' (use cached, crawl if unavailable) or 'preferred' (prioritize live)
- Search types: 'auto' (balanced), 'fast' (quick), 'deep' (comprehensive)
- Configurable result count and context length for LLM optimization`;

const WebSearchParamsSchema = Type.Object({
  query: Type.String({ description: "Web search query" }),
  numResults: Type.Optional(
    Type.Number({ description: "Number of search results to return (default: 8)" }),
  ),
  livecrawl: Type.Optional(
    Type.Union([Type.Literal("fallback"), Type.Literal("preferred")], {
      description:
        "Live crawl mode - 'fallback': use cached first, 'preferred': prioritize live (default: 'fallback')",
    }),
  ),
  type: Type.Optional(
    Type.Union([Type.Literal("auto"), Type.Literal("fast"), Type.Literal("deep")], {
      description: "Search type - 'auto': balanced (default), 'fast': quick, 'deep': comprehensive",
    }),
  ),
  contextMaxCharacters: Type.Optional(
    Type.Number({ description: "Maximum characters for context (default: 10000)" }),
  ),
});

/**
 * Parse the raw API response text into structured results
 */
function parseResults(rawText: string): SearchResult[] {
  const results: SearchResult[] = [];
  // Split by "Title:" to get individual results
  const chunks = rawText.split(/(?=^Title:)/m).filter(Boolean);

  for (const chunk of chunks) {
    const titleMatch = chunk.match(/^Title:\s*(.+)$/m);
    const urlMatch = chunk.match(/^URL:\s*(.+)$/m);
    const authorMatch = chunk.match(/^Author:\s*(.+)$/m);
    const dateMatch = chunk.match(/^Published Date:\s*(.+)$/m);
    const textMatch = chunk.match(/^Text:\s*([\s\S]+)$/m);

    const title = titleMatch?.[1]?.trim();
    const url = urlMatch?.[1]?.trim();
    if (!title || !url) continue;

    results.push({
      title,
      url,
      author: authorMatch?.[1]?.trim(),
      date: dateMatch?.[1]?.trim(),
      text: textMatch?.[1]?.trim() ?? "",
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
      let header = `Title: ${r.title}\nURL: ${r.url}`;
      if (r.author) header += `\nAuthor: ${r.author}`;
      if (r.date) header += `\nDate: ${r.date}`;
      return `${header}\n\n${r.text}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Format a date string nicely
 */
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "websearch",
    label: "Web Search",
    description: DESCRIPTION,
    parameters: WebSearchParamsSchema as any,

    async execute(_toolCallId, params, onUpdate, _ctx, signal) {
      const {
        query,
        numResults = API_CONFIG.DEFAULT_NUM_RESULTS,
        livecrawl = "fallback",
        type = "auto",
        contextMaxCharacters,
      } = params as WebSearchParams;

      onUpdate?.({
        content: [{ type: "text", text: `Searching: ${query}...` }],
        details: { query, results: [] } as WebSearchDetails,
      });

      const searchRequest: McpSearchRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "web_search_exa",
          arguments: {
            query,
            type,
            numResults,
            livecrawl,
            contextMaxCharacters,
          },
        },
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.DEFAULT_TIMEOUT);

      const combinedSignal = signal
        ? AbortSignal.any([controller.signal, signal])
        : controller.signal;

      try {
        const response = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SEARCH}`, {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
          },
          body: JSON.stringify(searchRequest),
          signal: combinedSignal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          return {
            content: [{ type: "text", text: `Search error (${response.status}): ${errorText}` }],
            details: { query, results: [], error: true } as WebSearchDetails,
          };
        }

        const responseText = await response.text();

        // Parse SSE response
        const lines = responseText.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data: McpSearchResponse = JSON.parse(line.substring(6));
            const firstContent = data.result?.content?.[0];
            if (firstContent) {
              const results = parseResults(firstContent.text);
              return {
                content: [{ type: "text", text: formatResultsAsText(results) }],
                details: { query, results } as WebSearchDetails,
              };
            }
          }
        }

        return {
          content: [{ type: "text", text: "No search results found. Try a different query." }],
          details: { query, results: [] } as WebSearchDetails,
        };
      } catch (err) {
        clearTimeout(timeoutId);

        if (err instanceof Error && err.name === "AbortError") {
          return {
            content: [{ type: "text", text: "Search request timed out" }],
            details: { query, results: [], error: true } as WebSearchDetails,
          };
        }

        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: { query, results: [], error: true } as WebSearchDetails,
        };
      }
    },

    renderCall(params, theme) {
      const args = params as WebSearchParams;
      let text = theme.fg("toolTitle", theme.bold("websearch "));
      text += theme.fg("accent", args.query || "");
      if (args.type && args.type !== "auto") {
        text += theme.fg("dim", ` [${args.type}]`);
      }
      if (args.numResults) {
        text += theme.fg("dim", ` (${args.numResults} results)`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as WebSearchDetails | undefined;

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
        new Text(theme.fg("success", "✓ ") + theme.fg("muted", `${results.length} results`), 0, 0),
      );

      // Determine how many results to show
      const maxResults = expanded ? results.length : Math.min(PREVIEW_RESULTS, results.length);

      for (let i = 0; i < maxResults; i++) {
        const r = results[i];
        if (!r) continue;

        // Result header: title + metadata
        let header = "\n" + theme.fg("accent", r.title);
        const meta: string[] = [];
        if (r.author) meta.push(r.author);
        if (r.date) meta.push(formatDate(r.date));
        if (meta.length > 0) {
          header += theme.fg("dim", ` · ${meta.join(" · ")}`);
        }
        container.addChild(new Text(header, 0, 0));

        // URL
        container.addChild(new Text(theme.fg("muted", r.url), 0, 0));

        // Text preview/full
        if (r.text) {
          const displayText = expanded
            ? r.text
            : r.text.length > PREVIEW_TEXT_LENGTH
              ? r.text.slice(0, PREVIEW_TEXT_LENGTH) + "..."
              : r.text;
          container.addChild(new Text(theme.fg("dim", displayText), 0, 0));
        }
      }

      // Footer showing hidden count
      const hiddenResults = results.length - maxResults;

      if (!expanded && hiddenResults > 0) {
        container.addChild(new Text(theme.fg("dim", `\n... ${hiddenResults} more results`), 0, 0));
      }

      return container;
    },
  });
}
