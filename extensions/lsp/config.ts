/**
 * LSP Configuration
 */

import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { globSync } from "glob";
import { createBiomeClient } from "./clients/biome-client";
import DEFAULTS from "./defaults.json" with { type: "json" };
import type { ServerConfig } from "./types";

export interface LspConfig {
  servers: Record<string, ServerConfig>;
  idleTimeoutMs?: number;
}

const PID_TOKEN = "$PID";

interface NormalizedConfig {
  servers: Record<string, Partial<ServerConfig>>;
  idleTimeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseConfigContent(content: string, filePath: string): unknown {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".yaml" || extension === ".yml") {
    // Simple YAML parsing for basic configs
    const lines = content.split("\n");
    const result: Record<string, unknown> = {};
    let currentKey = "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#") || !trimmed) continue;
      const match = trimmed.match(/^(\w+):\s*(.*)$/);
      if (match) {
        currentKey = match[1];
        result[currentKey] = match[2] || {};
      }
    }
    return result;
  }
  return JSON.parse(content) as unknown;
}

function normalizeConfig(value: unknown): NormalizedConfig | null {
  if (!isRecord(value)) return null;

  const idleTimeoutMs = typeof value.idleTimeoutMs === "number" ? value.idleTimeoutMs : undefined;
  const rawServers = value.servers;

  if (isRecord(rawServers)) {
    return { servers: rawServers as Record<string, Partial<ServerConfig>>, idleTimeoutMs };
  }

  const servers = Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "idleTimeoutMs"),
  ) as Record<string, Partial<ServerConfig>>;

  return { servers, idleTimeoutMs };
}

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  return items.length > 0 ? items : null;
}

function normalizeServerConfig(name: string, config: Partial<ServerConfig>): ServerConfig | null {
  const command =
    typeof config.command === "string" && config.command.length > 0 ? config.command : null;
  const fileTypes = normalizeStringArray(config.fileTypes);
  const rootMarkers = normalizeStringArray(config.rootMarkers);

  if (!command || !fileTypes || !rootMarkers) {
    return null;
  }

  const args = Array.isArray(config.args)
    ? config.args.filter((entry): entry is string => typeof entry === "string")
    : undefined;

  return {
    ...config,
    command,
    args,
    fileTypes,
    rootMarkers,
  };
}

async function readConfigFile(filePath: string): Promise<NormalizedConfig | null> {
  try {
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return null;
    }
    const content = await file.text();
    const parsed = parseConfigContent(content, filePath);
    return normalizeConfig(parsed);
  } catch {
    return null;
  }
}

function coerceServerConfigs(
  servers: Record<string, Partial<ServerConfig>>,
): Record<string, ServerConfig> {
  const result: Record<string, ServerConfig> = {};
  for (const [name, config] of Object.entries(servers)) {
    const normalized = normalizeServerConfig(name, config);
    if (normalized) {
      result[name] = normalized;
    }
  }
  return result;
}

function mergeServers(
  base: Record<string, ServerConfig>,
  overrides: Record<string, Partial<ServerConfig>>,
): Record<string, ServerConfig> {
  const merged: Record<string, ServerConfig> = { ...base };
  for (const [name, config] of Object.entries(overrides)) {
    if (merged[name]) {
      const candidate = { ...merged[name], ...config };
      const normalized = normalizeServerConfig(name, candidate);
      if (normalized) {
        merged[name] = normalized;
      }
    } else {
      const normalized = normalizeServerConfig(name, config);
      if (normalized) {
        merged[name] = normalized;
      }
    }
  }
  return merged;
}

function applyRuntimeDefaults(servers: Record<string, ServerConfig>): Record<string, ServerConfig> {
  const updated: Record<string, ServerConfig> = { ...servers };

  if (updated.biome) {
    updated.biome = { ...updated.biome, createClient: createBiomeClient };
  }

  if (updated.omnisharp?.args) {
    const args = updated.omnisharp.args.map((arg) =>
      arg === PID_TOKEN ? String(process.pid) : arg,
    );
    updated.omnisharp = { ...updated.omnisharp, args };
  }

  return updated;
}

export async function hasRootMarkers(cwd: string, markers: string[]): Promise<boolean> {
  for (const marker of markers) {
    if (marker.includes("*")) {
      try {
        const matches = globSync(join(cwd, marker));
        if (matches.length > 0) {
          return true;
        }
      } catch {
        // Ignore glob errors
      }
      continue;
    }
    const filePath = join(cwd, marker);
    if (await Bun.file(filePath).exists()) {
      return true;
    }
  }
  return false;
}

const LOCAL_BIN_PATHS: Array<{ markers: string[]; binDir: string }> = [
  {
    markers: ["package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"],
    binDir: "node_modules/.bin",
  },
  { markers: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"], binDir: ".venv/bin" },
  { markers: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"], binDir: "venv/bin" },
  { markers: ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"], binDir: ".env/bin" },
  { markers: ["Gemfile", "Gemfile.lock"], binDir: "vendor/bundle/bin" },
  { markers: ["Gemfile", "Gemfile.lock"], binDir: "bin" },
  { markers: ["go.mod", "go.sum"], binDir: "bin" },
];

export async function resolveCommand(command: string, cwd: string): Promise<string | null> {
  for (const { markers, binDir } of LOCAL_BIN_PATHS) {
    if (await hasRootMarkers(cwd, markers)) {
      const localPath = join(cwd, binDir, command);
      if (await Bun.file(localPath).exists()) {
        return localPath;
      }
    }
  }

  return Bun.which(command);
}

function getConfigPaths(cwd: string): string[] {
  const filenames = ["lsp.json", ".lsp.json", "lsp.yaml", ".lsp.yaml", "lsp.yml", ".lsp.yml"];
  const paths: string[] = [];

  for (const filename of filenames) {
    paths.push(join(cwd, filename));
  }

  const projectDirs = [".pi", ".claude"];
  for (const dir of projectDirs) {
    for (const filename of filenames) {
      paths.push(join(cwd, dir, filename));
    }
  }

  const userDirs = [join(homedir(), ".pi", "agent"), join(homedir(), ".claude")];
  for (const dir of userDirs) {
    for (const filename of filenames) {
      paths.push(join(dir, filename));
    }
  }

  for (const filename of filenames) {
    paths.push(join(homedir(), filename));
  }

  return paths;
}

export async function loadConfig(cwd: string): Promise<LspConfig> {
  let mergedServers = coerceServerConfigs(DEFAULTS as Record<string, Partial<ServerConfig>>);

  const configPaths = getConfigPaths(cwd).reverse();
  let hasOverrides = false;

  let idleTimeoutMs: number | undefined;
  for (const configPath of configPaths) {
    const parsed = await readConfigFile(configPath);
    if (!parsed) continue;
    const hasServerOverrides = Object.keys(parsed.servers).length > 0;
    if (hasServerOverrides) {
      hasOverrides = true;
      mergedServers = mergeServers(mergedServers, parsed.servers);
    }
    if (parsed.idleTimeoutMs !== undefined) {
      idleTimeoutMs = parsed.idleTimeoutMs;
    }
  }

  if (!hasOverrides) {
    const detected: Record<string, ServerConfig> = {};
    const defaultsWithRuntime = applyRuntimeDefaults(mergedServers);

    for (const [name, config] of Object.entries(defaultsWithRuntime)) {
      if (!(await hasRootMarkers(cwd, config.rootMarkers))) continue;
      const resolved = await resolveCommand(config.command, cwd);
      if (!resolved) continue;
      detected[name] = { ...config, resolvedCommand: resolved };
    }

    return { servers: detected, idleTimeoutMs };
  }

  const mergedWithRuntime = applyRuntimeDefaults(mergedServers);
  const available: Record<string, ServerConfig> = {};

  for (const [name, config] of Object.entries(mergedWithRuntime)) {
    if (config.disabled) continue;
    const resolved = await resolveCommand(config.command, cwd);
    if (!resolved) continue;
    available[name] = { ...config, resolvedCommand: resolved };
  }

  return { servers: available, idleTimeoutMs };
}

export function getServersForFile(
  config: LspConfig,
  filePath: string,
): Array<[string, ServerConfig]> {
  const ext = extname(filePath).toLowerCase();
  const fileName = basename(filePath).toLowerCase();
  const matches: Array<[string, ServerConfig]> = [];

  for (const [name, serverConfig] of Object.entries(config.servers)) {
    const supportsFile = serverConfig.fileTypes.some((fileType) => {
      const normalized = fileType.toLowerCase();
      return normalized === ext || normalized === fileName;
    });

    if (supportsFile) {
      matches.push([name, serverConfig]);
    }
  }

  return matches.sort((a, b) => {
    const aIsLinter = a[1].isLinter ? 1 : 0;
    const bIsLinter = b[1].isLinter ? 1 : 0;
    return aIsLinter - bIsLinter;
  });
}

export function getServerForFile(
  config: LspConfig,
  filePath: string,
): [string, ServerConfig] | null {
  const servers = getServersForFile(config, filePath);
  return servers.length > 0 ? servers[0] : null;
}

export function hasCapability(
  config: ServerConfig,
  capability: keyof NonNullable<ServerConfig["capabilities"]>,
): boolean {
  return config.capabilities?.[capability] === true;
}
