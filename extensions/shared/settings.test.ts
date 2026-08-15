import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { deepMerge, projectSettingsPath, readLayeredSettings, readSettingsFile } from './settings'

describe('settings helpers', () => {
  test('builds project settings path', () => {
    expect(projectSettingsPath('/repo')).toBe('/repo/.pi/settings.json')
  })

  test('reads JSONC settings files safely', () => {
    const dir = join(tmpdir(), `dot-pi-settings-${crypto.randomUUID()}`)
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'settings.json')
    writeFileSync(file, '{ // comment\n "enabled": true }')

    expect(readSettingsFile(file)).toEqual({ enabled: true })
    expect(readSettingsFile(join(dir, 'missing.json'))).toEqual({})
  })

  test('reads project settings only for trusted projects', () => {
    const dir = join(tmpdir(), `dot-pi-layered-settings-${crypto.randomUUID()}`)
    mkdirSync(join(dir, '.pi'), { recursive: true })
    writeFileSync(join(dir, '.pi', 'settings.json'), '{ "project": true }')

    expect(readLayeredSettings(dir, { projectTrusted: false })).toHaveLength(1)
    expect(readLayeredSettings(dir, { projectTrusted: true }).at(-1)).toEqual({ project: true })
  })

  test('deep merges nested records', () => {
    const base: Record<string, unknown> = { a: { b: 1 }, keep: true }
    expect(deepMerge(base, { a: { c: 2 } })).toEqual({
      a: { b: 1, c: 2 },
      keep: true
    })
  })
})
