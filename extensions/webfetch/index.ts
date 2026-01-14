/**
 * Webfetch Tool Extension
 *
 * Fetches content from URLs and converts to markdown/text/html.
 * Uses Turndown for HTML to Markdown conversion.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import TurndownService from "turndown";

interface FetchDetails {
  url?: string;
  contentType?: string;
  format?: string;
  size?: number;
  error?: boolean;
  status?: number;
}

interface FetchParams {
  url: string;
  format?: "markdown" | "text" | "html";
  timeout?: number;
}

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT = 30 * 1000; // 30 seconds
const MAX_TIMEOUT = 120 * 1000; // 2 minutes

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DESCRIPTION = `Fetches content from a specified URL and converts to requested format.

Usage notes:
- URL must be fully-formed and valid (http:// or https://)
- Format options: "markdown" (default), "text", or "html"
- HTML content is automatically converted to markdown by default
- This tool is read-only and does not modify any files
- Results may be truncated if content is very large (5MB limit)`;

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  });
  turndownService.remove(["script", "style", "meta", "link", "noscript"]);
  return turndownService.turndown(html);
}

function extractTextFromHTML(html: string): string {
  // Simple regex-based extraction (no HTMLRewriter in Node)
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FetchParamsSchema = Type.Object({
  url: Type.String({ description: "The URL to fetch content from" }),
  format: Type.Optional(
    Type.Union([Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html")], {
      description: "Output format (default: markdown)",
    }),
  ),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (max 120)" })),
});

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "fetch",
    label: "Fetch URL",
    description: DESCRIPTION,
    parameters: FetchParamsSchema as any,

    async execute(_toolCallId, params, onUpdate, _ctx, signal) {
      const { url, format = "markdown", timeout: timeoutSec } = params as FetchParams;

      // Validate URL
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return {
          content: [{ type: "text", text: "Error: URL must start with http:// or https://" }],
          details: { error: true },
        };
      }

      const timeout = Math.min((timeoutSec ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT);

      onUpdate?.({
        content: [{ type: "text", text: `Fetching ${url}...` }],
        details: {},
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      // Combine with provided signal
      const combinedSignal = signal
        ? AbortSignal.any([controller.signal, signal])
        : controller.signal;

      // Build Accept header based on requested format
      let acceptHeader = "*/*";
      switch (format) {
        case "markdown":
          acceptHeader =
            "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1";
          break;
        case "text":
          acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1";
          break;
        case "html":
          acceptHeader =
            "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.1";
          break;
      }

      try {
        const response = await fetch(url, {
          signal: combinedSignal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: acceptHeader,
            "Accept-Language": "en-US,en;q=0.9",
          },
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          return {
            content: [
              { type: "text", text: `Error: Request failed with status ${response.status}` },
            ],
            details: { error: true, status: response.status },
          };
        }

        // Check content length
        const contentLength = response.headers.get("content-length");
        if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
          return {
            content: [{ type: "text", text: "Error: Response too large (exceeds 5MB limit)" }],
            details: { error: true },
          };
        }

        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
          return {
            content: [{ type: "text", text: "Error: Response too large (exceeds 5MB limit)" }],
            details: { error: true },
          };
        }

        const content = new TextDecoder().decode(arrayBuffer);
        const contentType = response.headers.get("content-type") || "";

        let output: string;

        switch (format) {
          case "markdown":
            output = contentType.includes("text/html") ? convertHTMLToMarkdown(content) : content;
            break;

          case "text":
            output = contentType.includes("text/html") ? extractTextFromHTML(content) : content;
            break;

          case "html":
          default:
            output = content;
            break;
        }

        return {
          content: [{ type: "text", text: output }],
          details: {
            url,
            contentType,
            format,
            size: arrayBuffer.byteLength,
          } as FetchDetails,
        };
      } catch (err) {
        clearTimeout(timeoutId);
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          details: { url, error: true } as FetchDetails,
        };
      }
    },

    renderCall(params, theme) {
      const args = params as FetchParams;
      let text = theme.fg("toolTitle", theme.bold("fetch "));
      text += theme.fg("accent", args.url || "");
      if (args.format && args.format !== "markdown") {
        text += theme.fg("dim", ` [${args.format}]`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, { expanded }, theme) {
      const details = result.details as FetchDetails | undefined;

      if (details?.error) {
        const text = result.content[0];
        return new Text(theme.fg("error", text?.type === "text" ? text.text : "Error"), 0, 0);
      }

      const content = result.content[0];
      const fullText = content?.type === "text" ? content.text : "";

      const lines = fullText.split("\n").filter(Boolean);
      const sizeInfo = details?.size ? ` (${formatSize(details.size)})` : "";

      if (!expanded) {
        // Show first 4 non-empty lines as preview
        const preview = lines.slice(0, 4).join("\n");
        const hiddenCount = lines.length - 4;
        const moreInfo =
          hiddenCount > 0
            ? theme.fg("dim", `\n... ${hiddenCount} more lines`)
            : "";
        return new Text(
          theme.fg("success", "✓") + theme.fg("muted", sizeInfo + "\n" + preview) + moreInfo,
          0,
          0,
        );
      }

      return new Text(fullText, 0, 0);
    },
  });
}
