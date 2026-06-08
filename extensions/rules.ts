/**
 * Rules Extension
 *
 * Scans ~/.pi/agent/rules/ for rule files and loads their content into the system prompt.
 * Rules are eagerly loaded for better adherence.
 *
 * Supports optional YAML frontmatter for filtering:
 *   - `models:` glob pattern(s) matching "provider/model-id" (e.g. "openai-codex/*", "llm-proxy/claude-*")
 *   - `paths:` (passthrough, handled by pi core)
 *
 * Rules without `models:` frontmatter apply to all models.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { minimatch } from "minimatch";

type RuleFrontmatter = {
  models?: string | string[];
  [key: string]: unknown;
};

type RuleFile = {
  relativePath: string;
  fullPath: string;
  content: string;
  frontmatter: RuleFrontmatter;
  body: string;
};

function matchesModel(patterns: string | string[], modelKey: string): boolean {
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return list.some((p) => minimatch(modelKey, p));
}

function loadRuleFiles(dir: string, basePath: string = ""): RuleFile[] {
  const results: RuleFile[] = [];

  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);

    let isDirectory = entry.isDirectory();
    let isFile = entry.isFile();

    if (entry.isSymbolicLink()) {
      try {
        const stats = fs.statSync(fullPath);
        isDirectory = stats.isDirectory();
        isFile = stats.isFile();
      } catch {
        continue;
      }
    }

    if (isDirectory) {
      results.push(...loadRuleFiles(fullPath, relativePath));
    } else if (isFile && entry.name.endsWith(".md")) {
      try {
        const content = fs.readFileSync(fullPath, "utf-8");
        const { frontmatter, body } = parseFrontmatter<RuleFrontmatter>(content);
        results.push({ relativePath, fullPath, content, frontmatter, body });
      } catch {
        // Skip files that can't be read
      }
    }
  }

  return results;
}

const RULES_MESSAGE_TYPE = "rules-list";

type RulesMessageDetails = {
  files: string[];
};

function isRulesListMessage(message: AgentMessage): boolean {
  if (message.role !== "custom") return false;
  return (message as { customType?: string }).customType === RULES_MESSAGE_TYPE;
}

export default function rulesExtension(pi: ExtensionAPI) {
  let ruleFiles: RuleFile[] = [];
  const rulesDir = path.join(os.homedir(), ".pi", "agent", "rules");

  pi.registerMessageRenderer<RulesMessageDetails>(
    RULES_MESSAGE_TYPE,
    (message, _options, theme) => {
      const files = message.details?.files ?? [];
      const lines: string[] = [];
      lines.push(theme.fg("mdHeading", "[Rules]"));
      lines.push(`  ${theme.fg("accent", "user")}`);
      for (const file of files) {
        const shortPath = file.replace(os.homedir(), "~");
        lines.push(theme.fg("dim", `    ${shortPath}`));
      }
      return new Text(lines.join("\n"), 0, 0);
    },
  );

  pi.on("context", async (event) => {
    return {
      messages: event.messages.filter((message) => !isRulesListMessage(message)),
    };
  });

  pi.on("session_start", async (_event, ctx) => {
    ruleFiles = loadRuleFiles(rulesDir);

    if (ruleFiles.length > 0) {
      if (ctx.hasUI) {
        const files = ruleFiles.map((rule) => rule.fullPath);
        pi.sendMessage({
          customType: RULES_MESSAGE_TYPE,
          content: "Loaded rules",
          display: true,
          details: { files },
        });
      }

      ctx.ui.notify(`Loaded ${ruleFiles.length} rule(s) from ~/.pi/agent/rules/`, "info");
    }
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (ruleFiles.length === 0) return;

    const model = ctx.model;
    const modelKey = model ? `${model.provider}/${model.id}` : "";

    const activeRules = ruleFiles.filter((rule) => {
      if (!rule.frontmatter.models) return true;
      if (!modelKey) return true;
      return matchesModel(rule.frontmatter.models, modelKey);
    });

    if (activeRules.length === 0) return;

    const rulesContent = activeRules
      .map((rule) => `Instructions from: ${rule.fullPath}\n${rule.body}`)
      .join("\n\n");

    return {
      systemPrompt: `${rulesContent}

${event.systemPrompt}`,
    };
  });
}
