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
  title,
  toolError
} from '../shared/render'
import type { ComputerResult } from './driver'

export interface ComputerDetails {
  operation: string
  error?: boolean
  degraded?: boolean
  errorCode?: string
  structuredJson?: string
  items?: Array<Record<string, unknown>>
}

export function result(operation: string, value: ComputerResult) {
  const text = value.text || `${operation} completed`
  let items: Array<Record<string, unknown>> | undefined
  if (value.structuredJson) {
    try {
      const parsed = JSON.parse(value.structuredJson) as Record<string, unknown>
      const candidate = parsed.apps ?? parsed.windows
      if (Array.isArray(candidate))
        items = candidate.filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === 'object')
        )
    } catch {
      // Keep malformed or future structured output available as raw details only.
    }
  }
  return {
    content: [
      { type: 'text' as const, text },
      ...value.images.map((image) => ({
        type: 'image' as const,
        data: image.dataBase64,
        mimeType: image.mimeType
      }))
    ],
    details: {
      operation,
      error: value.isError,
      degraded: value.degraded,
      errorCode: value.errorCode,
      structuredJson: value.structuredJson,
      items
    } satisfies ComputerDetails,
    ...(value.isError ? { isError: true } : {})
  }
}

export function failure(operation: string, error: unknown) {
  return toolError(error instanceof Error ? error.message : String(error), {
    operation,
    error: true
  } satisfies ComputerDetails)
}

function displayTarget(target: unknown): string | undefined {
  if (!target || typeof target !== 'object') return undefined
  const value = target as Record<string, unknown>
  if (value.kind === 'desktop')
    return `desktop${value.displayId && value.displayId !== 'primary' ? `:${value.displayId}` : ''}`
  if (value.kind === 'window') return `window:${value.pid}/${value.windowId}`
  return undefined
}

function quoteText(value: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim()
  const truncated = compact.length > 48 ? `${compact.slice(0, 47)}…` : compact
  return JSON.stringify(truncated)
}

export function renderCall(label: string, params: unknown, theme: Theme) {
  const args = (params ?? {}) as Record<string, unknown>
  const segments: Array<{ text?: string; color?: 'accent' | 'muted' | 'dim' | 'success' }> = []
  if (typeof args.text === 'string') segments.push({ text: quoteText(args.text) })
  if (typeof args.x === 'number' && typeof args.y === 'number') {
    segments.push({ text: `${args.x},${args.y}`, color: 'accent' })
  }
  if (typeof args.key === 'string') {
    const modifiers = Array.isArray(args.modifiers)
      ? args.modifiers.filter((item): item is string => typeof item === 'string')
      : []
    segments.push({ text: [...modifiers, args.key].join('+'), color: 'accent' })
  }
  const targetText = displayTarget(args.target)
  const tags = [
    targetText,
    typeof args.count === 'number' && args.count > 1 ? `${args.count} clicks` : undefined,
    typeof args.direction === 'string'
      ? `${args.direction}${args.by === 'page' ? ' page' : ''}${typeof args.amount === 'number' ? ` ${args.amount}` : ''}`
      : undefined,
    typeof args.session === 'string' && args.session ? `session:${args.session}` : undefined
  ]
  return renderToolCall(theme, label, { segments, tags })
}

export function renderResult(
  resultValue: AgentToolResult<unknown>,
  _options: ToolRenderResultOptions,
  theme: Theme
) {
  const details = resultValue.details as ComputerDetails | undefined
  const guarded = renderErrorOrPartial(resultValue, details, {}, theme)
  if (guarded) return guarded
  if (details?.items && (details.operation === 'apps' || details.operation === 'windows')) {
    const items = details.items
    return renderEntryList(items, theme, {
      expanded: _options.expanded,
      compactLimit: 5,
      renderEntry: (item) => {
        const isApp = details.operation === 'apps'
        const name = String(isApp ? (item.name ?? 'Application') : (item.app_name ?? 'Window'))
        const subtitle = isApp ? undefined : typeof item.title === 'string' ? item.title : undefined
        const metadata = [
          typeof item.pid === 'number' ? `pid ${item.pid}` : undefined,
          !isApp && typeof item.window_id === 'number' ? `window ${item.window_id}` : undefined,
          item.active === true ? 'active' : undefined,
          item.running === false ? 'not running' : undefined,
          item.on_current_space === false ? 'another space' : undefined
        ]
          .filter(Boolean)
          .join(' · ')
        return {
          header: title(name, theme),
          metadata: metadata ? meta(metadata, theme) : undefined,
          body: subtitle ? [primary(subtitle, theme)] : undefined
        }
      },
      hiddenLines: (hidden) => (hidden > 0 ? [meta(`… ${hidden} more`, theme)] : [])
    })
  }
  const text = resultValue.content.find((part) => part.type === 'text')?.text ?? ''
  return renderLines([primary(text, theme)])
}
