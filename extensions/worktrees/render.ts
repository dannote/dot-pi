import type {
  AgentToolResult,
  Theme,
  ToolRenderResultOptions
} from '@earendil-works/pi-coding-agent'
import {
  meta,
  primary,
  renderEntryList,
  renderErrorOrPartial,
  renderLines,
  renderToolCall,
  title
} from '../shared/render'
import type { WorktreeEntry } from './git'

export interface WorktreeResultDetails {
  error?: boolean
  action: 'create' | 'list' | 'remove' | 'status'
  worktrees: WorktreeEntry[]
  status?: string
  diff?: string
}

export function renderCall(action: string, params: unknown, theme: Theme) {
  const args = (params ?? {}) as Record<string, unknown>
  return renderToolCall(theme, `worktree ${action}`, {
    segments: [{ text: typeof args.name === 'string' ? args.name : undefined }],
    tags: [args.force === true ? 'force' : undefined],
    suffix: typeof args.baseBranch === 'string' ? `from ${args.baseBranch}` : undefined
  })
}

export function renderResult(
  result: AgentToolResult<unknown>,
  options: ToolRenderResultOptions,
  theme: Theme
) {
  const details = result.details as WorktreeResultDetails | undefined
  const guarded = renderErrorOrPartial(result, details, { isPartial: options.isPartial }, theme)
  if (guarded) return guarded
  if (!details?.worktrees.length) return renderLines([meta('No worktrees found.', theme)])
  if (details.action === 'status') {
    const worktree = details.worktrees[0]
    return renderLines([
      title(worktree?.branch ?? 'Worktree', theme),
      meta(worktree?.path ?? '', theme),
      '',
      details.status ? primary(details.status, theme) : meta('Clean', theme),
      ...(details.diff ? ['', primary(details.diff, theme)] : [])
    ])
  }
  return renderEntryList(details.worktrees, theme, {
    expanded: options.expanded,
    compactLimit: 5,
    renderEntry: (worktree) => ({
      header: title(`${worktree.branch}${worktree.isMain ? ' (main)' : ''}`, theme),
      metadata: meta(worktree.path, theme),
      body: worktree.head ? [meta(worktree.head.slice(0, 8), theme)] : undefined
    }),
    hiddenLines: (hidden) => (hidden > 0 ? [meta(`… ${hidden} more worktrees`, theme)] : [])
  })
}
