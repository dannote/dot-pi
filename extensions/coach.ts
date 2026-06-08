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

  return `Act as my Pi coach. Analyze the current session state and suggest the highest-leverage next move.

Use live evidence where useful:
- current conversation/session context
- current working directory and git state
- handbook: ${handbookPath}
- prompt shortcuts: ${promptsPath}
- rules: ${rulesPath}
- skills: ${skillsPath}
${focus ? `\nFocus especially on: ${focus}\n` : ""}
Keep it minimal. Do not start implementing unless I explicitly ask.

Return:
1. Situation: one short paragraph
2. Best next move: one concrete action
3. Why this action
4. Exact prompt or command I should run next
5. Risks/checks, if any`;
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
