/**
 * Plan Mode Extension
 *
 * Derived from pi-mono example:
 * https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/plan-mode/index.ts
 *
 * Purpose:
 * - Plan mode: read-only exploration + plan writing
 * - Execution mode: full tools enabled + optional progress tracking
 */

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";

import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./utils.js";

const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire"];
const NORMAL_MODE_TOOLS = ["read", "bash", "edit", "write"];

function isAssistantMessage(m: AgentMessage): m is AssistantMessage {
  return m.role === "assistant" && Array.isArray(m.content);
}

function getTextContent(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
  let planModeEnabled = false;
  let executionMode = false;
  let todoItems: TodoItem[] = [];

  pi.registerFlag("plan", {
    description: "Start in plan mode (read-only exploration)",
    type: "boolean",
    default: false,
  });

  function updateStatus(ctx: ExtensionContext): void {
    if (executionMode && todoItems.length > 0) {
      const completed = todoItems.filter((t) => t.completed).length;
      ctx.ui.setStatus(
        "plan-mode",
        ctx.ui.theme.fg("accent", `📋 ${completed}/${todoItems.length}`),
      );
    } else if (planModeEnabled) {
      ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan"));
    } else {
      ctx.ui.setStatus("plan-mode", undefined);
    }

    if (executionMode && todoItems.length > 0) {
      const lines = todoItems.map((item) => {
        if (item.completed) {
          return (
            ctx.ui.theme.fg("success", "☑ ") +
            ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
          );
        }
        return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
      });
      ctx.ui.setWidget("plan-todos", lines);
    } else {
      ctx.ui.setWidget("plan-todos", undefined);
    }
  }

  function togglePlanMode(ctx: ExtensionContext): void {
    planModeEnabled = !planModeEnabled;
    executionMode = false;
    todoItems = [];

    if (planModeEnabled) {
      pi.setActiveTools(PLAN_MODE_TOOLS);
      ctx.ui.notify(`Plan mode enabled. Tools: ${PLAN_MODE_TOOLS.join(", ")}`);
    } else {
      pi.setActiveTools(NORMAL_MODE_TOOLS);
      ctx.ui.notify("Plan mode disabled. Full access restored.");
    }

    updateStatus(ctx);
  }

  function persistState(): void {
    pi.appendEntry("plan-mode", {
      enabled: planModeEnabled,
      todos: todoItems,
      executing: executionMode,
    });
  }

  pi.registerCommand("plan", {
    description: "Toggle plan mode (read-only exploration)",
    handler: async (_args, ctx) => togglePlanMode(ctx),
  });

  pi.registerCommand("todos", {
    description: "Show current plan todo list",
    handler: async (_args, ctx) => {
      if (todoItems.length === 0) {
        ctx.ui.notify("No todos. Create a plan first with /plan", "info");
        return;
      }
      const list = todoItems
        .map((item, i) => `${i + 1}. ${item.completed ? "✓" : "○"} ${item.text}`)
        .join("\n");
      ctx.ui.notify(`Plan Progress:\n${list}`, "info");
    },
  });

  pi.registerShortcut(Key.shift("p"), {
    description: "Toggle plan mode",
    handler: async (ctx) => togglePlanMode(ctx),
  });

  pi.on("tool_call", async (event) => {
    if (!planModeEnabled || event.toolName !== "bash") return;

    const command = event.input.command as string;
    if (!isSafeCommand(command)) {
      return {
        block: true,
        reason: `Plan mode: command blocked (not allowlisted). Use /plan to disable plan mode first.\nCommand: ${command}`,
      };
    }
  });

  pi.on("context", async (event) => {
    if (planModeEnabled) return;

    return {
      messages: event.messages.filter((m) => {
        const msg = m as AgentMessage & { customType?: string };
        if (msg.customType === "plan-mode-context") return false;
        if (msg.role !== "user") return true;

        const content = msg.content;
        if (typeof content === "string") return !content.includes("[PLAN MODE ACTIVE]");
        if (Array.isArray(content)) {
          return !content.some(
            (c) => c.type === "text" && (c as TextContent).text?.includes("[PLAN MODE ACTIVE]"),
          );
        }
        return true;
      }),
    };
  });

  pi.on("before_agent_start", async () => {
    if (planModeEnabled) {
      return {
        message: {
          customType: "plan-mode-context",
          content: `[PLAN MODE ACTIVE]\nYou are in plan mode (read-only).\n\nRestrictions:\n- Tools: ${PLAN_MODE_TOOLS.join(", ")}\n- No edit/write; no scratch files\n- Bash is allowlisted read-only\n\nOutput requirements (strict):\n- Make plan extremely concise. Sacrifice grammar for concision.\n- One recommended plan only (no long option lists unless asked).\n- Never ask: \"is my plan ok?\" / \"should I proceed?\".\n\nFormat (strict):\nPlan:\n1. ...\n2. ...\nFiles: path1, path2, ...\nChecks: (only if non-obvious)\nUnresolved: none | Q1? Q2?`,
          display: false,
        },
      };
    }

    if (executionMode && todoItems.length > 0) {
      const remaining = todoItems.filter((t) => !t.completed);
      const todoList = remaining.map((t) => `${t.step}. ${t.text}`).join("\n");
      return {
        message: {
          customType: "plan-execution-context",
          content: `[EXECUTING PLAN]\n\nRemaining steps:\n${todoList}\n\nExecute each step in order. After completing a step, include a [DONE:n] tag in your response.`,
          display: false,
        },
      };
    }
  });

  pi.on("turn_end", async (event, ctx) => {
    if (!executionMode || todoItems.length === 0) return;
    if (!isAssistantMessage(event.message)) return;

    const text = getTextContent(event.message);
    if (markCompletedSteps(text, todoItems) > 0) {
      updateStatus(ctx);
    }
    persistState();
  });

  pi.on("agent_end", async (event, ctx) => {
    if (executionMode && todoItems.length > 0) {
      if (todoItems.every((t) => t.completed)) {
        executionMode = false;
        todoItems = [];
        pi.setActiveTools(NORMAL_MODE_TOOLS);
        updateStatus(ctx);
        persistState();
      }
      return;
    }

    if (!planModeEnabled || !ctx.hasUI) return;

    const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
    if (lastAssistant) {
      const extracted = extractTodoItems(getTextContent(lastAssistant));
      if (extracted.length > 0) todoItems = extracted;
    }

    const choice = await ctx.ui.select("Plan mode - what next?", [
      todoItems.length > 0 ? "Execute the plan (track progress)" : "Execute the plan",
      "Stay in plan mode",
      "Refine the plan",
    ]);

    if (choice?.startsWith("Execute")) {
      planModeEnabled = false;
      executionMode = todoItems.length > 0;
      pi.setActiveTools(NORMAL_MODE_TOOLS);
      updateStatus(ctx);

      const execMessage =
        todoItems.length > 0
          ? `Execute the plan. Start with: ${todoItems[0].text}`
          : "Execute the plan you just created.";
      pi.sendMessage(
        { customType: "plan-mode-execute", content: execMessage, display: true },
        { triggerTurn: true },
      );
    } else if (choice === "Refine the plan") {
      const refinement = await ctx.ui.editor("Refine the plan:", "");
      if (refinement?.trim()) pi.sendUserMessage(refinement.trim());
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    if (pi.getFlag("plan") === true) planModeEnabled = true;

    const entries = ctx.sessionManager.getEntries();
    const planModeEntry = entries
      .filter(
        (e: { type: string; customType?: string }) =>
          e.type === "custom" && e.customType === "plan-mode",
      )
      .pop() as
      | { data?: { enabled: boolean; todos?: TodoItem[]; executing?: boolean } }
      | undefined;

    if (planModeEntry?.data) {
      planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
      todoItems = planModeEntry.data.todos ?? todoItems;
      executionMode = planModeEntry.data.executing ?? executionMode;
    }

    const isResume = planModeEntry !== undefined;
    if (isResume && executionMode && todoItems.length > 0) {
      let executeIndex = -1;
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i] as { type: string; customType?: string };
        if (entry.customType === "plan-mode-execute") {
          executeIndex = i;
          break;
        }
      }

      const messages: AssistantMessage[] = [];
      for (let i = executeIndex + 1; i < entries.length; i++) {
        const entry = entries[i];
        if (
          entry.type === "message" &&
          "message" in entry &&
          isAssistantMessage((entry as any).message as AgentMessage)
        ) {
          messages.push((entry as any).message as AssistantMessage);
        }
      }
      const allText = messages.map(getTextContent).join("\n");
      markCompletedSteps(allText, todoItems);
    }

    if (planModeEnabled) pi.setActiveTools(PLAN_MODE_TOOLS);
    updateStatus(ctx);
  });
}
