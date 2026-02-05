/**
 * Background Process Manager
 *
 * Start, stop, and monitor long-running processes (dev servers, watchers) without blocking.
 * 
 * Storage: /tmp/pi-bg/<project-hash>/<name>.{pid,log,json}
 * The .json file stores metadata (cwd, command) for display purposes.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { DynamicBorder, truncateTail } from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { spawn, spawnSync } from "child_process";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const BASE_DIR = "/tmp/pi-bg";

interface ProcessMeta {
  projectDir: string;
  cwd?: string;
  command: string;
}

interface ProcessInfo {
  name: string;
  pid: number;
  running: boolean;
  logFile: string;
  cwd?: string;
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

function getProjectDir(projectDir: string): string {
  const hash = crypto.createHash("sha256").update(projectDir).digest("hex").slice(0, 12);
  const name = path.basename(projectDir);
  return path.join(BASE_DIR, `${name}-${hash}`);
}

function ensureProjectDir(projectDir: string): string {
  const dir = getProjectDir(projectDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getRelativeCwd(projectDir: string, cwd: string): string | undefined {
  if (cwd === projectDir) return undefined;
  if (cwd.startsWith(projectDir + "/")) {
    return path.relative(projectDir, cwd);
  }
  return cwd;
}

function listProcesses(projectDir: string): ProcessInfo[] {
  let projectDirs: string[];
  try {
    projectDirs = fs.readdirSync(BASE_DIR).map((d) => path.join(BASE_DIR, d));
  } catch {
    return [];
  }

  const results: ProcessInfo[] = [];

  for (const dir of projectDirs) {
    let files: string[];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith(".pid"));
    } catch {
      continue;
    }

    for (const file of files) {
      const name = file.slice(0, -4);
      const pidFile = path.join(dir, file);
      const logFile = path.join(dir, `${name}.log`);
      const metaFile = path.join(dir, `${name}.json`);

      let meta: ProcessMeta | undefined;
      try {
        meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
      } catch {
        continue;
      }

      // Filter: only show processes from this project or its subdirectories
      if (!meta.projectDir.startsWith(projectDir)) continue;

      let pid = 0;
      let running = false;

      try {
        pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);
        process.kill(pid, 0);
        running = true;
      } catch {
        running = false;
      }

      // Calculate display cwd relative to current projectDir
      let cwd: string | undefined;
      if (meta.projectDir !== projectDir) {
        const relProject = path.relative(projectDir, meta.projectDir);
        cwd = meta.cwd ? path.join(relProject, meta.cwd) : relProject;
      } else {
        cwd = meta.cwd;
      }

      results.push({ name, pid, running, logFile, cwd });
    }
  }

  return results;
}

function startProcess(projectDir: string, name: string, command: string, cwd?: string): ProcessInfo {
  const dir = ensureProjectDir(projectDir);
  const pidFile = path.join(dir, `${name}.pid`);
  const logFile = path.join(dir, `${name}.log`);
  const metaFile = path.join(dir, `${name}.json`);

  const existing = listProcesses(projectDir).find((p) => p.name === name && p.running);
  if (existing) {
    throw new Error(`Process "${name}" already running (PID ${existing.pid})`);
  }

  const actualCwd = cwd || projectDir;
  const relativeCwd = getRelativeCwd(projectDir, actualCwd);
  const logFd = fs.openSync(logFile, "w");

  const child = spawn("bash", ["-c", command], {
    cwd: actualCwd,
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
  
  const meta: ProcessMeta = { projectDir, command, cwd: relativeCwd };
  fs.writeFileSync(metaFile, JSON.stringify(meta));

  return { name, pid, running: true, logFile, cwd: relativeCwd };
}

function findProcessDir(projectDir: string, name: string): string | null {
  const processes = listProcesses(projectDir);
  const proc = processes.find((p) => p.name === name);
  if (!proc) return null;
  return path.dirname(proc.logFile);
}

function stopProcess(projectDir: string, name: string): void {
  const dir = findProcessDir(projectDir, name);
  if (!dir) {
    throw new Error(`Process "${name}" not found`);
  }

  const pidFile = path.join(dir, `${name}.pid`);
  const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim(), 10);

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already dead
  }

  fs.unlinkSync(pidFile);
  try { fs.unlinkSync(path.join(dir, `${name}.json`)); } catch { /* ignore */ }
}

function readLogs(projectDir: string, name: string, lines: number): string {
  const dir = findProcessDir(projectDir, name);
  if (!dir) {
    throw new Error(`Log file for "${name}" not found`);
  }
  const logFile = path.join(dir, `${name}.log`);

  if (!fs.existsSync(logFile)) {
    throw new Error(`Log file for "${name}" not found`);
  }

  const result = spawnSync("tail", ["-n", lines.toString(), logFile], {
    encoding: "utf8",
  });

  const raw = result.stdout || result.stderr || "";
  const truncation = truncateTail(raw, { maxLines: lines });
  
  if (truncation.truncated) {
    return `[truncated: showing last ${truncation.outputLines} lines / ${truncation.outputBytes} bytes]\n${truncation.content}`;
  }
  
  return truncation.content;
}

function readFullLogs(projectDir: string, name: string): string {
  const dir = findProcessDir(projectDir, name);
  if (!dir) {
    throw new Error(`Log file for "${name}" not found`);
  }
  const logFile = path.join(dir, `${name}.log`);

  if (!fs.existsSync(logFile)) {
    throw new Error(`Log file for "${name}" not found`);
  }

  return fs.readFileSync(logFile, "utf8");
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

function getDisplayName(proc: ProcessInfo): string {
  if (proc.cwd) {
    return proc.cwd + "/" + proc.name;
  }
  return proc.name;
}

function updateStatus(ctx: ExtensionContext) {
  const running = listProcesses(ctx.cwd).filter((p) => p.running);
  if (running.length === 0) {
    ctx.ui.setStatus("background", undefined);
    ctx.ui.setWidget("background-logs", undefined);
  } else {
    const theme = ctx.ui.theme;
    const items = running.map((p) => {
      const display = getDisplayName(p);
      const ports = getListeningPorts(p.pid);
      if (ports.length > 0) {
        return display + ":" + theme.fg("accent", ports.join(","));
      }
      return display;
    }).join(" ");
    ctx.ui.setStatus("background", theme.fg("success", "●") + " " + items);

    ctx.ui.setWidget(
      "background-logs",
      (_tui, theme) => {
        const container = new Container();
        container.addChild(new DynamicBorder((s) => theme.fg("border", s)));
        for (const proc of running) {
          const displayName = getDisplayName(proc);
          try {
            const logs = readLogs(ctx.cwd, proc.name, 2);
            container.addChild(new Text(theme.fg("muted", ` ${displayName} `), 0, 0));
            if (logs.trim()) {
              for (const line of logs.trim().split("\n")) {
                container.addChild(new Text(theme.fg("dim", ` ${line}`), 0, 0));
              }
            }
          } catch {
            container.addChild(new Text(theme.fg("muted", ` ${displayName} `), 0, 0));
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

  pi.on("before_agent_start", async (event, ctx) => {
    const prompt = event.prompt.toLowerCase();
    const hasServerIntent = /\b(start|run|launch|serve|dev)\b/.test(prompt)
      && /\b(server|dev|app|bot|service|watch)\b/.test(prompt);

    if (hasServerIntent) {
      return {
        systemPrompt: event.systemPrompt + "\n\nFor dev servers and long-running processes, use `background-start`, NOT `bash`.",
      };
    }
  });

  const defaultPatterns = [
    /\b(bun|npm|yarn|pnpm)\s+run\s+(dev|start|serve|watch)\b/,
    /\b(bun|npm|yarn|pnpm)\s+start\b/,
    /\bnodemon\b/,
    /\bvite\b(?!\s+build)/,
    /\bnext\s+dev\b/,
    /\btsc\s+--watch\b/,
    /\bcargo\s+watch\b/,
    /\bflask\s+run\b/,
    /\buvicorn\b/,
    /\bgunicorn\b/,
    /\bpython\s+-m\s+http\.server\b/,
    /\bdocker\s+compose\s+up\b(?!\s+-d)/,
    /\b(redis|mongo|postgres|mysql).*-server\b/,
    /\bphp\s+-S\b/,
    /\bruby\s+.*server\b/,
    /\brails\s+s(erver)?\b/,
    /\b--watch\b/,
    /\b--serve\b/,
  ];

  const configPath = path.join(process.env.HOME || "~", ".pi", "background-patterns.json");
  let longRunningPatterns = defaultPatterns;
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (Array.isArray(config.patterns)) {
      const extraPatterns = config.patterns.map((p: string) => new RegExp(p, "i"));
      longRunningPatterns = [...defaultPatterns, ...extraPatterns];
    }
  } catch {
    // No config file — use defaults
  }

  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return;
    
    const cmd = event.input.command || "";
    const isLongRunning = longRunningPatterns.some((p) => p.test(cmd));
    if (isLongRunning) {
      return {
        block: true,
        reason: `This command runs indefinitely. Use \`background-start\` instead of \`bash\` for: ${cmd}`,
      };
    }
  });

  pi.registerCommand("kill", {
    description: "Stop a background process",
    getArgumentCompletions(prefix) {
      const running = listProcesses(process.cwd()).filter((p) => p.running);
      if (running.length === 0) return null;
      const filtered = prefix
        ? running.filter((p) => p.name.toLowerCase().startsWith(prefix.toLowerCase()))
        : running;
      return filtered.map((p) => ({
        value: p.name,
        label: p.name,
        description: `PID ${p.pid}`,
      }));
    },
    async handler(args, ctx) {
      const name = args.trim();
      if (!name) {
        ctx.ui.notify("Usage: /kill <process-name>", "info");
        return;
      }
      try {
        stopProcess(ctx.cwd, name);
        updateStatus(ctx);
        ctx.ui.notify(`Stopped "${name}"`, "info");
      } catch (err) {
        ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
      }
    },
  });

  pi.registerCommand("logs", {
    description: "View full logs from a background process",
    getArgumentCompletions(prefix) {
      const processes = listProcesses(process.cwd());
      if (processes.length === 0) return null;
      const filtered = prefix
        ? processes.filter((p) => p.name.toLowerCase().startsWith(prefix.toLowerCase()))
        : processes;
      return filtered.map((p) => ({
        value: p.name,
        label: p.name,
        description: p.running ? `PID ${p.pid}` : "stopped",
      }));
    },
    async handler(args, ctx) {
      const name = args.trim();
      const processes = listProcesses(ctx.cwd);
      
      if (!name) {
        const running = processes.filter((p) => p.running);
        if (running.length === 0) {
          ctx.ui.notify("No background processes running", "info");
          return;
        }
        if (running.length === 1) {
          const logs = readFullLogs(ctx.cwd, running[0].name);
          await ctx.ui.editor(`Logs: ${running[0].name}`, logs);
          return;
        }
        ctx.ui.notify("Usage: /logs <process-name>", "info");
        return;
      }

      const proc = processes.find((p) => p.name === name);
      if (!proc) {
        ctx.ui.notify(`Process "${name}" not found`, "error");
        return;
      }

      try {
        const logs = readFullLogs(ctx.cwd, name);
        await ctx.ui.editor(`Logs: ${name}`, logs);
      } catch (err) {
        ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
      }
    },
  });

  pi.registerTool({
    name: "background-start",
    label: "Start Background",
    description:
      "Start a long-running background process (dev server, watcher, database, etc.) that runs until stopped. Use for any command that would hang waiting for Ctrl+C. Do NOT use for builds, tests, scripts, or one-off commands — use bash for those.",
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
        const info = startProcess(ctx.cwd, params.name, params.command, params.cwd);
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
        stopProcess(ctx.cwd, params.name);
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

    async execute(_toolCallId, _params, _onUpdate, ctx) {
      const processes = listProcesses(ctx.cwd);

      if (processes.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No background processes" }],
          details: { processes: [] as ProcessInfo[] },
        };
      }

      const lines = processes.map((p) => {
        const displayName = getDisplayName(p);
        const status = p.running ? `✓ Running (PID ${p.pid})` : "✗ Stopped";
        return `${displayName}: ${status}`;
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
        const displayName = getDisplayName(p);
        return `${icon} ${theme.fg("text", displayName)} ${status}`;
      });

      return new Text(lines.join("\n"), 0, 0);
    },
  });

  pi.registerTool({
    name: "background-logs",
    label: "Background Logs",
    description:
      "Read logs from a background process. Use to check output, errors, or status from a running dev server or watcher. Always check logs after starting a process to verify it started correctly.",
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

    async execute(_toolCallId, params, _onUpdate, ctx) {
      try {
        const logs = readLogs(ctx.cwd, params.name, params.lines ?? 50);
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
