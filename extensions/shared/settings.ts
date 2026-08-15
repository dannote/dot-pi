import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { CONFIG_DIR_NAME } from '@earendil-works/pi-coding-agent'

import { parseJsoncObject } from './json'

export function agentSettingsPath(): string {
  return process.env.PI_CODING_AGENT_DIR
    ? join(process.env.PI_CODING_AGENT_DIR, 'settings.json')
    : join(homedir(), '.pi', 'agent', 'settings.json')
}

export function projectSettingsPath(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, 'settings.json')
}

export function readSettingsFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  return parseJsoncObject(readFileSync(path, 'utf8')) ?? {}
}

export function readLayeredSettings(
  cwd: string,
  options: { projectTrusted: boolean }
): Record<string, unknown>[] {
  const settings = [readSettingsFile(agentSettingsPath())]
  if (options.projectTrusted) settings.push(readSettingsFile(projectSettingsPath(cwd)))
  return settings
}

export function deepMerge<T extends Record<string, unknown>>(base: T, override: unknown): T {
  if (!isMergeableRecord(override)) return base
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const previous = out[key]
    out[key] =
      isMergeableRecord(previous) && isMergeableRecord(value) ? deepMerge(previous, value) : value
  }
  return out as T
}

function isMergeableRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
