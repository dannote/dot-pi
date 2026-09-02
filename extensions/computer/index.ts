import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { TSchema } from 'typebox'
import type { CuaDriverLike, ToolResult } from '@trycua/cua-driver'
import { errorMessage } from '../shared/errors'
import { result, failure, renderCall, renderResult } from './render'
import {
  clickInput,
  defaultFactory,
  keyInput,
  scrollInput,
  session,
  typeInput,
  type ComputerDriverFactory
} from './driver'
import { schemas, type ComputerParams } from './schemas'

const COMPUTER_GUIDANCE = [
  'Use computer tools for native desktop applications, system dialogs, file pickers, and browser chrome. Use agent-browser for webpage DOM, navigation, tabs, network, console, cookies, storage, downloads, and web screenshots.',
  'Prefer direct APIs or curl when a reliable non-UI interface exists.',
  'For desktop actions: list apps/windows, observe the exact target, act with coordinates from that observation, then observe again when verification matters.',
  'Do not guess process ids, window ids, or coordinates.'
] as const
interface RegisteredComputerTool {
  name: string
  label: string
  description: string
  parameters: TSchema
  operation: string
  execute(driver: CuaDriverLike, params: ComputerParams, signal?: AbortSignal): Promise<ToolResult>
}

function windowTarget(params: ComputerParams) {
  const value = params.target as { kind?: string; pid?: number; windowId?: number } | undefined
  if (value?.kind !== 'window') throw new Error('computer observe requires a window target')
  return { pid: value.pid, window_id: value.windowId, session: session(params) }
}

function validateClickParams(params: ComputerParams): void {
  const hasToken = typeof params.elementToken === 'string' && params.elementToken.length > 0
  const hasX = typeof params.x === 'number'
  const hasY = typeof params.y === 'number'
  if (hasToken === (hasX || hasY)) {
    throw new Error('computer click requires either elementToken or x and y')
  }
  if (!hasToken && (!hasX || !hasY)) {
    throw new Error('computer click coordinates require both x and y')
  }
  const target = params.target as { kind?: string } | undefined
  if (hasToken && target?.kind !== 'window') {
    throw new Error('computer click elementToken requires a window target')
  }
}
function semanticClickArgs(params: ComputerParams) {
  const value = params.target as { pid: number; windowId: number }
  return {
    pid: value.pid,
    window_id: value.windowId,
    element_token: params.elementToken,
    count: params.count,
    session: session(params)
  }
}
function observeTarget(params: ComputerParams): 'desktop' | 'window' {
  const value = params.target as { kind?: string } | undefined
  return value?.kind === 'window' ? 'window' : 'desktop'
}

const definitions: RegisteredComputerTool[] = [
  {
    name: 'computer_apps',
    label: 'computer apps',
    description: 'List installed and running desktop applications.',
    parameters: schemas.apps,
    operation: 'apps',
    execute: (driver, _p, signal) => driver.callTool('list_apps', '{}', { signal: signal! })
  },
  {
    name: 'computer_windows',
    label: 'computer windows',
    description: 'List desktop windows and their process ownership.',
    parameters: schemas.windows,
    operation: 'windows',
    execute: (driver, p, signal) =>
      driver.callTool(
        'list_windows',
        JSON.stringify({ on_screen_only: p.onScreenOnly, pid: p.pid }),
        { signal: signal! }
      )
  },
  {
    name: 'computer_observe',
    label: 'computer observe',
    description:
      'Observe the desktop or one exact window. Use computer windows first; do not guess window identity or coordinates.',
    parameters: schemas.observe,
    operation: 'observe',
    execute: (driver, p, signal) =>
      observeTarget(p) === 'window'
        ? driver.callTool('get_window_state', JSON.stringify(windowTarget(p)), { signal: signal! })
        : driver.getDesktopState({ session: session(p) }, { signal: signal! })
  },
  {
    name: 'computer_click',
    label: 'computer click',
    description:
      'Click coordinates from the latest observation. Prefer an exact window target and observe again to verify the effect.',
    parameters: schemas.click,
    operation: 'click',
    execute: (driver, p, signal) => {
      validateClickParams(p)
      return typeof p.elementToken === 'string'
        ? driver.callTool('click', JSON.stringify(semanticClickArgs(p)), { signal: signal! })
        : driver.click(clickInput(p), { signal: signal! })
    }
  },
  {
    name: 'computer_type',
    label: 'computer type',
    description:
      'Type into the focused control of an exact observed target, then observe again to verify the effect.',
    parameters: schemas.type,
    operation: 'type',
    execute: (driver, p, signal) => driver.typeText(typeInput(p), { signal: signal! })
  },
  {
    name: 'computer_key',
    label: 'computer key',
    description:
      'Press a key on an exact observed target, then observe again when the effect matters.',
    parameters: schemas.key,
    operation: 'key',
    execute: (driver, p, signal) => driver.pressKey(keyInput(p), { signal: signal! })
  },
  {
    name: 'computer_scroll',
    label: 'computer scroll',
    description: 'Scroll coordinates from the latest observation. Prefer an exact window target.',
    parameters: schemas.scroll,
    operation: 'scroll',
    execute: (driver, p, signal) => driver.scroll(scrollInput(p), { signal: signal! })
  }
]

export function registerComputerTools(
  pi: ExtensionAPI,
  factory: ComputerDriverFactory = defaultFactory()
): () => Promise<void> {
  let driver: CuaDriverLike | undefined
  const getDriver = () => (driver ??= factory.create())
  for (const definition of definitions) {
    pi.registerTool({
      name: definition.name,
      label: definition.label,
      description: definition.description,
      parameters: definition.parameters,
      async execute(_id, params, signal) {
        try {
          return result(
            definition.operation,
            await definition.execute(getDriver(), params as ComputerParams, signal)
          )
        } catch (error) {
          return failure(definition.operation, errorMessage(error))
        }
      },
      renderCall: (params, theme) => renderCall(definition.label, params, theme),
      renderResult
    })
  }
  return async () => {
    if (driver) await driver.shutdown()
    driver = undefined
  }
}

export default function computer(pi: ExtensionAPI) {
  const shutdown = registerComputerTools(pi)
  pi.on('before_agent_start', (event) => ({
    systemPrompt: `${event.systemPrompt}\n\n${COMPUTER_GUIDANCE.join('\n')}`
  }))
  pi.on('session_shutdown', shutdown)
}
