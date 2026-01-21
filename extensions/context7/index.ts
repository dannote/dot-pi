/**
 * Context7 Documentation Search
 *
 * Search up-to-date library documentation via Context7 API.
 * Provides two tools: resolve library ID and query documentation.
 *
 * Requires CONTEXT7_API_KEY environment variable.
 */

import { type ExtensionAPI, rawKeyHint } from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const DEFAULT_API_BASE = "https://context7.com/api";

function getApiKey(): string | undefined {
  return process.env.CONTEXT7_API_KEY;
}

function getApiBase(): string {
  return process.env.CONTEXT7_ENDPOINT_URL || DEFAULT_API_BASE;
}

interface Library {
  id: string;
  title: string;
  description?: string;
  totalSnippets?: number;
  trustScore?: number;
  benchmarkScore?: number;
  stars?: number;
}

interface SearchResult {
  libraries: Library[];
  error?: string;
}

interface DocsResult {
  docs: string;
  error?: string;
}

interface DocsDetails {
  libraryId: string;
  error?: boolean;
  empty?: boolean;
}

async function searchLibrary(
  apiKey: string,
  query: string,
  libraryName: string,
): Promise<SearchResult> {
  const params = new URLSearchParams({ query, libraryName });
  const response = await fetch(`${getApiBase()}/v2/libs/search?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    return { libraries: [], error: `API error: ${response.status}` };
  }

  const data = await response.json();
  // API returns { results: [...] }
  const results = (data as { results?: Library[] }).results || [];
  return { libraries: results };
}

async function getContext(
  apiKey: string,
  query: string,
  libraryId: string,
): Promise<DocsResult> {
  // Remove leading slash if present (API expects "org/repo" not "/org/repo")
  const cleanId = libraryId.startsWith("/") ? libraryId.slice(1) : libraryId;
  const params = new URLSearchParams({ query, libraryId: cleanId, type: "txt" });
  const response = await fetch(`${getApiBase()}/v2/context?${params}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    return { docs: "", error: `API error: ${response.status}` };
  }

  const text = await response.text();
  return { docs: text };
}

const RESOLVE_DESCRIPTION = `Find the Context7 library ID for a package/framework.

Call this FIRST before using context7-docs to get the correct library ID.

Examples:
- libraryName: "react", query: "hooks" → finds /reactjs/react.dev
- libraryName: "next.js", query: "routing" → finds /vercel/next.js
- libraryName: "vueuse", query: "useDark" → finds /vueuse/vueuse

Returns matching libraries ranked by relevance. Pick the best match based on:
- Official sources (higher reputation)
- Code snippet coverage
- Benchmark score`;

const DOCS_DESCRIPTION = `Get up-to-date documentation for a library from Context7.

You MUST call context7-resolve first to get the libraryId.

Examples:
- libraryId: "/vercel/next.js", query: "app router"
- libraryId: "/vueuse/vueuse", query: "useDark dark mode"
- libraryId: "/tanstack/query", query: "useQuery cache"

Returns relevant documentation snippets with code examples.`;

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "context7-resolve",
    label: "Context7 Resolve",
    description: RESOLVE_DESCRIPTION,
    parameters: Type.Object({
      libraryName: Type.String({ description: "Library/framework name (e.g., 'react', 'next.js', 'vue')" }),
      query: Type.String({ description: "What you're trying to do (helps rank results)" }),
    }),

    async execute(_toolCallId, params, _onUpdate, ctx) {
      const apiKey = getApiKey();
      if (!apiKey) {
        return {
          content: [{ type: "text" as const, text: "Error: CONTEXT7_API_KEY not set" }],
          details: { error: true },
        };
      }

      const result = await searchLibrary(apiKey, params.query, params.libraryName);

      if (result.error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          details: { error: true },
        };
      }

      if (result.libraries.length === 0) {
        return {
          content: [{ type: "text" as const, text: `No libraries found for "${params.libraryName}"` }],
          details: { libraries: [] },
        };
      }

      const lines = result.libraries.slice(0, 5).map((lib) => {
        const parts = [`${lib.id} — ${lib.title}`];
        if (lib.description) parts.push(`  ${lib.description}`);
        const meta: string[] = [];
        if (lib.trustScore) meta.push(`trust: ${lib.trustScore}`);
        if (lib.benchmarkScore) meta.push(`benchmark: ${lib.benchmarkScore}`);
        if (lib.totalSnippets) meta.push(`snippets: ${lib.totalSnippets}`);
        if (lib.stars && lib.stars > 0) meta.push(`★${lib.stars}`);
        if (meta.length) parts.push(`  ${meta.join(" | ")}`);
        return parts.join("\n");
      });

      return {
        content: [{ type: "text" as const, text: lines.join("\n\n") }],
        details: { libraries: result.libraries.slice(0, 5) },
      };
    },

    renderCall(params, theme) {
      const { libraryName, query } = params as { libraryName: string; query: string };
      return new Text(
        theme.fg("toolTitle", theme.bold("context7-resolve ")) +
          theme.fg("accent", libraryName) +
          theme.fg("dim", ` "${query}"`),
        0,
        0,
      );
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as { libraries?: Library[]; error?: boolean };
      if (details.error) {
        const text = result.content[0];
        return new Text(theme.fg("error", text?.type === "text" ? text.text : "Error"), 0, 0);
      }
      const libraries = details.libraries ?? [];
      if (libraries.length === 0) {
        return new Text(theme.fg("warning", "No libraries found"), 0, 0);
      }

      const container = new Container();
      container.addChild(
        new Text(theme.fg("success", "✓ ") + theme.fg("muted", `${libraries.length} libraries`), 0, 0),
      );

      const maxItems = expanded ? libraries.length : 1;
      for (let i = 0; i < maxItems; i++) {
        const lib = libraries[i];
        container.addChild(new Text("\n" + theme.fg("accent", lib.id) + theme.fg("dim", ` — ${lib.title}`), 0, 0));
        if (expanded && lib.description) {
          container.addChild(new Text(theme.fg("muted", `  ${lib.description}`), 0, 0));
        }
      }

      if (!expanded && libraries.length > 1) {
        container.addChild(
          new Text(theme.fg("dim", `\n... +${libraries.length - 1} more, `) + rawKeyHint("ctrl+o", "to expand"), 0, 0),
        );
      }

      return container;
    },
  });

  pi.registerTool({
    name: "context7-docs",
    label: "Context7 Docs",
    description: DOCS_DESCRIPTION,
    parameters: Type.Object({
      libraryId: Type.String({ description: "Context7 library ID (e.g., '/vercel/next.js')" }),
      query: Type.String({ description: "What you want to learn about" }),
    }),

    async execute(_toolCallId, params) {
      const apiKey = getApiKey();
      if (!apiKey) {
        return {
          content: [{ type: "text" as const, text: "Error: CONTEXT7_API_KEY not set" }],
          details: { libraryId: params.libraryId, error: true } as DocsDetails,
        };
      }

      const result = await getContext(apiKey, params.query, params.libraryId);

      if (result.error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          details: { libraryId: params.libraryId, error: true } as DocsDetails,
        };
      }

      if (!result.docs.trim()) {
        return {
          content: [{ type: "text" as const, text: `No documentation found for "${params.libraryId}"` }],
          details: { libraryId: params.libraryId, empty: true } as DocsDetails,
        };
      }

      return {
        content: [{ type: "text" as const, text: result.docs }],
        details: { libraryId: params.libraryId } as DocsDetails,
      };
    },

    renderCall(params, theme) {
      const { libraryId, query } = params as { libraryId: string; query: string };
      return new Text(
        theme.fg("toolTitle", theme.bold("context7-docs ")) +
          theme.fg("accent", libraryId) +
          theme.fg("dim", ` "${query}"`),
        0,
        0,
      );
    },

    renderResult(result, _options, theme) {
      const details = result.details as { libraryId?: string; error?: boolean; empty?: boolean };
      if (details.error) {
        const text = result.content[0];
        return new Text(theme.fg("error", text?.type === "text" ? text.text : "Error"), 0, 0);
      }
      if (details.empty) {
        return new Text(theme.fg("warning", "No docs found"), 0, 0);
      }
      const text = result.content[0];
      const lines = text?.type === "text" ? text.text.split("\n").length : 0;
      return new Text(
        theme.fg("success", "✓ ") +
          theme.fg("dim", `${lines} lines from `) +
          theme.fg("accent", details.libraryId || ""),
        0,
        0,
      );
    },
  });
}
