import {
  ActionTarget,
  CuaDriver,
  ScrollBy,
  ScrollDirection,
  type CuaDriverLike,
  type ScrollInput,
  type ToolResult
} from '@trycua/cua-driver'
import type { ComputerParams, ComputerTarget } from './schemas'

export interface ComputerDriverFactory {
  create(): CuaDriverLike
}
export interface ResolvedWindow {
  pid: number
  windowId: number
}
export type WindowResolver = (ref: string) => ResolvedWindow
export function defaultFactory(): ComputerDriverFactory {
  return { create: () => CuaDriver.create(undefined) }
}
export function session(params: ComputerParams): string | undefined {
  return typeof params.session === 'string' ? params.session : undefined
}

export function target(value: unknown): ComputerTarget | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  if (input.kind === 'desktop') {
    if (input.displayId !== undefined && typeof input.displayId !== 'string')
      throw new Error('target.displayId must be a string')
    return { kind: 'desktop', displayId: input.displayId ?? 'primary' }
  }
  if (input.kind === 'window' && typeof input.window === 'string')
    return { kind: 'window', window: input.window }
  throw new Error('target.kind must be desktop or window')
}

export function sdkTarget(value: unknown, resolveWindow?: WindowResolver) {
  const input = target(value)
  if (!input) return undefined
  if (input.kind === 'desktop') return new ActionTarget.Desktop({ displayId: input.displayId })
  if (!resolveWindow) throw new Error('window handles must be resolved by the computer extension')
  const window = resolveWindow(input.window)
  return new ActionTarget.Window({ pid: window.pid, windowId: BigInt(window.windowId) })
}

export function direction(value: unknown): ScrollDirection {
  const values: Record<string, ScrollDirection> = {
    up: ScrollDirection.Up,
    down: ScrollDirection.Down,
    left: ScrollDirection.Left,
    right: ScrollDirection.Right
  }
  const result = values[value as string]
  if (result === undefined) throw new Error(`Unsupported scroll direction: ${String(value)}`)
  return result
}
export function by(value: unknown): ScrollBy {
  return value === 'page' ? ScrollBy.Page : ScrollBy.Line
}
export function clickInput(params: ComputerParams, resolveWindow?: WindowResolver) {
  return {
    x: params.x as number,
    y: params.y as number,
    count: params.count as number | undefined,
    target: sdkTarget(params.target, resolveWindow),
    session: session(params)
  }
}
export function typeInput(params: ComputerParams, resolveWindow?: WindowResolver) {
  return {
    text: params.text as string,
    target: sdkTarget(params.target, resolveWindow),
    session: session(params)
  }
}
export function keyInput(params: ComputerParams, resolveWindow?: WindowResolver) {
  return {
    key: params.key as string,
    modifiers: params.modifiers as string[] | undefined,
    target: sdkTarget(params.target, resolveWindow),
    session: session(params)
  }
}
export function scrollInput(params: ComputerParams, resolveWindow?: WindowResolver): ScrollInput {
  return {
    x: params.x as number,
    y: params.y as number,
    direction: direction(params.direction),
    by: by(params.by),
    amount: params.amount === undefined ? undefined : BigInt(params.amount as number),
    target: sdkTarget(params.target, resolveWindow),
    session: session(params)
  }
}
export type ComputerResult = Pick<
  ToolResult,
  | 'text'
  | 'images'
  | 'isError'
  | 'degraded'
  | 'errorCode'
  | 'structuredJson'
  | 'action'
  | 'verification'
  | 'rawJson'
>
