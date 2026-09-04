import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { TSchema } from 'typebox'
import type { CuaDriverLike, ToolResult } from '@trycua/cua-driver'
import { errorMessage } from '../shared/errors'
import {
  result,
  failure,
  renderCall,
  renderResult,
  type ComputerElement,
  type ComputerWindow
} from './render'
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
import { createState, queueKey, resetState, updateElements, updateWindows } from './state'

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
  execute(
    driver: CuaDriverLike,
    params: ComputerParams,
    windows: Map<string, ComputerWindow>,
    elements: Map<string, ComputerElement>,
    signal?: AbortSignal
  ): Promise<ToolResult>
}

function resolveWindow(
  params: ComputerParams,
  windows: Map<string, ComputerWindow>
): ComputerWindow {
  const value = params.target as { kind?: string; window?: string } | undefined
  if (value?.kind !== 'window' || !value.window)
    throw new Error('an exact window handle is required')
  const window = windows.get(value.window)
  if (!window) throw new Error(`window ${value.window} is unavailable; call computer windows again`)
  return window
}

function resolver(windows: Map<string, ComputerWindow>) {
  return (ref: string): ComputerWindow => {
    const window = windows.get(ref)
    if (!window) throw new Error(`window ${ref} is unavailable; call computer windows again`)
    return window
  }
}

function windowTarget(params: ComputerParams, windows: Map<string, ComputerWindow>) {
  const window = resolveWindow(params, windows)
  return { pid: window.pid, window_id: window.windowId, session: session(params) }
}

function validateClickParams(params: ComputerParams): void {
  const hasElement = typeof params.element === 'string' && params.element.length > 0
  const hasX = typeof params.x === 'number'
  const hasY = typeof params.y === 'number'
  if (hasElement) return
  if (!hasX || !hasY) {
    throw new Error('computer click requires element, or both x and y')
  }
}
function semanticElementArgs(
  params: ComputerParams,
  elements: Map<string, ComputerElement>,
  windows: Map<string, ComputerWindow>
) {
  const element = elements.get(params.element as string)
  if (!element)
    throw new Error(`element ${String(params.element)} is unavailable; observe the window again`)
  const window = windows.get(element.window)
  if (!window)
    throw new Error(`window ${element.window} is unavailable; call computer windows again`)
  return { element, window }
}

function semanticClickArgs(
  params: ComputerParams,
  elements: Map<string, ComputerElement>,
  windows: Map<string, ComputerWindow>
) {
  const { element, window } = semanticElementArgs(params, elements, windows)
  return {
    pid: window.pid,
    window_id: window.windowId,
    element_token: element.token,
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
    execute: (driver, _p, _windows, _elements, signal) =>
      driver.callTool('list_apps', '{}', { signal: signal! })
  },
  {
    name: 'computer_windows',
    label: 'computer windows',
    description: 'List desktop windows and their process ownership.',
    parameters: schemas.windows,
    operation: 'windows',
    execute: (driver, p, _windows, _elements, signal) =>
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
    execute: (driver, p, windows, _elements, signal) =>
      observeTarget(p) === 'window'
        ? driver.callTool('get_window_state', JSON.stringify(windowTarget(p, windows)), {
            signal: signal!
          })
        : driver.getDesktopState({ session: session(p) }, { signal: signal! })
  },
  {
    name: 'computer_click',
    label: 'computer click',
    description:
      'Click one observed semantic element handle, or coordinates from the latest observation. Do not combine the two addressing modes.',
    parameters: schemas.click,
    operation: 'click',
    execute: (driver, p, windows, elements, signal) => {
      validateClickParams(p)
      return typeof p.element === 'string'
        ? driver.callTool('click', JSON.stringify(semanticClickArgs(p, elements, windows)), {
            signal: signal!
          })
        : driver.click(clickInput(p, resolver(windows)), { signal: signal! })
    }
  },
  {
    name: 'computer_type',
    label: 'computer type',
    description:
      'Type into the focused control of an exact observed target, then observe again to verify the effect.',
    parameters: schemas.type,
    operation: 'type',
    execute: (driver, p, windows, elements, signal) =>
      typeof p.element === 'string'
        ? (() => {
            const { element, window } = semanticElementArgs(p, elements, windows)
            return driver.callTool(
              'type_text',
              JSON.stringify({
                pid: window.pid,
                window_id: window.windowId,
                element_token: element.token,
                text: p.text,
                session: session(p)
              }),
              { signal: signal! }
            )
          })()
        : driver.typeText(typeInput(p, resolver(windows)), { signal: signal! })
  },
  {
    name: 'computer_key',
    label: 'computer key',
    description:
      'Press a key on an exact observed target, then observe again when the effect matters.',
    parameters: schemas.key,
    operation: 'key',
    execute: (driver, p, windows, elements, signal) =>
      typeof p.element === 'string'
        ? (() => {
            const { element, window } = semanticElementArgs(p, elements, windows)
            return driver.callTool(
              'press_key',
              JSON.stringify({
                pid: window.pid,
                window_id: window.windowId,
                element_token: element.token,
                key: p.key,
                modifiers: p.modifiers,
                session: session(p)
              }),
              { signal: signal! }
            )
          })()
        : driver.pressKey(keyInput(p, resolver(windows)), { signal: signal! })
  },
  {
    name: 'computer_scroll',
    label: 'computer scroll',
    description: 'Scroll coordinates from the latest observation. Prefer an exact window target.',
    parameters: schemas.scroll,
    operation: 'scroll',
    execute: (driver, p, windows, _elements, signal) =>
      driver.scroll(scrollInput(p, resolver(windows)), { signal: signal! })
  }
]

export function registerComputerTools(
  pi: ExtensionAPI,
  factory: ComputerDriverFactory = defaultFactory()
): () => Promise<void> {
  let driver: CuaDriverLike | undefined
  const state = createState()
  const queues = new Map<string, Promise<void>>()
  const schedule = async <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = queues.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    queues.set(
      key,
      previous.then(() => current)
    )
    await previous
    try {
      return await task()
    } finally {
      release()
    }
  }
  const getDriver = () => (driver ??= factory.create())
  for (const definition of definitions) {
    pi.registerTool({
      name: definition.name,
      label: definition.label,
      description: definition.description,
      parameters: definition.parameters,
      async execute(_id, params, signal) {
        try {
          const paramsValue = params as ComputerParams
          const value = await schedule(queueKey(paramsValue, state), () =>
            definition.execute(getDriver(), paramsValue, state.windows, state.elements, signal)
          )
          if (definition.operation === 'windows') updateWindows(state, value)
          if (definition.operation === 'observe') updateElements(state, value, paramsValue)
          return result(
            definition.operation,
            value,
            [...state.windows.values()],
            [...state.elements.values()]
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
    resetState(state)
    queues.clear()
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
