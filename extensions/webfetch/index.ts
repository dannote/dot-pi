/**
 * Webfetch Tool Extension
 *
 * Fetches content from URLs and converts to markdown/text/html.
 * Supports CSS selector extraction, PDF parsing, JSON formatting,
 * custom headers, and redirect tracking.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { extractText as extractPdfText } from "unpdf";

interface FetchDetails {
  url?: string;
  finalUrl?: string;
  contentType?: string;
  format?: string;
  size?: number;
  totalChars?: number;
  truncated?: boolean;
  error?: boolean;
  status?: number;
  redirected?: boolean;
  selector?: string;
}

interface FetchParams {
  url: string;
  format?: "markdown" | "text" | "html" | "json";
  selector?: string;
  timeout?: number;
  headers?: Record<string, string>;
}

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 20000;
const DEFAULT_TIMEOUT = 30 * 1000;
const MAX_TIMEOUT = 120 * 1000;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DESCRIPTION = `Fetches content from a specified URL and converts to requested format.

Usage notes:
- URL must be fully-formed and valid (http:// or https://)
- Format options: "markdown" (default), "text", "html", or "json"
- HTML content is automatically converted to markdown by default
- PDFs are automatically detected and extracted as text
- JSON responses are pretty-printed with "json" format
- Use 'selector' to extract specific parts of a page (CSS selector, e.g. "article", ".content", "#main")
- Use 'headers' for custom HTTP headers (e.g. Authorization, Cookie)
- Shows final URL after redirects
- Results may be truncated if content is very large (5MB limit)
- Output is capped at 20,000 characters to keep responses manageable`;

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
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function applySelector(html: string, selector: string): string {
  const $ = cheerio.load(html);
  const selected = $(selector);
  if (selected.length === 0) return "";
  if (selected.length === 1) return selected.html() ?? "";
  return selected
    .map((_, el) => $(el).html())
    .get()
    .join("\n\n");
}

function truncateOutput(text: string) {
  if (text.length <= MAX_OUTPUT_CHARS) {
    return { output: text, truncated: false, totalChars: text.length };
  }

  return {
    output: `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n[Truncated: ${text.length - MAX_OUTPUT_CHARS} chars omitted]`,
    truncated: true,
    totalChars: text.length,
  };
}

function isPdf(contentType: string, url: string): boolean {
  return contentType.includes("application/pdf") || url.toLowerCase().endsWith(".pdf");
}

function isJson(contentType: string): boolean {
  return contentType.includes("application/json") || contentType.includes("+json");
}

const FetchParamsSchema = Type.Object({
  url: Type.String({ description: "The URL to fetch content from" }),
  format: Type.Optional(
    Type.Union(
      [Type.Literal("markdown"), Type.Literal("text"), Type.Literal("html"), Type.Literal("json")],
      { description: 'Output format (default: "markdown"). Use "json" for API endpoints.' },
    ),
  ),
  selector: Type.Optional(
    Type.String({
      description:
        'CSS selector to extract specific page content (e.g. "article", ".main-content", "#post-body"). Applied before format conversion.',
    }),
  ),
  timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (max 120)" })),
  headers: Type.Optional(
    Type.Record(Type.String(), Type.String(), {
      description:
        'Custom HTTP headers (e.g. {"Authorization": "Bearer xxx", "Cookie": "session=abc"})',
    }),
  ),
});

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "fetch",
    label: "Fetch URL",
    description: DESCRIPTION,
    parameters: FetchParamsSchema as any,

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const {
        url,
        format = "markdown",
        selector,
        timeout: timeoutSec,
        headers: customHeaders,
      } = params as FetchParams;

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

      const combinedSignal = signal
        ? AbortSignal.any([controller.signal, signal])
        : controller.signal;

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
        case "json":
          acceptHeader = "application/json;q=1.0, */*;q=0.1";
          break;
      }

      try {
        const response = await fetch(url, {
          signal: combinedSignal,
          redirect: "follow",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept: acceptHeader,
            "Accept-Language": "en-US,en;q=0.9",
            ...customHeaders,
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

        const contentType = response.headers.get("content-type") || "";
        const finalUrl = response.url;
        const redirected = response.redirected || finalUrl !== url;

        // PDF handling
        if (isPdf(contentType, url)) {
          try {
            const { text: pdfText } = await extractPdfText(new Uint8Array(arrayBuffer), { mergePages: true });
            const { output, truncated, totalChars } = truncateOutput(pdfText);
            return {
              content: [{ type: "text", text: output }],
              details: {
                url,
                finalUrl: redirected ? finalUrl : undefined,
                contentType,
                format: "pdf→text",
                size: arrayBuffer.byteLength,
                totalChars,
                truncated,
                redirected,
              } as FetchDetails,
            };
          } catch {
            return {
              content: [{ type: "text", text: "Error: Failed to extract text from PDF" }],
              details: { url, error: true, contentType } as FetchDetails,
            };
          }
        }

        const content = new TextDecoder().decode(arrayBuffer);

        // JSON handling
        if (format === "json" || (format === "markdown" && isJson(contentType))) {
          try {
            const parsed = JSON.parse(content);
            const formatted = JSON.stringify(parsed, null, 2);
            const { output, truncated, totalChars } = truncateOutput(formatted);
            return {
              content: [{ type: "text", text: output }],
              details: {
                url,
                finalUrl: redirected ? finalUrl : undefined,
                contentType,
                format: "json",
                size: arrayBuffer.byteLength,
                totalChars,
                truncated,
                redirected,
              } as FetchDetails,
            };
          } catch {
            // Not valid JSON, fall through to regular handling
          }
        }

        let html = content;

        // Apply CSS selector if provided
        if (selector && contentType.includes("text/html")) {
          const extracted = applySelector(html, selector);
          if (!extracted) {
            return {
              content: [
                {
                  type: "text",
                  text: `No content found matching selector: ${selector}`,
                },
              ],
              details: { url, selector, error: true } as FetchDetails,
            };
          }
          html = extracted;
        }

        let output: string;

        switch (format) {
          case "markdown":
            output = contentType.includes("text/html") ? convertHTMLToMarkdown(html) : html;
            break;
          case "text":
            output = contentType.includes("text/html") ? extractTextFromHTML(html) : html;
            break;
          case "html":
          case "json":
          default:
            output = html;
            break;
        }

        const { output: finalOutput, truncated, totalChars } = truncateOutput(output);

        return {
          content: [{ type: "text", text: finalOutput }],
          details: {
            url,
            finalUrl: redirected ? finalUrl : undefined,
            contentType,
            format,
            size: arrayBuffer.byteLength,
            totalChars,
            truncated,
            redirected,
            selector: selector || undefined,
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

      const tags: string[] = [];
      if (args.format && args.format !== "markdown") tags.push(args.format);
      if (args.selector) tags.push(args.selector);
      if (tags.length) text += theme.fg("dim", ` [${tags.join(", ")}]`);

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
      const truncationInfo = details?.truncated ? " [truncated]" : "";
      const redirectInfo = details?.redirected ? ` → ${details.finalUrl}` : "";
      const selectorInfo = details?.selector ? ` [${details.selector}]` : "";

      if (!expanded) {
        const preview = lines.slice(0, 4).join("\n");
        const hiddenCount = lines.length - 4;
        const moreInfo = hiddenCount > 0 ? theme.fg("dim", `\n... ${hiddenCount} more lines`) : "";
        return new Text(
          theme.fg("success", "✓") +
            theme.fg("muted", `${sizeInfo}${truncationInfo}${redirectInfo}${selectorInfo}\n${preview}`) +
            moreInfo,
          0,
          0,
        );
      }

      return new Text(fullText, 0, 0);
    },
  });
}
