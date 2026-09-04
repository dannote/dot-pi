import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { toolError, toolText } from '../shared/render'
import { createOperations } from './operations'
import { renderCall, renderResult, type WorktreeResultDetails } from './render'
import { createSchema, listSchema, removeSchema, statusSchema } from './schemas'
import type { WorktreeEntry } from './git'

function ok(
  action: WorktreeResultDetails['action'],
  text: string,
  worktrees: WorktreeEntry[],
  extra: Partial<WorktreeResultDetails> = {}
) {
  return toolText(text, { action, worktrees, ...extra } satisfies WorktreeResultDetails)
}

function failure(action: WorktreeResultDetails['action'], error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return toolError(message, { action, worktrees: [], error: true } satisfies WorktreeResultDetails)
}

function registerCreate(pi: ExtensionAPI, operations: ReturnType<typeof createOperations>) {
  pi.registerTool({
    name: 'worktree_create',
    label: 'Create Worktree',
    description: 'Create an isolated git worktree. Does not edit .gitignore or run project setup.',
    parameters: createSchema,
    async execute(_id, params, signal, _update, ctx) {
      try {
        const worktree = await operations.create(ctx.cwd, params.name, params.baseBranch, signal)
        return ok('create', `Created ${worktree.path}`, [worktree])
      } catch (error) {
        return failure('create', error)
      }
    },
    renderCall: (params, theme) => renderCall('create', params, theme),
    renderResult
  })
}

export default function worktrees(pi: ExtensionAPI) {
  const operations = createOperations(pi)
  registerCreate(pi, operations)
  pi.registerTool({
    name: 'worktree_list',
    label: 'List Worktrees',
    description: 'List Git worktrees from the repository.',
    parameters: listSchema,
    async execute(_id, _params, signal, _update, ctx) {
      try {
        const list = await operations.list(ctx.cwd, signal)
        return ok('list', `${list.length} worktrees`, list)
      } catch (error) {
        return failure('list', error)
      }
    },
    renderCall: (params, theme) => renderCall('list', params, theme),
    renderResult
  })
  pi.registerTool({
    name: 'worktree_remove',
    label: 'Remove Worktree',
    description: 'Remove a worktree while preserving its branch. Dirty worktrees require force.',
    parameters: removeSchema,
    async execute(_id, params, signal, _update, ctx) {
      try {
        const worktree = await operations.remove(ctx.cwd, params.name, params.force, signal)
        return ok('remove', `Removed ${worktree.path}`, [worktree])
      } catch (error) {
        return failure('remove', error)
      }
    },
    renderCall: (params, theme) => renderCall('remove', params, theme),
    renderResult
  })
  pi.registerTool({
    name: 'worktree_status',
    label: 'Worktree Status',
    description: 'Show status and diff summary for a worktree.',
    parameters: statusSchema,
    async execute(_id, params, signal, _update, ctx) {
      try {
        const value = await operations.status(ctx.cwd, params.name, signal)
        return ok('status', value.status || 'Clean', [value.worktree], value)
      } catch (error) {
        return failure('status', error)
      }
    },
    renderCall: (params, theme) => renderCall('status', params, theme),
    renderResult
  })

  pi.registerCommand('worktrees', {
    description: 'List all git worktrees',
    async handler(_args, ctx) {
      try {
        const list = await operations.list(ctx.cwd, ctx.signal)
        ctx.ui.notify(
          list.map((item) => `${item.branch}: ${item.path}`).join('\n') || 'No worktrees found',
          'info'
        )
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), 'error')
      }
    }
  })
}
