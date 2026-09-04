import type { ToolResult } from '@trycua/cua-driver'
import type { ComputerElement, ComputerWindow } from './render'
import type { ComputerParams } from './schemas'

export interface ComputerState {
  windows: Map<string, ComputerWindow>
  elements: Map<string, ComputerElement>
  nextWindowRef: number
  nextElementRef: number
}

export function createState(): ComputerState {
  return { windows: new Map(), elements: new Map(), nextWindowRef: 1, nextElementRef: 1 }
}

export function queueKey(params: ComputerParams, state: ComputerState): string {
  const element =
    typeof params.element === 'string' ? state.elements.get(params.element) : undefined
  const target = params.target as { window?: string } | undefined
  return element?.window ?? target?.window ?? 'desktop'
}

export function updateWindows(state: ComputerState, value: ToolResult): void {
  if (!value.structuredJson) return
  try {
    const parsed = JSON.parse(value.structuredJson) as { windows?: Array<Record<string, unknown>> }
    const previous = new Map(
      [...state.windows.values()].map((window) => [`${window.pid}:${window.windowId}`, window])
    )
    for (const item of parsed.windows ?? []) {
      if (typeof item.pid !== 'number' || typeof item.window_id !== 'number') continue
      const identity = `${item.pid}:${item.window_id}`
      const window = previous.get(identity) ?? {
        ref: `@w${state.nextWindowRef++}`,
        pid: item.pid,
        windowId: item.window_id
      }
      state.windows.set(window.ref, window)
    }
  } catch {
    state.windows.clear()
  }
}

export function updateElements(
  state: ComputerState,
  value: ToolResult,
  params: ComputerParams
): void {
  if (!value.structuredJson) return
  const target = params.target as { window?: string } | undefined
  try {
    const parsed = JSON.parse(value.structuredJson) as { elements?: Array<Record<string, unknown>> }
    const retained = new Map(
      [...state.elements].filter(([, element]) => element.window !== target?.window)
    )
    for (const item of parsed.elements ?? []) {
      const role = typeof item.role === 'string' ? item.role : ''
      const label = typeof item.label === 'string' ? item.label : ''
      if (
        typeof item.element_token !== 'string' ||
        !label ||
        ['AXWindow', 'AXMenuBar', 'AXMenu'].includes(role) ||
        !target?.window
      )
        continue
      const ref = `@e${state.nextElementRef++}`
      retained.set(ref, { ref, window: target.window, token: item.element_token, role, label })
    }
    state.elements = retained
  } catch {
    state.elements.clear()
  }
}

export function resetState(state: ComputerState): void {
  state.windows.clear()
  state.elements.clear()
  state.nextWindowRef = 1
  state.nextElementRef = 1
}
