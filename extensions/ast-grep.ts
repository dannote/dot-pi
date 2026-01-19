/**
 * ast-grep Tool Extension
 *
 * AST-based code search and rewrite using ast-grep (sg).
 * Patterns match syntax structure, not text.
 */

import { type ExtensionAPI, DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateTail } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

const DESCRIPTION = `Search code by AST pattern using ast-grep.

Unlike grep, patterns match syntax structure. Use $NAME for metavariables that match any node.

Examples:
- 'console.log($MSG)' - find all console.log calls
- '$OBJ.map($FN)' - find all .map() calls
- 'if ($COND) { return $VAL }' - find early returns
- 'useState($INIT)' - find React useState calls

Supports: TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, and more.`;

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ast-grep",
    label: "AST Grep",
    description: DESCRIPTION,
    parameters: Type.Object({
      pattern: Type.String({ description: "AST pattern to match (use $NAME for metavariables)" }),
      lang: Type.Optional(Type.String({ description: "Language (typescript, python, go, rust, etc.)" })),
      path: Type.Optional(Type.String({ description: "Path to search (default: current directory)" })),
    }),

    async execute(_toolCallId, params, _onUpdate, ctx, signal) {
      const { pattern, lang, path } = params as { pattern: string; lang?: string; path?: string };

      const args = ["run", "-p", pattern, "--color=never"];
      if (lang) args.push("-l", lang);
      args.push(path || ".");

      const result = await pi.exec("ast-grep", args, { signal, cwd: ctx.cwd });

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
      let text = theme.fg("toolTitle", theme.bold("ast-grep "));
      text += theme.fg("accent", pattern);
      if (lang) text += theme.fg("dim", ` -l ${lang}`);
      if (path) text += theme.fg("muted", ` ${path}`);
      return new Text(text, 0, 0);
    },
  });
}
