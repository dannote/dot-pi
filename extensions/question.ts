/**
 * Question Tool - Single question with options
 * Full custom UI: options list + inline editor for "Type something..."
 * Escape in editor returns to options, Escape in options cancels
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth } from '@earendil-works/pi-tui'
import { firstText, renderLines, renderToolCall, toolError, toolText } from './shared/render'
import { Type } from 'typebox'

interface OptionWithDesc {
  label: string
  description?: string
}

type DisplayOption = OptionWithDesc & { isOther?: boolean }

interface QuestionDetails {
  question: string
  options: string[]
  answer: string | null
  wasCustom?: boolean
}

function questionDetails(
  question: string,
  options: string[],
  answer: string | null,
  wasCustom?: boolean
): QuestionDetails {
  return { question, options, answer, ...(wasCustom === undefined ? {} : { wasCustom }) }
}

// Options with labels and optional descriptions
const OptionSchema = Type.Object({
  label: Type.String({ description: 'Display label for the option' }),
  description: Type.Optional(Type.String({ description: 'Optional description shown below label' }))
})

const QuestionParams = Type.Object({
  question: Type.String({ description: 'The question to ask the user' }),
  options: Type.Array(OptionSchema, { description: 'Options for the user to choose from' })
})

export default function question(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'question',
    label: 'Question',
    description:
      'Ask the user a question and let them pick from options. Use when you need user input to proceed.',
    parameters: QuestionParams,
    executionMode: 'sequential',

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (ctx.mode !== 'tui') {
        return toolError(
          'UI not available (running in non-interactive mode)',
          questionDetails(
            params.question,
            params.options.map((option) => option.label),
            null
          )
        )
      }

      if (params.options.length === 0) {
        return toolError('No options provided', questionDetails(params.question, [], null))
      }

      const allOptions: DisplayOption[] = [
        ...params.options,
        { label: 'Type something.', isOther: true }
      ]

      const result = await ctx.ui.custom<{
        answer: string
        wasCustom: boolean
        index?: number
      } | null>((tui, theme, _kb, done) => {
        let optionIndex = 0
        let editMode = false
        let cachedLines: string[] | undefined

        const editorTheme: EditorTheme = {
          borderColor: (s) => theme.fg('accent', s),
          selectList: {
            selectedPrefix: (t) => theme.fg('accent', t),
            selectedText: (t) => theme.fg('accent', t),
            description: (t) => theme.fg('muted', t),
            scrollInfo: (t) => theme.fg('dim', t),
            noMatch: (t) => theme.fg('warning', t)
          }
        }
        const editor = new Editor(tui, editorTheme)

        editor.onSubmit = (value) => {
          const trimmed = value.trim()
          if (trimmed) {
            done({ answer: trimmed, wasCustom: true })
          } else {
            editMode = false
            editor.setText('')
            refresh()
          }
        }

        function refresh() {
          cachedLines = undefined
          tui.requestRender()
        }

        function handleInput(data: string) {
          if (editMode) {
            if (matchesKey(data, Key.escape)) {
              editMode = false
              editor.setText('')
              refresh()
              return
            }
            editor.handleInput(data)
            refresh()
            return
          }

          if (matchesKey(data, Key.up)) {
            optionIndex = Math.max(0, optionIndex - 1)
            refresh()
            return
          }
          if (matchesKey(data, Key.down)) {
            optionIndex = Math.min(allOptions.length - 1, optionIndex + 1)
            refresh()
            return
          }

          if (matchesKey(data, Key.enter)) {
            const selected = allOptions[optionIndex]
            if (selected.isOther) {
              editMode = true
              refresh()
            } else {
              done({ answer: selected.label, wasCustom: false, index: optionIndex + 1 })
            }
            return
          }

          if (matchesKey(data, Key.escape)) {
            done(null)
          }
        }

        function render(width: number): string[] {
          if (cachedLines) return cachedLines

          const lines: string[] = []
          const add = (s: string) => lines.push(truncateToWidth(s, width))

          add(theme.fg('accent', '─'.repeat(width)))
          add(theme.fg('text', ` ${params.question}`))
          lines.push('')

          for (let i = 0; i < allOptions.length; i++) {
            const opt = allOptions[i]
            const selected = i === optionIndex
            const isOther = opt.isOther === true
            const prefix = selected ? theme.fg('accent', '> ') : '  '

            if (isOther && editMode) {
              add(prefix + theme.fg('accent', `${i + 1}. ${opt.label} ✎`))
            } else if (selected) {
              add(prefix + theme.fg('accent', `${i + 1}. ${opt.label}`))
            } else {
              add(`  ${theme.fg('text', `${i + 1}. ${opt.label}`)}`)
            }

            // Show description if present
            if (opt.description) {
              add(`     ${theme.fg('muted', opt.description)}`)
            }
          }

          if (editMode) {
            lines.push('')
            add(theme.fg('muted', ' Your answer:'))
            for (const line of editor.render(width - 2)) {
              add(` ${line}`)
            }
          }

          lines.push('')
          if (editMode) {
            add(theme.fg('dim', ' Enter to submit • Esc to go back'))
          } else {
            add(theme.fg('dim', ' ↑↓ navigate • Enter to select • Esc to cancel'))
          }
          add(theme.fg('accent', '─'.repeat(width)))

          cachedLines = lines
          return lines
        }

        return {
          render,
          invalidate: () => {
            cachedLines = undefined
          },
          handleInput
        }
      })

      // Build simple options list for details
      const simpleOptions = params.options.map((o) => o.label)

      if (!result) {
        return toolText(
          'User cancelled the selection',
          questionDetails(params.question, simpleOptions, null)
        )
      }

      if (result.wasCustom) {
        return toolText(
          `User wrote: ${result.answer}`,
          questionDetails(params.question, simpleOptions, result.answer, true)
        )
      }
      return toolText(
        `User selected: ${result.index}. ${result.answer}`,
        questionDetails(params.question, simpleOptions, result.answer, false)
      )
    },

    renderCall(args, theme) {
      const safeArgs = args ?? {}
      const opts = Array.isArray(safeArgs.options) ? safeArgs.options : []
      return renderToolCall(theme, 'ask', {
        segments: [{ text: safeArgs.question, color: 'muted' }],
        suffix: opts.length ? `${opts.length + 1} options` : undefined
      })
    },

    renderResult(result, _options, theme) {
      const details = result.details as QuestionDetails | undefined
      if (!details) return renderLines([firstText(result)])

      if (details.answer === null) return renderLines([theme.fg('warning', 'Cancelled')])

      if (details.wasCustom) {
        return renderLines([theme.fg('muted', '(wrote) ') + theme.fg('accent', details.answer)])
      }
      const idx = details.options.indexOf(details.answer) + 1
      const display = idx > 0 ? `${idx}. ${details.answer}` : details.answer
      return renderLines([theme.fg('accent', display)])
    }
  })
}
