/**
 * Background Process Manager
 *
 * Start, stop, and monitor long-running processes (dev servers, watchers) without blocking.
 * Processes are tracked with PIDs in /tmp/pi-bg-*.pid, logs in /tmp/pi-bg-*.log.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { spawn, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const LOGS_DIR = "/tmp";
const PID_PREFIX = "pi-bg-";

interface ProcessInfo {
  name: string;
  pid: number;
  running: boolean;
  logFile: string;
  error?: boolean;
}

interface StopDetails {
  name: string;
  error?: boolean;
}

interface LogsDetails {
  name: string;
  logs: string;
  error?: boolean;
}

function listProcesses(): ProcessInfo[] {
  let pidFiles: string[];
  try {
    pidFiles = fs
      .readdirSync(LOGS_DIR)
      .filter((f) => f.startsWith(PID_PREFIX) && f.endsWith(".pid"));
  } catch {
    return [];
  }

  return pidFiles.map((file) => {
    const name = file.slice(PID_PREFIX.length, -4);
    const pidFile = path.join(LOGS_DIR, file);
    const logFile = path.join(LOGS_DIR, `${PID_PREFIX}${name}.log`);

    let pid = 0;
    let running = false;

    try {
      pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
      process.kill(pid, 0);
      running = true;
    } catch {
      running = false;
    }

    return { name, pid, running, logFile };
  });
}

function startProcess(name: string, command: string, cwd?: string): ProcessInfo {
  const pidFile = path.join(LOGS_DIR, `${PID_PREFIX}${name}.pid`);
  const logFile = path.join(LOGS_DIR, `${PID_PREFIX}${name}.log`);

  const existing = listProcesses().find((p) => p.name === name && p.running);
  if (existing) {
    throw new Error(`Process "${name}" already running (PID ${existing.pid})`);
  }

  const logFd = fs.openSync(logFile, "w");

  const child = spawn("bash", ["-c", command], {
    cwd: cwd || process.cwd(),
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  const pid = child.pid;
  if (!pid) {
    fs.closeSync(logFd);
    throw new Error("Failed to start process");
  }

  child.unref();
  fs.writeFileSync(pidFile, pid.toString());

  return { name, pid, running: true, logFile };
}

function stopProcess(name: string): void {
  const pidFile = path.join(LOGS_DIR, `${PID_PREFIX}${name}.pid`);

  if (!fs.existsSync(pidFile)) {
    throw new Error(`Process "${name}" not found`);
  }

  const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already dead
  }

  fs.unlinkSync(pidFile);
}

function readLogs(name: string, lines: number): string {
  const logFile = path.join(LOGS_DIR, `${PID_PREFIX}${name}.log`);

  if (!fs.existsSync(logFile)) {
    throw new Error(`Log file for "${name}" not found`);
  }

  const result = spawnSync("tail", ["-n", lines.toString(), logFile], {
    encoding: "utf8",
  });

  return result.stdout || result.stderr || "";
}

function getChildPids(pid: number): number[] {
  try {
    const result = spawnSync("pgrep", ["-P", pid.toString()], {
      encoding: "utf8",
      timeout: 500,
    });
    if (!result.stdout) return [];
    return result.stdout.trim().split("\n").map((s) => parseInt(s, 10)).filter((n) => n > 0);
  } catch {
    return [];
  }
}

function getListeningPorts(pid: number): number[] {
  const pids = [pid, ...getChildPids(pid)];
  const ports = new Set<number>();
  
  for (const p of pids) {
    try {
      const result = spawnSync("lsof", ["-iTCP", "-sTCP:LISTEN", "-P", "-n", "-a", "-p", p.toString()], {
        encoding: "utf8",
        timeout: 500,
      });
      if (!result.stdout) continue;
      for (const line of result.stdout.split("\n").slice(1)) {
        const match = line.match(/:(\d+)\s+\(LISTEN\)/);
        if (match) ports.add(parseInt(match[1], 10));
      }
    } catch {
      continue;
    }
  }
  return [...ports];
}

function updateStatus(ctx: ExtensionContext) {
  const running = listProcesses().filter((p) => p.running);
  if (running.length === 0) {
    ctx.ui.setStatus("background", undefined);
    ctx.ui.setWidget("background-logs", undefined);
  } else {
    const theme = ctx.ui.theme;
    const items = running.map((p) => {
      const ports = getListeningPorts(p.pid);
      if (ports.length > 0) {
        return p.name + ":" + theme.fg("accent", ports.join(","));
      }
      return p.name;
    }).join(" ");
    ctx.ui.setStatus("background", theme.fg("success", "●") + " " + items);

    // Show last few lines of logs from all running processes
    ctx.ui.setWidget(
      "background-logs",
      (_tui, theme) => {
        const container = new Container();
        container.addChild(new DynamicBorder((s) => theme.fg("border", s)));
        for (const proc of running) {
          try {
            const logs = readLogs(proc.name, 2);
            container.addChild(new Text(theme.fg("muted", ` ${proc.name} `), 0, 0));
            if (logs.trim()) {
              for (const line of logs.trim().split("\n")) {
                container.addChild(new Text(theme.fg("dim", ` ${line}`), 0, 0));
              }
            }
          } catch {
            container.addChild(new Text(theme.fg("muted", ` ${proc.name} `), 0, 0));
            container.addChild(new Text(theme.fg("dim", " (no logs)"), 0, 0));
          }
        }
        container.addChild(new DynamicBorder((s) => theme.fg("border", s)));
        return container;
      },
      { placement: "belowEditor" },
    );
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => updateStatus(ctx));
  pi.on("turn_start", (_event, ctx) => updateStatus(ctx));
  pi.on("turn_end", (_event, ctx) => updateStatus(ctx));

  pi.registerTool({
    name: "background-start",
    label: "Start Background",
    description:
      "Start a long-running process in background (dev server, watcher, etc.). Use ONLY when you need to run something that doesn't exit immediately. DO NOT use for regular commands - use bash instead.",
    parameters: Type.Object({
      name: Type.String({
        description:
          "Unique name for this process (e.g., 'beebro-server', 'vite-dev'). Use kebab-case.",
      }),
      command: Type.String({
        description: 'Shell command to run (e.g., "bun run dev", "npm start")',
      }),
      cwd: Type.Optional(
        Type.String({
          description: "Working directory (defaults to current directory)",
        }),
      ),
    }),

    async execute(_toolCallId, params, _onUpdate, ctx) {
      try {
        const info = startProcess(params.name, params.command, params.cwd);
        updateStatus(ctx);
        return {
          content: [
            {
              type: "text" as const,
              text: `Started "${info.name}" (PID ${info.pid})\nLogs: ${info.logFile}`,
            },
          ],
          details: info,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: {
            name: params.name,
            pid: 0,
            running: false,
            logFile: "",
            error: true,
          } satisfies ProcessInfo,
        };
      }
    },

    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("background-start ")) +
          theme.fg("accent", args.name) +
          theme.fg("dim", ` → ${args.command}`),
        0,
        0,
      );
    },

    renderResult(result, _options, theme) {
      const details = result.details as ProcessInfo;
      if (details.error) {
        const text = result.content[0];
        return new Text(
          theme.fg("error", text?.type === "text" ? text.text : "Error"),
          0,
          0,
        );
      }
      return new Text(
        theme.fg("success", "✓ ") +
          theme.fg("accent", details.name) +
          theme.fg("dim", ` PID ${details.pid}`),
        0,
        0,
      );
    },
  });

  pi.registerTool({
    name: "background-stop",
    label: "Stop Background",
    description:
      "Stop a running background process. Use when you need to stop a dev server or watcher that was started with background-start.",
    parameters: Type.Object({
      name: Type.String({
        description: "Name of the process to stop (as given to background-start)",
      }),
    }),

    async execute(_toolCallId, params, _onUpdate, ctx) {
      try {
        stopProcess(params.name);
        updateStatus(ctx);
        return {
          content: [{ type: "text" as const, text: `Stopped "${params.name}"` }],
          details: { name: params.name } as StopDetails,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { name: params.name, error: true } as StopDetails,
        };
      }
    },

    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("background-stop ")) + theme.fg("accent", args.name),
        0,
        0,
      );
    },

    renderResult(result, _options, theme) {
      const details = result.details as StopDetails;
      if (details.error) {
        const text = result.content[0];
        return new Text(
          theme.fg("error", text?.type === "text" ? text.text : "Error"),
          0,
          0,
        );
      }
      return new Text(theme.fg("success", "✓ Stopped"), 0, 0);
    },
  });

  pi.registerTool({
    name: "background-list",
    label: "List Background",
    description:
      "List all background processes and their status. Use to see what's currently running.",
    parameters: Type.Object({}),

    async execute() {
      const processes = listProcesses();

      if (processes.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No background processes" }],
          details: { processes: [] as ProcessInfo[] },
        };
      }

      const lines = processes.map((p) => {
        const status = p.running ? `✓ Running (PID ${p.pid})` : "✗ Stopped";
        return `${p.name}: ${status}`;
      });

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: { processes },
      };
    },

    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("background-list")), 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as { processes: ProcessInfo[] };
      if (details.processes.length === 0) {
        return new Text(theme.fg("dim", "No processes"), 0, 0);
      }

      const lines = details.processes.map((p) => {
        const icon = p.running ? theme.fg("success", "✓") : theme.fg("error", "✗");
        const status = p.running ? theme.fg("dim", `PID ${p.pid}`) : theme.fg("dim", "stopped");
        return `${icon} ${theme.fg("text", p.name)} ${status}`;
      });

      return new Text(lines.join("\n"), 0, 0);
    },
  });

  pi.registerTool({
    name: "background-logs",
    label: "Background Logs",
    description:
      "Read logs from a background process. Use to check output from a running dev server or watcher.",
    parameters: Type.Object({
      name: Type.String({
        description: "Name of the process",
      }),
      lines: Type.Optional(
        Type.Number({
          description: "Number of lines to read (default: 50)",
          default: 50,
        }),
      ),
    }),

    async execute(_toolCallId, params) {
      try {
        const logs = readLogs(params.name, params.lines ?? 50);
        return {
          content: [{ type: "text" as const, text: logs }],
          details: { name: params.name, logs } as LogsDetails,
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          details: { name: params.name, logs: "", error: true } as LogsDetails,
        };
      }
    },

    renderCall(args, theme) {
      return new Text(
        theme.fg("toolTitle", theme.bold("background-logs ")) +
          theme.fg("accent", args.name) +
          theme.fg("dim", ` (${args.lines ?? 50} lines)`),
        0,
        0,
      );
    },

    renderResult(result, _options, theme) {
      const details = result.details as LogsDetails;
      if (details.error) {
        const text = result.content[0];
        return new Text(
          theme.fg("error", text?.type === "text" ? text.text : "Error"),
          0,
          0,
        );
      }
      const preview = details.logs.split("\n").slice(-3).join("\n");
      return new Text(theme.fg("dim", preview || "(empty)"), 0, 0);
    },
  });
}
