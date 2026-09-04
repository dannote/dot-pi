import { describe, expect, test } from 'vitest'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { createOperations } from './operations'

type ExecCall = { command: string; args: string[]; options: { cwd?: string; signal?: AbortSignal } }
const main = 'worktree /repo\nHEAD abcdef\nbranch refs/heads/main\n\n'
const feature = `${main}worktree /repo/.worktrees/feature\nHEAD abcdef\nbranch refs/heads/feature\n\n`

function harness(outputs: Array<{ code: number; stdout?: string; stderr?: string }>) {
  const calls: ExecCall[] = []
  const pi = {
    exec: async (command: string, args: string[], options: ExecCall['options']) => {
      calls.push({ command, args, options })
      const output = outputs.shift() ?? { code: 0 }
      return { stdout: '', stderr: '', killed: false, ...output }
    }
  } as unknown as ExtensionAPI
  return { operations: createOperations(pi), calls }
}

describe('worktree operations', () => {
  test('requires an explicitly ignored directory without mutating files or running setup', async () => {
    const h = harness([{ code: 1 }])
    await expect(h.operations.create('/repo', 'feature')).rejects.toThrow('must be ignored')
    expect(h.calls).toEqual([
      expect.objectContaining({ command: 'git', args: ['check-ignore', '-q', '.worktrees/'] })
    ])
    expect(h.calls.some((call) => call.args.includes('install'))).toBe(false)
  })

  test('creates through git and discovers the resulting worktree', async () => {
    const signal = new AbortController().signal
    const h = harness([{ code: 0 }, { code: 0 }, { code: 0, stdout: feature }])
    await expect(h.operations.create('/repo', 'feature', 'HEAD', signal)).resolves.toMatchObject({
      branch: 'feature'
    })
    expect(h.calls[1]).toMatchObject({
      command: 'git',
      args: ['worktree', 'add', '/repo/.worktrees/feature', '-b', 'feature', 'HEAD']
    })
    expect(h.calls.every((call) => call.options.signal === signal)).toBe(true)
  })

  test('refuses dirty removal without force', async () => {
    const h = harness([
      { code: 0, stdout: feature },
      { code: 128, stderr: 'fatal: contains modified or untracked files' }
    ])
    await expect(h.operations.remove('/repo', 'feature')).rejects.toThrow('uncommitted changes')
    expect(h.calls[1]?.args).toEqual(['worktree', 'remove', '/repo/.worktrees/feature'])
  })

  test('passes force only when explicitly requested', async () => {
    const h = harness([{ code: 0, stdout: feature }, { code: 0 }])
    await expect(h.operations.remove('/repo', 'feature', true)).resolves.toMatchObject({
      branch: 'feature'
    })
    expect(h.calls[1]?.args).toEqual(['worktree', 'remove', '/repo/.worktrees/feature', '--force'])
  })
})
