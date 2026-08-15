import { describe, expect, test } from 'vitest'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

import astGrep from './ast-grep'
import background from './background'
import chooseOptions from './choose-options'
import codesearch from './codesearch'
import context7 from './context7'
import lsp from './lsp'
import question from './question'
import webfetch from './webfetch'
import websearch from './websearch'
import { renderComponentText, testTheme } from './shared/test-utils'

type RegisteredTool = Parameters<ExtensionAPI['registerTool']>[0]

function collectTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = []
  const pi = {
    registerTool: (tool: RegisteredTool) => tools.push(tool),
    registerCommand: () => undefined,
    on: () => undefined,
    registerMessageRenderer: () => undefined
  } as unknown as ExtensionAPI

  for (const extension of [
    astGrep,
    background,
    chooseOptions,
    codesearch,
    context7,
    lsp,
    question,
    webfetch,
    websearch
  ]) {
    extension(pi)
  }

  return tools.filter((tool) => tool.renderCall)
}

describe('interactive tool execution', () => {
  test('serializes tools that require exclusive user input', () => {
    const tools = collectTools()
    expect(tools.find((tool) => tool.name === 'question')?.executionMode).toBe('sequential')
    expect(tools.find((tool) => tool.name === 'choose_from_options')?.executionMode).toBe(
      'sequential'
    )
  })
})

describe('tool renderCall streaming start', () => {
  test('does not render undefined when args are unavailable', () => {
    const rendered = collectTools().map((tool) => {
      const component = tool.renderCall?.(undefined as never, testTheme, {} as never)
      if (!component) throw new Error(`${tool.name} missing renderCall`)
      return [tool.name, renderComponentText(component)]
    })

    expect(rendered.length).toBeGreaterThan(0)
    for (const [name, text] of rendered) {
      expect(text.toLowerCase(), name).not.toContain('undefined')
    }
  })
})
