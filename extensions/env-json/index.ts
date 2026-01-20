/**
 * Load environment variables from ~/.pi/agent/env.json or env.jsonc into process.env.
 * Variables are applied at session start and affect all bash commands.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "jsonc-parser";
import { type ExtensionAPI, getAgentDir } from "@mariozechner/pi-coding-agent";

const agentDir = getAgentDir();

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    const envPath = [join(agentDir, "env.jsonc"), join(agentDir, "env.json")].find(existsSync);
    if (!envPath) return;

    try {
      const vars = parse(readFileSync(envPath, "utf-8"));
      let count = 0;

      for (const [key, value] of Object.entries(vars)) {
        if (value != null) {
          process.env[key] = String(value);
          count++;
        }
      }

      if (count > 0) {
        ctx.ui.notify(`Loaded ${count} env var${count === 1 ? "" : "s"} from env.json`, "info");
      }
    } catch (err) {
      ctx.ui.notify(`Failed to parse env.json: ${err}`, "error");
    }
  });
}
