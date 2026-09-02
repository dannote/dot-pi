import { describe, expect, test } from 'vitest'

import codesearch from './codesearch'
import context7 from './context7'
import lsp from './lsp'
import { formatWorktreeList, parseWorktreePorcelain } from './worktrees/git'
import webfetch from './webfetch'
import websearch from './websearch'
import { registeredTool, renderComponentText, testTheme } from './shared/test-utils'

function renderResult(
  extension: Parameters<typeof registeredTool>[0],
  toolName: string,
  details: object,
  text: string,
  options: { expanded?: boolean; isPartial?: boolean } = {}
) {
  const tool = registeredTool(extension, toolName)
  return renderComponentText(
    tool.renderResult?.(
      { content: [{ type: 'text', text }], details },
      { expanded: options.expanded ?? false, isPartial: options.isPartial ?? false },
      testTheme,
      {} as never
    )
  )
}

describe('renderer smoke snapshots', () => {
  test('websearch compact result stays semantic', () => {
    const rendered = renderResult(
      websearch,
      'websearch',
      {
        query: 'pi tools',
        results: [
          {
            title: 'Pi Tools',
            url: 'https://example.com/pi',
            text: 'Tooling overview',
            highlights: ['Fast tools']
          }
        ]
      },
      'Found 1 result'
    )

    expect(rendered).toContain('Pi Tools')
    expect(rendered).toContain('https://example.com/pi')
  })

  test('websearch structured result-like output reuses entry rendering', () => {
    const rendered = renderResult(
      websearch,
      'websearch',
      {
        query: 'captcha docs',
        results: [],
        output: JSON.stringify({
          results: [
            {
              title: 'Invisible CAPTCHA',
              url: 'https://example.com/captcha',
              keyPoints: ['Official integration documentation.', 'Uses execute() for validation.']
            }
          ]
        })
      },
      'structured'
    )

    expect(rendered).toContain('Invisible CAPTCHA')
    expect(rendered).toContain('https://example.com/captcha')
    expect(rendered).toContain('Official integration documentation.')
    expect(rendered).toContain('Uses execute() for validation.')
    expect(rendered).not.toContain('{')
    expect(rendered).not.toContain('Structured synthesis available')
  })

  test('websearch prose synthesis reuses markdown preview', () => {
    const rendered = renderResult(
      websearch,
      'websearch',
      {
        query: 'answer',
        results: [],
        output: 'The official directory lists each regional office.'
      },
      'synthesis'
    )
    expect(rendered).toContain('The official directory')
  })
  test('context7 docs compact result exposes library metadata', () => {
    const rendered = renderResult(
      context7,
      'context7-docs',
      { libraryId: '/reactjs/react.dev' },
      'useState lets you add state to a component.'
    )

    expect(rendered).toContain('useState lets you add state')
  })

  test('lsp compact result renders status output', () => {
    const rendered = renderResult(
      lsp,
      'lsp',
      { action: 'status', success: true },
      'Active language servers: typescript'
    )

    expect(rendered).toContain('Active language servers')
    expect(rendered).toContain('typescript')
  })

  test('webfetch error result renders as an error', () => {
    const rendered = renderResult(
      webfetch,
      'fetch',
      { url: 'https://example.com', error: true, status: 404 },
      'Error: Request failed with status 404'
    )

    expect(rendered).toContain('Error: Request failed with status 404')
  })

  test('codefetch error result renders as an error', () => {
    const rendered = renderResult(
      codesearch,
      'codefetch',
      { repo: 'owner/repo', path: 'missing.ts', error: true },
      'Error: Not found'
    )

    expect(rendered).toContain('Error: Not found')
  })

  test('context7 resolve error result renders as an error', () => {
    const rendered = renderResult(
      context7,
      'context7-resolve',
      { error: true },
      'Error: Context7 API key missing'
    )

    expect(rendered).toContain('Error: Context7 API key missing')
  })

  test('websearch partial loading renders no stale content', () => {
    const rendered = renderResult(
      websearch,
      'websearch',
      { query: 'pi', results: [], loading: true },
      '',
      { isPartial: true }
    )

    expect(rendered).toBe('')
  })

  test('worktree compact formatting keeps path and main marker', () => {
    const rendered = formatWorktreeList(
      parseWorktreePorcelain('worktree /repo\nHEAD abcdef123456\nbranch refs/heads/main\n\n')
    )

    expect(rendered).toContain('main (main)')
    expect(rendered).toContain('/repo')
  })
})
