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

  return `Act as my Pi coach. Orient me and recommend one next move.

Use live evidence where useful:
- current conversation/session context
- current working directory and git state
- handbook: ${handbookPath}
- prompt shortcuts: ${promptsPath}
- rules: ${rulesPath}
- skills: ${skillsPath}
${focus ? `\nFocus especially on: ${focus}\n` : ""}
You may inspect files and run read-only commands. Do not edit files, commit, push, or start implementation.

Return only:
1. State: one short paragraph
2. Next steps: up to 5 bullets
3. Best action: one concrete prompt/command to run next`;
}

export default function coach(pi: ExtensionAPI) {
  pi.registerCommand("coach", {
    description: "Analyze current state against my Pi handbook and suggest the next move",
    async handler(args, ctx) {
      ctx.ui.notify("Running coach…", "info");
      pi.sendUserMessage(buildCoachPrompt(args));
    },
  });
}
