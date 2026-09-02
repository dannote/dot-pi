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
    if (input.displayId !== undefined && typeof input.displayId !== 'string') {
      throw new Error('target.displayId must be a string')
    }
    return { kind: 'desktop', displayId: input.displayId ?? 'primary' }
  }
  if (input.kind === 'window') {
    if (!Number.isInteger(input.pid) || (input.pid as number) < 1) {
      throw new Error('target.pid must be a positive integer')
    }
    if (!Number.isInteger(input.windowId) || (input.windowId as number) < 1) {
      throw new Error('target.windowId must be a positive integer')
    }
    return { kind: 'window', pid: input.pid as number, windowId: input.windowId as number }
  }
  throw new Error('target.kind must be desktop or window')
}

export function sdkTarget(value: unknown) {
  const input = target(value)
  if (!input) return undefined
  if (input.kind === 'desktop') return new ActionTarget.Desktop({ displayId: input.displayId })
  return new ActionTarget.Window({ pid: input.pid, windowId: BigInt(input.windowId) })
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

export function clickInput(params: ComputerParams) {
  return {
    x: params.x as number,
    y: params.y as number,
    count: params.count as number | undefined,
    target: sdkTarget(params.target),
    session: session(params)
  }
}

export function typeInput(params: ComputerParams) {
  return { text: params.text as string, target: sdkTarget(params.target), session: session(params) }
}

export function keyInput(params: ComputerParams) {
  return {
    key: params.key as string,
    modifiers: params.modifiers as string[] | undefined,
    target: sdkTarget(params.target),
    session: session(params)
  }
}

export function scrollInput(params: ComputerParams): ScrollInput {
  return {
    x: params.x as number,
    y: params.y as number,
    direction: direction(params.direction),
    by: by(params.by),
    amount: params.amount === undefined ? undefined : BigInt(params.amount as number),
    target: sdkTarget(params.target),
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
