import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const handbookPath = join(packageRoot, "docs", "handbook.md");
const promptsPath = join(packageRoot, "prompts");
const rulesPath = join(packageRoot, "rules");
const skillsPath = join(packageRoot, "skills");

function buildCoachPrompt(args: string): string {
  const focus = args.trim();

  return `Act as a newcomer coach for this Pi setup. Help a human understand the setup, patterns, and habits.

Use live evidence where useful:
- handbook: ${handbookPath}
- prompt shortcuts: ${promptsPath}
- rules: ${rulesPath}
- skills: ${skillsPath}
${focus ? `\nFocus especially on: ${focus}\n` : ""}
Keep it practical and concise. Do not edit files, commit, push, or start implementation.

Return only:
1. What this setup is for
2. The 5 most important habits/shortcuts to learn first
3. Recommended first workflow for a newcomer
4. Best next command or prompt to try`;
}

export default function coach(pi: ExtensionAPI) {
  pi.registerCommand("coach", {
    description: "Explain this Pi setup and recommend newcomer workflow habits",
    async handler(args, ctx) {
      ctx.ui.notify("Running coach…", "info");
      pi.sendUserMessage(buildCoachPrompt(args));
    },
  });
}
