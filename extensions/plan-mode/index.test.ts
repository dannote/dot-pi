import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { describe, expect, test, vi } from 'vitest'

import planMode from './index'

type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void>
type EventHandler = (event: never, ctx: ExtensionContext) => Promise<void>

function setupPlanMode(activeTools: string[]) {
  const commands = new Map<string, CommandHandler>()
  const events = new Map<string, EventHandler>()
  let tools = [...activeTools]

  const pi = {
    registerFlag: () => undefined,
    registerShortcut: () => undefined,
    registerCommand: (name: string, command: { handler: CommandHandler }) => {
      commands.set(name, command.handler)
    },
    on: (name: string, handler: EventHandler) => events.set(name, handler),
    getActiveTools: () => [...tools],
    setActiveTools: (names: string[]) => {
      tools = [...names]
    },
    appendEntry: () => undefined
  } as unknown as ExtensionAPI

  planMode(pi)
  return { commands, events, getActiveTools: () => tools }
}

function commandContext() {
  return {
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      theme: {
        fg: (_color: string, text: string) => text,
        strikethrough: (text: string) => text
      }
    }
  } as unknown as ExtensionContext
}

describe('plan mode', () => {
  test('preserves extension tools and restores the exact previous tool set', async () => {
    const initial = ['read', 'bash', 'edit', 'write', 'choose_from_options', 'lsp', 'websearch']
    const harness = setupPlanMode(initial)
    const toggle = harness.commands.get('plan')
    if (!toggle) throw new Error('plan command not registered')

    await toggle('', commandContext())
    expect(harness.getActiveTools()).toEqual([
      'read',
      'bash',
      'choose_from_options',
      'lsp',
      'websearch',
      'grep',
      'find',
      'ls'
    ])

    await toggle('', commandContext())
    expect(harness.getActiveTools()).toEqual(initial)
  })
})
