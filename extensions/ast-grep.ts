/**
 * ast-grep Tool Extensions
 *
 * AST-based code search and rewrite using ast-grep (sg).
 * Patterns match syntax structure, not text.
 */

import { type ExtensionAPI, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const SEARCH_DESCRIPTION = `Search code by AST pattern.

Unlike grep, patterns match syntax structure. Use $NAME for single node, $$$NAME for multiple nodes.

Examples:
- 'console.log($MSG)' — find console.log calls
- '$OBJ.map($FN)' — find .map() calls  
- 'if ($COND) { return $VAL }' — find early returns
- 'function $NAME($$$ARGS) { $$$BODY }' — find function declarations

Supports: TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, and more.`;

const REWRITE_DESCRIPTION = `Rewrite code by AST pattern.

Find matches and replace them. Metavariables ($NAME, $$$NAME) capture values for use in replacement.

Examples:
- pattern: 'console.log($MSG)' → replacement: 'logger.debug($MSG)'
- pattern: 'var $X = $V' → replacement: 'const $X = $V'
- pattern: '$ARR.forEach(($ITEM) => { $$$BODY })' → replacement: 'for (const $ITEM of $ARR) { $$$BODY }'

Use dryRun:true to preview changes without applying.`;

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ast-search",
    label: "AST Search",
    description: SEARCH_DESCRIPTION,
    parameters: Type.Object({
      pattern: Type.String({ description: "AST pattern to match" }),
      lang: Type.Optional(Type.String({ description: "Language (typescript, python, go, rust, etc.)" })),
      path: Type.Optional(Type.String({ description: "Path to search (default: current directory)" })),
    }),

    async execute(_toolCallId, params, _onUpdate, ctx, signal) {
      const { pattern, lang, path } = params as { pattern: string; lang?: string; path?: string };

      const args = ["run", "-p", pattern, "--color=never"];
      if (lang) args.push("-l", lang);
      args.push(path || ".");

      const result = await pi.exec("sg", args, { signal, cwd: ctx.cwd });

      if (result.killed) {
        return { content: [{ type: "text", text: "Search cancelled" }], details: {} };
      }

      const output = result.stdout || result.stderr;
      if (!output.trim()) {
        return { content: [{ type: "text", text: "No matches found" }], details: {} };
      }

      const truncation = truncateTail(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
      let text = truncation.content;
      if (truncation.truncated) {
        text += `\n\n[Truncated: showing last ${truncation.outputLines} of ${truncation.totalLines} lines]`;
      }

      return { content: [{ type: "text", text }], details: {} };
    },

    renderCall(params, theme) {
      const { pattern, lang, path } = params as { pattern: string; lang?: string; path?: string };
      let text = theme.fg("toolTitle", theme.bold("ast-search "));
      text += theme.fg("accent", `'${pattern}'`);
      if (lang) text += theme.fg("dim", ` -l ${lang}`);
      if (path) text += theme.fg("muted", ` ${path}`);
      return new Text(text, 0, 0);
    },
  });

  pi.registerTool({
    name: "ast-rewrite",
    label: "AST Rewrite",
    description: REWRITE_DESCRIPTION,
    parameters: Type.Object({
      pattern: Type.String({ description: "AST pattern to match" }),
      replacement: Type.String({ description: "Replacement pattern (use captured $NAME variables)" }),
      lang: Type.Optional(Type.String({ description: "Language (typescript, python, go, rust, etc.)" })),
      path: Type.Optional(Type.String({ description: "Path to rewrite (default: current directory)" })),
      dryRun: Type.Optional(Type.Boolean({ description: "Preview changes without applying (default: false)" })),
    }),

    async execute(_toolCallId, params, _onUpdate, ctx, signal) {
      const { pattern, replacement, lang, path, dryRun } = params as {
        pattern: string;
        replacement: string;
        lang?: string;
        path?: string;
        dryRun?: boolean;
      };

      const args = ["run", "-p", pattern, "-r", replacement, "--color=never"];
      if (lang) args.push("-l", lang);
      if (!dryRun) args.push("-U"); // --update-all: apply changes in place
      args.push(path || ".");

      const result = await pi.exec("sg", args, { signal, cwd: ctx.cwd });

      if (result.killed) {
        return { content: [{ type: "text", text: "Rewrite cancelled" }], details: {} };
      }

      const output = result.stdout || result.stderr;
      if (!output.trim()) {
        return {
          content: [{ type: "text", text: dryRun ? "No matches found" : "No matches found (nothing to rewrite)" }],
          details: {},
        };
      }

      const truncation = truncateTail(output, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
      let text = truncation.content;

      if (dryRun) {
        text = "DRY RUN — changes NOT applied:\n\n" + text;
      }

      if (truncation.truncated) {
        text += `\n\n[Truncated: showing last ${truncation.outputLines} of ${truncation.totalLines} lines]`;
      }

      return { content: [{ type: "text", text }], details: {} };
    },

    renderCall(params, theme) {
      const { pattern, replacement, lang, path, dryRun } = params as {
        pattern: string;
        replacement: string;
        lang?: string;
        path?: string;
        dryRun?: boolean;
      };
      let text = theme.fg("toolTitle", theme.bold("ast-rewrite "));
      text += theme.fg("accent", `'${pattern}'`);
      text += theme.fg("dim", " → ");
      text += theme.fg("success", `'${replacement}'`);
      if (lang) text += theme.fg("dim", ` -l ${lang}`);
      if (path) text += theme.fg("muted", ` ${path}`);
      if (dryRun) text += theme.fg("warning", " [dry-run]");
      return new Text(text, 0, 0);
    },
  });
}
