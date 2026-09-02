import { describe, expect, test } from 'vitest'
import { Value } from 'typebox/value'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import {
  ActionEffect,
  VerificationStatus,
  type CuaDriverLike,
  type ToolResult
} from '@trycua/cua-driver'
import { renderComponentText, testTheme } from './shared/test-utils'
import computer, { registerComputerTools, type ComputerDriverFactory } from './computer/index'
import { sdkTarget } from './computer/driver'
import { schemas } from './computer/schemas'

type Tool = Parameters<ExtensionAPI['registerTool']>[0]

function result(text = 'ok', extra: Partial<ToolResult> = {}): ToolResult {
  return {
    text,
    images: [],
    isError: false,
    degraded: false,
    rawJson: '{}',
    ...extra
  }
}

function harness() {
  const tools: Tool[] = []
  const events = new Map<string, () => Promise<void>>()
  const pi = {
    registerTool: (tool: Tool) => tools.push(tool),
    on: (event: string, handler: () => Promise<void>) => events.set(event, handler)
  } as unknown as ExtensionAPI
  return { tools, events, pi }
}

function renderToolResult(tool: Tool, value: ToolResult, expanded = false): string {
  const content = [
    { type: 'text' as const, text: value.text },
    ...value.images.map((image) => ({
      type: 'image' as const,
      data: image.dataBase64,
      mimeType: image.mimeType
    }))
  ]
  return renderComponentText(
    tool.renderResult?.(
      {
        content,
        details: {
          operation: tool.name === 'computer_apps' ? 'apps' : 'windows',
          structuredJson: value.structuredJson,
          items: value.structuredJson
            ? ((JSON.parse(value.structuredJson).apps ??
                JSON.parse(value.structuredJson).windows) as Array<Record<string, unknown>>)
            : undefined
        }
      },
      { expanded, isPartial: false },
      testTheme,
      {} as never
    )
  )
}
function fakeDriver() {
  const calls: Array<[string, unknown]> = []
  const driver = {
    getDesktopState: async (input: unknown) => {
      calls.push(['desktop', input])
      return result('desktop', { images: [{ mimeType: 'image/png', dataBase64: 'abc' }] })
    },
    callTool: async (name: string, input: string) => {
      calls.push([name, JSON.parse(input)])
      return result(name)
    },
    click: async (input: unknown) => {
      calls.push(['click', input])
      return result('clicked')
    },
    typeText: async (input: unknown) => {
      calls.push(['type', input])
      return result('typed')
    },
    pressKey: async (input: unknown) => {
      calls.push(['key', input])
      return result('keyed')
    },
    scroll: async (input: unknown) => {
      calls.push(['scroll', input])
      return result('scrolled')
    },
    shutdown: async () => {
      calls.push(['shutdown', undefined])
    }
  } as unknown as CuaDriverLike
  return { driver, calls, factory: { create: () => driver } satisfies ComputerDriverFactory }
}

describe('computer SDK adapter', () => {
  test('adds routing guidance without adding browser tools', () => {
    const h = harness()
    computer(h.pi)
    expect(h.tools.some((tool) => tool.name.includes('browser'))).toBe(false)
    const handler = h.events.get('before_agent_start') as unknown as (event: {
      systemPrompt: string
    }) => { systemPrompt: string }
    const guided = handler({ systemPrompt: 'base' }).systemPrompt
    expect(guided).toContain('Use computer tools for native desktop applications')
    expect(guided).toContain('Use agent-browser for webpage DOM')
    expect(guided).toContain('Do not guess process ids')
  })
  test('renders Cua app records semantically without private implementation fields', () => {
    const h = harness()
    computer(h.pi)
    const rendered = renderToolResult(
      h.tools.find((tool) => tool.name === 'computer_apps')!,
      result('raw app output', {
        structuredJson: JSON.stringify({
          apps: [
            {
              name: 'Ghostty',
              pid: 1719,
              active: true,
              running: true,
              bundle_id: 'com.mitchellh.ghostty',
              launch_path: '/Applications/Ghostty.app'
            }
          ]
        })
      })
    )
    expect(rendered).toContain('Ghostty')
    expect(rendered).toContain('pid 1719 · active')
    expect(rendered).not.toContain('bundle_id')
    expect(rendered).not.toContain('launch_path')
    expect(rendered).not.toContain('{')
  })

  test('renders Cua window identity and title as semantic content', () => {
    const h = harness()
    computer(h.pi)
    const rendered = renderToolResult(
      h.tools.find((tool) => tool.name === 'computer_windows')!,
      result('raw window output', {
        structuredJson: JSON.stringify({
          windows: [{ app_name: 'Ghostty', pid: 1719, window_id: 81699, title: 'π - Development' }]
        })
      })
    )
    expect(rendered).toContain('Ghostty')
    expect(rendered).toContain('pid 1719 · window 81699')
    expect(rendered).toContain('π - Development')
    expect(rendered).not.toContain('raw window output')
  })

  test('falls back to Cua text when structured discovery output is unavailable', () => {
    const h = harness()
    computer(h.pi)
    const rendered = renderToolResult(
      h.tools.find((tool) => tool.name === 'computer_apps')!,
      result('Found two applications')
    )
    expect(rendered).toContain('Found two applications')
  })
  test('exposes concise labels without underscores', () => {
    const h = harness()
    computer(h.pi)
    expect(h.tools.map((tool) => tool.label)).toEqual([
      'computer apps',
      'computer windows',
      'computer observe',
      'computer click',
      'computer type',
      'computer key',
      'computer scroll'
    ])
    expect(h.tools.every((tool) => !tool.label.includes('_'))).toBe(true)
  })

  test('routes observe to desktop or window state', async () => {
    const h = harness()
    const f = fakeDriver()
    registerComputerTools(h.pi, f.factory)
    const observe = h.tools.find((tool) => tool.name === 'computer_observe')!
    await observe.execute(
      '2',
      { target: { kind: 'desktop', displayId: 'primary' } },
      undefined,
      undefined,
      {} as never
    )
    await observe.execute(
      '3',
      { target: { kind: 'window', pid: 42, windowId: 7 } },
      undefined,
      undefined,
      {} as never
    )
    expect(f.calls).toEqual([
      ['desktop', { session: undefined }],
      ['get_window_state', { pid: 42, window_id: 7 }]
    ])
  })
  test('forwards typed calls and preserves images and errors', async () => {
    const h = harness()
    const f = fakeDriver()
    registerComputerTools(h.pi, f.factory)
    const observe = h.tools.find((tool) => tool.name === 'computer_observe')!
    const click = h.tools.find((tool) => tool.name === 'computer_click')!
    const scroll = h.tools.find((tool) => tool.name === 'computer_scroll')!
    const signal = new AbortController().signal
    const observed = await observe.execute('1', { session: 's' }, signal, undefined, {} as never)
    await click.execute('2', { x: 3, y: 4, count: 2, session: 's' }, signal, undefined, {} as never)
    await scroll.execute(
      '3',
      { x: 1, y: 2, direction: 'down', by: 'page', amount: 4, session: 's' },
      signal,
      undefined,
      {} as never
    )
    expect(observed.content).toEqual([
      { type: 'text', text: 'desktop' },
      { type: 'image', data: 'abc', mimeType: 'image/png' }
    ])
    expect(f.calls).toEqual([
      ['desktop', { session: 's' }],
      ['click', { x: 3, y: 4, count: 2, target: undefined, session: 's' }],
      ['scroll', expect.objectContaining({ amount: 4n, target: undefined, session: 's' })]
    ])
  })

  test('routes semantic clicks through Cua element tokens', async () => {
    const h = harness()
    const f = fakeDriver()
    registerComputerTools(h.pi, f.factory)
    await h.tools
      .find((tool) => tool.name === 'computer_click')!
      .execute(
        '1',
        { elementToken: 's1:4', target: { kind: 'window', pid: 42, windowId: 7 } },
        undefined,
        undefined,
        {} as never
      )
    expect(f.calls).toContainEqual(['click', { pid: 42, window_id: 7, element_token: 's1:4' }])
  })
  test('shuts down lazily-created driver', async () => {
    const h = harness()
    const f = fakeDriver()
    const shutdown = registerComputerTools(h.pi, f.factory)
    expect(f.calls).toEqual([])
    await h.tools
      .find((tool) => tool.name === 'computer_observe')!
      .execute('1', {}, undefined, undefined, {} as never)
    await shutdown()
    await shutdown()
    expect(f.calls.filter(([name]) => name === 'shutdown')).toHaveLength(1)
  })

  test('renders meaningful action parameters in tool calls', () => {
    const h = harness()
    computer(h.pi)
    const labels = new Map(h.tools.map((tool) => [tool.name, tool]))
    const click = labels
      .get('computer_click')!
      .renderCall?.(
        { x: 10, y: 20, count: 2, target: { kind: 'window', pid: 42, windowId: 7 } },
        testTheme,
        {} as never
      )
    const key = labels
      .get('computer_key')!
      .renderCall?.(
        { key: 'k', modifiers: ['cmd'], target: { kind: 'desktop' } },
        testTheme,
        {} as never
      )
    expect(click?.render(120).join('\n')).toContain('10,20')
    expect(click?.render(120).join('\n')).toContain('window:42/7')
    expect(click?.render(120).join('\n')).toContain('2 clicks')
    expect(key?.render(120).join('\n')).toContain('cmd+k')
    expect(key?.render(120).join('\n')).toContain('desktop')
  })
  test('validates targets and converts them to Cua targets', () => {
    expect(
      Value.Check(schemas.click, {
        x: 1,
        y: 2,
        target: { kind: 'window', pid: 42, windowId: 7 }
      })
    ).toBe(true)
    expect(
      Value.Check(schemas.click, {
        x: 1,
        y: 2,
        target: { kind: 'window', pid: 0, windowId: 7 }
      })
    ).toBe(false)
    expect(sdkTarget({ kind: 'desktop' })).toMatchObject({ inner: { displayId: 'primary' } })
    expect(sdkTarget({ kind: 'window', pid: 42, windowId: 7 })).toMatchObject({
      inner: { pid: 42, windowId: 7n }
    })
  })

  test('renders action and verification status from structured Cua metadata', () => {
    const h = harness()
    computer(h.pi)
    const tool = h.tools.find((candidate) => candidate.name === 'computer_click')!
    const rendered = renderComponentText(
      tool.renderResult?.(
        {
          content: [{ type: 'text', text: 'Clicked Increment' }],
          details: {
            operation: 'click',
            action: { effect: ActionEffect.Confirmed },
            verification: { status: VerificationStatus.Satisfied },
            degraded: false
          }
        },
        { expanded: false, isPartial: false },
        testTheme,
        {} as never
      )
    )
    expect(rendered).toContain('confirmed · verified')
    expect(rendered).toContain('Clicked Increment')
  })
  test('exposes schemas', () => {
    expect(schemas.click).toBeDefined()
    expect(schemas.scroll).toBeDefined()
  })
})
