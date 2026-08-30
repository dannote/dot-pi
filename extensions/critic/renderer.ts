import type { ImageContent, TextContent } from '@earendil-works/pi-ai'
import { DynamicBorder, getMarkdownTheme } from '@earendil-works/pi-coding-agent'
import type { Theme } from '@earendil-works/pi-coding-agent'
import { Container, Markdown, Spacer } from '@earendil-works/pi-tui'

import { renderLines } from '../shared/render'
import type { CriticDetails } from './types'

export function renderCriticReview(
  message: { content: string | Array<TextContent | ImageContent>; details?: CriticDetails },
  expanded: boolean,
  theme: Theme
): Container {
  const details = message.details
  const result = details?.result

  const container = new Container()

  const hasError = !!result?.error
  const status = result?.status || (result?.approved ? 'APPROVED' : 'NEEDS_WORK')

  let borderColor: 'error' | 'success' | 'warning'
  let icon: string

  if (hasError) {
    borderColor = 'error'
    icon = '✗'
  } else if (status === 'APPROVED') {
    borderColor = 'success'
    icon = '✓'
  } else if (status === 'BLOCKED') {
    borderColor = 'error'
    icon = '⛔'
  } else {
    borderColor = 'warning'
    icon = '⚠'
  }

  container.addChild(new DynamicBorder((s: string) => theme.fg(borderColor, s)))

  let header = `${theme.fg(borderColor, icon)} ${theme.fg(borderColor, theme.bold('Critic Review'))}`
  if (result?.model) {
    header += ` ${theme.fg('muted', `(${result.model})`)}`
  }
  if (result?.timedOut) {
    header += ` ${theme.fg('error', '[TIMEOUT]')}`
  }
  container.addChild(renderLines([header]))

  if (hasError) {
    container.addChild(renderLines([theme.fg('error', `Error: ${result.error}`)]))
  }

  const contentText = criticContentText(message.content)
  if (contentText && !contentText.startsWith('(')) {
    container.addChild(new Markdown(contentText, 1, 0, getMarkdownTheme()))
  }

  const statsParts = criticStats(result)
  if (statsParts.length > 0) {
    container.addChild(renderLines([theme.fg('dim', statsParts.join(' · '))]))
  }

  if (expanded && details?.context) {
    container.addChild(new Spacer(1))
    container.addChild(renderLines([theme.fg('muted', '─── Context ───')]))
    container.addChild(renderLines([theme.fg('dim', details.context)]))
  }

  container.addChild(new DynamicBorder((s: string) => theme.fg(borderColor, s)))

  return container
}

function criticContentText(content: string | Array<TextContent | ImageContent>): string {
  if (typeof content === 'string') return content
  return content
    .filter((part): part is TextContent => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

function criticStats(result: CriticDetails['result'] | undefined): string[] {
  const statsParts: string[] = []
  if (result?.usage) {
    statsParts.push(
      `↑${result.usage.input} ↓${result.usage.output} $${result.usage.cost.toFixed(4)}`
    )
  }
  if (result?.durationMs) {
    statsParts.push(`${(result.durationMs / 1000).toFixed(1)}s`)
  }
  return statsParts
}
