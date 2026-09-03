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
import { ActionEffect, VerificationStatus } from '@trycua/cua-driver'
import type { ComputerResult } from './driver'

export interface ComputerElement {
  ref: string
  window: string
  token: string
  role?: string
  label?: string
}

export interface ComputerWindow {
  ref: string
  pid: number
  windowId: number
}

export interface ComputerDetails {
  operation: string
  error?: boolean
  degraded?: boolean
  errorCode?: string
  structuredJson?: string
  action?: unknown
  verification?: unknown
  rawJson?: string
  items?: Array<Record<string, unknown>>
  windows?: ComputerWindow[]
  elements?: ComputerElement[]
}

export function result(
  operation: string,
  value: ComputerResult,
  windows?: ComputerWindow[],
  elements?: ComputerElement[]
) {
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
      action: value.action,
      verification: value.verification,
      rawJson: value.rawJson,
      items,
      windows,
      elements
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
  if (value.kind === 'window') return String(value.window ?? 'window')
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
  if (typeof args.element === 'string') segments.push({ text: args.element, color: 'accent' })
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

function actionStatus(details: ComputerDetails): string | undefined {
  if (details.error) return undefined
  const action = details.action as { effect?: ActionEffect } | undefined
  const verification = details.verification as { status?: VerificationStatus } | undefined
  const parts: string[] = []
  if (action?.effect !== undefined) {
    const effects: Record<number, string> = {
      [ActionEffect.Confirmed]: 'confirmed',
      [ActionEffect.Partial]: 'partial',
      [ActionEffect.Unverifiable]: 'unverified',
      [ActionEffect.SuspectedNoop]: 'suspected no-op',
      [ActionEffect.Refused]: 'refused'
    }
    parts.push(effects[action.effect] ?? 'attempted')
  }
  if (verification?.status !== undefined) {
    const statuses: Record<number, string> = {
      [VerificationStatus.Satisfied]: 'verified',
      [VerificationStatus.Unsatisfied]: 'not verified',
      [VerificationStatus.Unknown]: 'verification unknown'
    }
    parts.push(statuses[verification.status] ?? 'verification unknown')
  }
  if (details.degraded) parts.push('degraded')
  return parts.length > 0 ? parts.join(' · ') : undefined
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
        const window = !isApp
          ? details.windows?.find((candidate) => candidate.windowId === item.window_id)
          : undefined
        const metadata = [
          window?.ref,
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
  if (details?.operation === 'observe' && details.elements?.length) {
    return renderEntryList(details.elements, theme, {
      expanded: _options.expanded,
      compactLimit: 12,
      renderEntry: (element) => ({
        header: title(`${element.ref} ${element.role ?? 'element'}`, theme),
        body: element.label ? [primary(element.label, theme)] : undefined
      }),
      hiddenLines: (hidden) => (hidden > 0 ? [meta(`… ${hidden} more elements`, theme)] : [])
    })
  }
  const text = resultValue.content.find((part) => part.type === 'text')?.text ?? ''
  const status = details ? actionStatus(details) : undefined
  return renderLines([
    ...(status ? [meta(status, theme)] : []),
    ...(text ? [primary(text, theme)] : [])
  ])
}
