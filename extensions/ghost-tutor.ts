import type { Message } from '@earendil-works/pi-ai'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { Box, Text } from '@earendil-works/pi-tui'
import { registerDisplayOnlyMessage } from './shared/display-message'

export const GHOST_TUTOR_MESSAGE_TYPE = 'ghost-tutor'
export const GHOST_TUTOR_WIDGET_KEY = 'ghost-tutor'

export interface GhostTutorDetails {
  timestamp: number
}

let pendingGhostMessage: string | undefined

type TextPart = { type?: string; text?: string }
type ToolCallPart = { type?: string; name?: string; arguments?: Record<string, unknown> }
type BranchEntry = {
  type?: string
  message?: {
    role?: string
    content?: unknown
    stopReason?: string
  }
  customType?: string
}

export function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const block = part as TextPart
      return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractToolNames(content: unknown): string[] {
  if (!Array.isArray(content)) return []

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const block = part as ToolCallPart
      return block.type === 'toolCall' && typeof block.name === 'string' ? block.name : ''
    })
    .filter(Boolean)
}

export function buildGhostConversation(entries: BranchEntry[], maxMessages = 8): Message[] {
  const messages: Message[] = []

  for (const entry of entries.slice().reverse()) {
    if (messages.length >= maxMessages) break
    if (entry.type !== 'message' || !entry.message?.role) continue

    const role = entry.message.role
    if (role !== 'user' && role !== 'assistant') continue

    const text = extractText(entry.message.content).trim()
    const toolNames = role === 'assistant' ? extractToolNames(entry.message.content) : []
    const toolText = toolNames.length ? `\n[Tools called: ${toolNames.join(', ')}]` : ''
    const content = `${text}${toolText}`.trim()
    if (!content) continue

    messages.push({
      role,
      content: [{ type: 'text', text: content.slice(0, 4000) }],
      timestamp: Date.now()
    } as Message)
  }

  return messages.reverse()
}

export function buildGhostTutorSystemPrompt(): string {
  return `You are ghost-tutor: a quiet Dan-style workflow nudge inside Pi.

The agent just stopped and is waiting for user input.
Decide whether a ghost nudge is useful. This decision is your job: use semantic judgment from the conversation, not keyword matching.

If no nudge is useful, return exactly: NO_NUDGE
If useful, write exactly one short muted comment, max 22 words. Start with "Dan:".
No markdown. No numbered list. No tutorial. No commands. No implementation.

Good times to nudge:
- the session needs a reset/control move, not a TODO dump
- the user asked for discussion/options/tradeoffs and the shape is still unclear
- the agent made a verification claim that needs real evidence
- the agent pushed work back to the user that the agent should do
- scope drift, wrong audience, pseudo-work, excessive text, or silent product/API choices appear
- the user's correction/anger signals the agent optimized the wrong thing

Dan-style cues:
- next big / exactly 7 next steps = reset/control surface, not a TODO dump
- discuss = decision shape is unclear; compare options/tradeoffs/evidence before acting
- go ahead = bounded pending work, verify, ask only if blocked
- angry correction = precise steering signal; identify what was optimized wrongly
- prefer real evidence: docs, ecosystem examples, runtime/TUI/CI proof
- reject pseudo-work, excessive text, wrong audience, and agent silently choosing product/API shape`
}

async function streamGhostTutor(
  ctx: ExtensionContext,
  onText: (text: string) => void
): Promise<string | undefined> {
  if (!ctx.model || !ctx.modelRegistry.hasConfiguredAuth(ctx.model)) return undefined

  const messages = buildGhostConversation(ctx.sessionManager.getBranch() as BranchEntry[])
  if (messages.length === 0) return undefined

  const response = await ctx.modelRegistry.complete(
    ctx.model,
    {
      systemPrompt: buildGhostTutorSystemPrompt(),
      messages
    },
    { signal: ctx.signal }
  )

  const result = response.content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim()

  onText(result)
  if (!result || result === 'NO_NUDGE') return undefined
  return result
}

function setGhostWidget(ctx: ExtensionContext, text: string | undefined) {
  if (ctx.mode !== 'tui') return
  ctx.ui.setWidget(GHOST_TUTOR_WIDGET_KEY, text ? [`\x1b[2m${text}\x1b[22m`] : undefined, {
    placement: 'aboveEditor'
  })
}

export default function ghostTutor(pi: ExtensionAPI) {
  pi.registerFlag('ghost-tutor', {
    description: 'Show sparse Dan-style workflow nudges after agent turns',
    type: 'boolean',
    default: false
  })

  const sendGhostMessage = registerDisplayOnlyMessage<GhostTutorDetails>(
    pi,
    GHOST_TUTOR_MESSAGE_TYPE,
    (message, _options, theme) => {
      const content = extractText(message.content).trim()
      const box = new Box(1, 0, (text) => theme.bg('customMessageBg', text))
      box.addChild(new Text(theme.fg('dim', content), 0, 0))
      return box
    }
  )

  pi.on('input', () => {
    if (!pendingGhostMessage) return

    const text = pendingGhostMessage
    pendingGhostMessage = undefined
    sendGhostMessage(text, { timestamp: Date.now() })
  })

  pi.on('agent_start', (_event, ctx) => {
    setGhostWidget(ctx, undefined)
  })

  pi.on('agent_settled', async (_event, ctx) => {
    if (pi.getFlag('ghost-tutor') !== true) return
    if (ctx.hasPendingMessages()) return

    setGhostWidget(ctx, 'Dan: thinking…')

    try {
      const text = await streamGhostTutor(ctx, (partial) => {
        if (partial !== 'NO_NUDGE') setGhostWidget(ctx, partial)
      })

      setGhostWidget(ctx, undefined)
      if (!text) return

      pendingGhostMessage = text
    } catch {
      setGhostWidget(ctx, undefined)
    }
  })
}
