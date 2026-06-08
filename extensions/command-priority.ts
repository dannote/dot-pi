import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { parse } from "jsonc-parser";

const SETTING_KEYS = ["slashCommandPriority", "commandAutocompletePriority"];

function readPriorityFile(path: string): string[] {
  if (!existsSync(path)) return [];

  try {
    const settings = parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    for (const key of SETTING_KEYS) {
      const value = settings[key];
      if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === "string");
      }
    }
  } catch {
    return [];
  }

  return [];
}

function loadPriority(cwd: string): string[] {
  const globalPath = process.env.PI_CODING_AGENT_DIR
    ? join(process.env.PI_CODING_AGENT_DIR, "settings.json")
    : join(homedir(), ".pi", "agent", "settings.json");
  const projectPath = join(cwd, ".pi", "settings.json");

  const seen = new Set<string>();
  const priority = [...readPriorityFile(globalPath), ...readPriorityFile(projectPath)];

  return priority
    .map((name) => name.replace(/^\//, ""))
    .filter((name) => name.length > 0 && !seen.has(name) && seen.add(name));
}

function score(
  item: AutocompleteItem,
  query: string,
  priority: Map<string, number>,
  originalIndex: number,
): number {
  const name = item.value;
  const exact = name === query ? 0 : 1;
  const configured = priority.has(name) ? 0 : 1;
  const configuredIndex = priority.get(name) ?? Number.MAX_SAFE_INTEGER;
  const prefix = query === "" || name.startsWith(query) ? 0 : 1;

  return (
    exact * 1_000_000 +
    configured * 100_000 +
    configuredIndex * 1_000 +
    prefix * 100 +
    name.length +
    originalIndex / 1_000
  );
}

export default function commandPriority(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const priority = loadPriority(ctx.cwd);
    if (priority.length === 0) return;

    const priorityMap = new Map(priority.map((name, index) => [name, index]));

    ctx.ui.addAutocompleteProvider((current) => ({
      async getSuggestions(lines, cursorLine, cursorCol, options) {
        const result = await current.getSuggestions(lines, cursorLine, cursorCol, options);
        if (!result) return result;

        const beforeCursor = (lines[cursorLine] ?? "").slice(0, cursorCol);
        if (!beforeCursor.startsWith("/") || beforeCursor.includes(" ")) return result;

        const query = beforeCursor.slice(1);
        const items = result.items
          .map((item, index) => ({ item, index }))
          .sort(
            (a, b) =>
              score(a.item, query, priorityMap, a.index) -
              score(b.item, query, priorityMap, b.index),
          )
          .map(({ item }) => item);

        return { ...result, items };
      },

      applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
        return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
      },

      shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
        return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
      },
    }));
  });
}
