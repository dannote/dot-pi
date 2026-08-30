import { describe, expect, test } from 'vitest'
import type { Theme } from '@earendil-works/pi-coding-agent'
import { visibleWidth } from '@earendil-works/pi-tui'

import {
  clampRenderedLines,
  expandTabs,
  firstText,
  renderEmpty,
  renderEntryList,
  renderErrorOrPartial,
  renderLines,
  renderMarkdownPreview,
  renderTextLinesPreview,
  renderToolCall,
  toolError,
  toolLoading
} from './render'

const theme = {
  fg: (_name: string, text: string) => String(text),
  bg: (_name: string, text: string) => String(text),
  bold: (text: string) => String(text),
  underline: (text: string) => String(text)
} as Theme

describe('renderEmpty', () => {
  test('renders no lines for partial tool output', () => {
    expect(renderEmpty().render(80)).toEqual([])
  })
})

describe('renderLines', () => {
  test('truncates long lines to viewport width', () => {
    const [, line] = renderLines(['abcdefghijklmnopqrstuvwxyz']).render(10)

    expect(visibleWidth(line)).toBeLessThanOrEqual(10)
    expect(line).toContain('…')
  })

  test('flattens embedded newlines and carriage returns into physical rows', () => {
    expect(renderLines(['one\ntwo\r\nthree\rfour'] as string[]).render(120)).toEqual([
      '',
      'one',
      'two',
      'three',
      'four'
    ])
  })

  test('flattens multiline function output before truncating', () => {
    expect(
      renderLines([() => 'first\nsecond\r\nthird'] as Array<() => string>).render(120)
    ).toEqual(['', 'first', 'second', 'third'])
  })
  test('supports explicit truncation marker', () => {
    const [, line] = renderTextLinesPreview(['abcdefghijklmnopqrstuvwxyz'], theme, {
      expanded: false,
      compactLimit: 1,
      truncationMarker: '...'
    }).render(10)

    expect(visibleWidth(line)).toBeLessThanOrEqual(10)
    expect(line).toContain('...')
  })

  test('expands tabs globally before rendering lines', () => {
    const lines = renderLines(['\treturn true', 'ab\tcd']).render(120)

    expect(lines.join('\n')).not.toContain('\t')
    expect(lines).toContain('        return true')
    expect(lines).toContain('ab      cd')
  })

  test('expands tabs without breaking ansi styling', () => {
    const red = '\x1b[31m'
    const reset = '\x1b[0m'

    expect(expandTabs(`${red}ab\tcd${reset}`)).toBe(`${red}ab      cd${reset}`)
  })
})

describe('renderErrorOrPartial', () => {
  test('renders errors and partial empty states', () => {
    expect(
      renderErrorOrPartial(
        { content: [{ type: 'text', text: 'Error: Boom' }], details: { error: true } },
        { error: true },
        {},
        theme
      )?.render(120)
    ).toEqual(['', 'Error: Boom'])

    expect(
      renderErrorOrPartial({ content: [], details: {} }, {}, { isPartial: true }, theme)?.render(
        120
      )
    ).toEqual([])
  })
})

describe('toolError', () => {
  test('prefixes error messages once', () => {
    expect(firstText(toolError('Boom', { error: true }))).toBe('Error: Boom')
    expect(firstText(toolError('Error: Boom', { error: true }))).toBe('Error: Boom')
  })

  test('marks result as error', () => {
    expect(toolError('Boom', {}).isError).toBe(true)
  })
})

describe('toolLoading', () => {
  test('returns empty content with typed details', () => {
    expect(toolLoading({ loading: true })).toEqual({ content: [], details: { loading: true } })
  })
})

describe('renderToolCall', () => {
  test('skips empty segments and falsey tags', () => {
    const [line] = renderToolCall(theme, 'fetch', {
      segments: [{ text: undefined }, { text: '' }, { text: 'https://example.com' }],
      tags: [undefined, '', false, 'json'],
      suffix: undefined
    }).render(120)

    expect(line).toBe('fetch https://example.com [json]')
    expect(line).not.toContain('undefined')
    expect(line).not.toContain('false')
  })

  test('collapses embedded newlines in single-line tool calls', () => {
    const [line] = renderToolCall(theme, 'web', {
      segments: [{ text: 'first\nsecond\r\nthird' }]
    }).render(120)

    expect(line).toBe('web first second third')
    expect(line).not.toMatch(/[\r\n]/u)
  })
  test('truncates long call lines', () => {
    const [line] = renderToolCall(theme, 'fetch', {
      segments: [{ text: 'abcdefghijklmnopqrstuvwxyz' }]
    }).render(12)

    expect(visibleWidth(line)).toBeLessThanOrEqual(12)
    expect(line).toContain('…')
  })
})

describe('renderMarkdownPreview', () => {
  test('renders compact markdown preview with metadata', () => {
    const lines = renderMarkdownPreview('one\ntwo\nthree', theme, {
      expanded: false,
      compactLines: 2,
      metadata: ['meta']
    }).render(120)

    expect(lines).toContain('meta')
    expect(lines).toContain('one')
    expect(lines).toContain('two')
    expect(lines).toContain('… 1 more lines')
  })
})

describe('renderTextLinesPreview', () => {
  test('renders a compact tail preview with expand footer', () => {
    const lines = renderTextLinesPreview(['one', 'two', 'three'], theme, {
      expanded: false,
      compactLimit: 1,
      header: ['logs'],
      mode: 'tail'
    }).render(120)

    expect(lines).toContain('logs')
    expect(lines).toContain('three')
    expect(lines).toContain('… 2 more lines')
    expect(lines.join('\n')).toContain('ctrl+o')
    expect(lines).not.toContain('one')
  })

  test('renders all lines when expanded', () => {
    const lines = renderTextLinesPreview(['one', 'two'], theme, {
      expanded: true,
      compactLimit: 1,
      mode: 'tail'
    }).render(120)

    expect(lines).toEqual(['', 'one', 'two'])
  })

  test('supports inline hidden counts without extra footer lines', () => {
    const lines = renderTextLinesPreview(['one', 'two', 'three'], theme, {
      expanded: false,
      compactLimit: 1,
      header: ['logs'],
      mode: 'tail',
      inlineHidden: true
    }).render(120)

    expect(lines).toEqual(['', 'logs', 'three … 2 more lines (ctrl+o to expand)'])
  })

  test('limits expanded previews when requested', () => {
    const lines = renderTextLinesPreview(['one', 'two', 'three', 'four'], theme, {
      expanded: true,
      compactLimit: 1,
      expandedLimit: 3,
      mode: 'tail'
    }).render(120)

    expect(lines).toEqual(['', 'two', 'three', 'four'])
  })
})

describe('renderEntryList', () => {
  test('renders compact entries with hidden footer', () => {
    const lines = renderEntryList(['one', 'two'], theme, {
      expanded: false,
      compactLimit: 1,
      renderEntry: (entry) => ({ header: entry }),
      hiddenLines: (hidden) => (hidden > 0 ? [`… ${hidden} more`] : [])
    }).render(120)

    expect(lines).toContain('one')
    expect(lines).toContain('… 1 more')
    expect(lines.join('\n')).toContain('ctrl+o')
    expect(lines).not.toContain('two')
  })
})

describe('clampRenderedLines', () => {
  test('truncates lines returned by wrapped components', () => {
    const component = clampRenderedLines({
      render: () => ['0123456789abcdef'],
      invalidate: () => undefined
    })

    const [line] = component.render(8)

    expect(visibleWidth(line)).toBeLessThanOrEqual(8)
    expect(line).toContain('…')
  })
})
