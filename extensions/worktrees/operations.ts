import { existsSync } from 'node:fs'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { commandFailure, commandOutput } from '../shared/process'
import {
  isDirtyWorktreeRemovalError,
  parseWorktreePorcelain,
  validateWorktreeName,
  worktreePathFor,
  type WorktreeEntry
} from './git'

export interface Operations {
  list(cwd: string, signal?: AbortSignal): Promise<WorktreeEntry[]>
  create(
    cwd: string,
    name: string,
    baseBranch?: string,
    signal?: AbortSignal
  ): Promise<WorktreeEntry>
  remove(cwd: string, name: string, force?: boolean, signal?: AbortSignal): Promise<WorktreeEntry>
  status(
    cwd: string,
    name: string,
    signal?: AbortSignal
  ): Promise<{ worktree: WorktreeEntry; status: string; diff: string }>
}

function findWorktree(worktrees: WorktreeEntry[], name: string): WorktreeEntry | undefined {
  return worktrees.find((item) => item.branch === name || item.path.split('/').pop() === name)
}

export function createOperations(pi: ExtensionAPI): Operations {
  const list: Operations['list'] = async (cwd, signal) => {
    const result = await pi.exec('git', ['worktree', 'list', '--porcelain'], { cwd, signal })
    if (result.code !== 0) throw new Error(commandFailure(result, 'Failed to list worktrees'))
    return parseWorktreePorcelain(result.stdout)
  }

  return {
    list,
    async create(cwd, name, baseBranch, signal) {
      const nameError = validateWorktreeName(name)
      if (nameError) throw new Error(nameError)
      const path = worktreePathFor(cwd, name)
      if (existsSync(path)) throw new Error(`Worktree "${name}" already exists at ${path}`)
      const ignored = await pi.exec('git', ['check-ignore', '-q', '.worktrees'], { cwd, signal })
      if (ignored.code !== 0) {
        throw new Error(
          '.worktrees/ must be ignored before creating a worktree; add it to .gitignore explicitly'
        )
      }
      const args = ['worktree', 'add', path, '-b', name]
      if (baseBranch) args.push(baseBranch)
      const result = await pi.exec('git', args, { cwd, signal })
      if (result.code !== 0) throw new Error(commandFailure(result, 'Failed to create worktree'))
      const created = findWorktree(await list(cwd, signal), name)
      if (!created)
        throw new Error('Git created the worktree but it was not discoverable afterward')
      return created
    },
    async remove(cwd, name, force, signal) {
      const worktree = findWorktree(await list(cwd, signal), name)
      if (!worktree || worktree.isMain) throw new Error(`Worktree "${name}" not found`)
      const args = ['worktree', 'remove', worktree.path]
      if (force) args.push('--force')
      const result = await pi.exec('git', args, { cwd, signal })
      if (result.code !== 0) {
        const error = commandOutput(result)
        if (isDirtyWorktreeRemovalError(error))
          throw new Error(
            `Cannot remove "${name}": uncommitted changes; commit, stash, or use force`
          )
        throw new Error(commandFailure(result, 'Failed to remove worktree'))
      }
      return worktree
    },
    async status(cwd, name, signal) {
      const worktree = findWorktree(await list(cwd, signal), name)
      if (!worktree) throw new Error(`Worktree "${name}" not found`)
      const [status, diff] = await Promise.all([
        pi.exec('git', ['status', '--short'], { cwd: worktree.path, signal }),
        pi.exec('git', ['diff', '--stat'], { cwd: worktree.path, signal })
      ])
      if (status.code !== 0)
        throw new Error(commandFailure(status, 'Failed to read worktree status'))
      if (diff.code !== 0) throw new Error(commandFailure(diff, 'Failed to read worktree diff'))
      return { worktree, status: status.stdout.trim(), diff: diff.stdout.trim() }
    }
  }
}
