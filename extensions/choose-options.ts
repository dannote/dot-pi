import type { ExtensionAPI, ExtensionContext, Theme } from '@earendil-works/pi-coding-agent'
import {
  isKeyRelease,
  Key,
  matchesKey,
  SelectList,
  Text,
  truncateToWidth,
  wrapTextWithAnsi
} from '@earendil-works/pi-tui'
import { renderLines, toolText } from './shared/render'
import { Type } from 'typebox'

type Option = {
  label: string
  description?: string
}

type ChooseResult = {
  question: string
  action: string
  options: Option[]
  selectedIndexes: number[]
  comment?: string
  cancelled: boolean
  active?: boolean
  optionIndex?: number
}

type PickerConfig = {
  question: string
  options: Option[]
  actions: string[]
  allowMultiple: boolean
  defaultActionIndex: number
}

const DEFAULT_ACTIONS = ['Proceed', 'Discuss first', 'Explain']
const NONE_OPTION_LABEL = 'None of these'
const NONE_OPTION_DESCRIPTION = 'Type a different direction in the editor.'
const ACTION_EXAMPLES =
  'Examples: ["Apply fix", "Show diff first", "Skip"], ["Proceed", "Discuss first", "Explain"], ["Use this", "Compare options", "None"].'
const SYSTEM_HINT = `When you need the user to pick from options/next steps, call choose_from_options. Do not ask them to type item numbers. Do not include "${NONE_OPTION_LABEL}"; it is added automatically. Customize action labels. ${ACTION_EXAMPLES}`

const OptionSchema = Type.Object({
  label: Type.String({ description: 'Display label for the option' }),
  description: Type.Optional(Type.String({ description: 'Optional description shown below label' }))
})

const ParamsSchema = Type.Object({
  question: Type.String({ description: 'Question shown above the options' }),
  options: Type.Array(OptionSchema, {
    description: `Options to choose from. Do not include "${NONE_OPTION_LABEL}"; it is automatic.`
  }),
  allowMultiple: Type.Optional(
    Type.Boolean({ description: 'Allow selecting multiple options. Defaults to true.' })
  ),
  actions: Type.Optional(
    Type.Array(Type.String(), {
      description: `End-user action labels. Defaults to ${DEFAULT_ACTIONS.join(', ')}. ${ACTION_EXAMPLES}`
    })
  ),
  defaultAction: Type.Optional(Type.String({ description: 'Initially selected action label' }))
})

export function formatChoiceResult(result: ChooseResult): string {
  if (result.cancelled) return 'User cancelled option selection.'

  const selected = result.selectedIndexes
    .map((index) => `${index + 1}. ${result.options[index]?.label ?? '(missing option)'}`)
    .join('\n')
  const comment = result.comment ? `\n\nComment:\n${result.comment}` : ''

  return `User chose action: ${result.action}\n\nSelected options:\n${selected || NONE_OPTION_LABEL}${comment}\n\nContinue according to the chosen action. Do not act on unselected options.`
}

export default function chooseOptions(pi: ExtensionAPI) {
  pi.on('before_agent_start', (event) => ({
    systemPrompt: event.systemPrompt.includes(SYSTEM_HINT)
      ? event.systemPrompt
      : `${event.systemPrompt}\n\n${SYSTEM_HINT}`
  }))

  pi.registerTool({
    name: 'choose_from_options',
    label: 'Choose Options',
    description: `Ask the user to choose from options/next steps. ${NONE_OPTION_LABEL} is automatic. Customize user-facing action labels. ${ACTION_EXAMPLES}`,
    parameters: ParamsSchema,
    executionMode: 'sequential',

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const options = params.options
      if (ctx.mode !== 'tui')
        return errorResult('Error: UI not available', params.question, options)
      if (options.length === 0)
        return errorResult('Error: No options provided', params.question, [])

      const actions = params.actions?.length ? params.actions : DEFAULT_ACTIONS
      const defaultActionIndex = Math.max(
        0,
        actions.indexOf(params.defaultAction ?? actions[0] ?? '')
      )

      const result = await runNativeEditorChooser(
        {
          question: params.question,
          options,
          actions,
          allowMultiple: params.allowMultiple !== false,
          defaultActionIndex
        },
        ctx,
        signal
      )

      return toolText(formatChoiceResult(result), result)
    },

    renderCall(args, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text('', 0, 0)
      text.setText(formatChooseCall(args, theme))
      return text
    },

    renderResult(result, _options, theme) {
      const details = result.details as ChooseResult | undefined
      if (!details) return renderLines([])
      if (details.cancelled) return renderLines([theme.fg('warning', 'Cancelled')])
      const selected = details.selectedIndexes
        .map((index) => details.options[index]?.label)
        .filter(Boolean)
        .join(', ')
      const selection = selected || NONE_OPTION_LABEL
      const comment = details.comment ? ` · ${details.comment}` : ''
      return renderLines([
        theme.fg('toolOutput', details.action) + theme.fg('muted', ` · ${selection}${comment}`)
      ])
    }
  })
}

type ChooserState = {
  optionIndex: number
  actionIndex: number
  selected: Set<number>
}

const WIDGET_KEY = 'choose-from-options'
const MAX_VISIBLE_OPTIONS = 5
const ACTIVE_CHOOSER_TOKEN_KEY = Symbol.for('dot-pi.choose-options.active-token')

type ChooseGlobalState = typeof globalThis & {
  [ACTIVE_CHOOSER_TOKEN_KEY]?: symbol
}

function getActiveChooserToken(): symbol | undefined {
  return (globalThis as ChooseGlobalState)[ACTIVE_CHOOSER_TOKEN_KEY]
}

function setActiveChooserToken(token: symbol | undefined): void {
  ;(globalThis as ChooseGlobalState)[ACTIVE_CHOOSER_TOKEN_KEY] = token
}

type AltBaseKey = Parameters<typeof Key.alt>[0]

function altKey(key: string) {
  return Key.alt(key as AltBaseKey)
}

function runNativeEditorChooser(
  config: PickerConfig,
  ctx: ExtensionContext,
  signal?: AbortSignal
): Promise<ChooseResult> {
  const state: ChooserState = {
    optionIndex: 0,
    actionIndex: config.defaultActionIndex,
    selected: new Set(config.allowMultiple ? [] : [0])
  }

  let requestRender = () => {}
  let widget: MinimalChooseWidget | undefined
  let unsubscribeInput: (() => void) | undefined
  let finished = false
  const chooserToken = Symbol('choose-from-options')
  setActiveChooserToken(chooserToken)

  return new Promise((resolve) => {
    const cleanup = () => {
      signal?.removeEventListener('abort', abort)
      unsubscribeInput?.()
      if (getActiveChooserToken() === chooserToken) setActiveChooserToken(undefined)
      ctx.ui.setWidget(WIDGET_KEY, undefined)
    }

    const refresh = () => {
      widget?.invalidate()
      requestRender()
    }

    const finish = (cancelled: boolean) => {
      if (finished) return
      finished = true
      const editorText = ctx.ui.getEditorText().trim()
      const parsed = cancelled
        ? { selectedIndexes: sortedSelection(state.selected), comment: undefined }
        : parseEditorChoice(editorText, state.selected, config)

      if (!cancelled) ctx.ui.setEditorText('')
      cleanup()
      resolve(
        currentResult(config, state, cancelled, parsed.comment, false, parsed.selectedIndexes)
      )
    }

    const abort = () => finish(true)
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })

    ctx.ui.setWidget(
      WIDGET_KEY,
      (tui, theme) => {
        widget = new MinimalChooseWidget(config, state, theme)
        requestRender = () => tui.requestRender()
        return widget
      },
      { placement: 'belowEditor' }
    )

    unsubscribeInput = ctx.ui.onTerminalInput((data) => {
      if (isKeyRelease(data)) return { consume: true }
      if (getActiveChooserToken() !== chooserToken) return undefined
      if (matchesKey(data, Key.enter)) {
        finish(false)
        return { consume: true }
      }
      if (matchesKey(data, Key.escape)) {
        finish(true)
        return { consume: true }
      }
      if (matchesKey(data, Key.space) && ctx.ui.getEditorText().trim() === '') {
        toggleCurrent(config, state)
        refresh()
        return { consume: true }
      }
      if (/^[1-9]$/.test(data) && ctx.ui.getEditorText().trim() === '') {
        const index = Number(data) - 1
        if (index < optionCount(config)) {
          toggleIndex(config, state, index)
          refresh()
          return { consume: true }
        }
      }
      if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
        move(config, state, matchesKey(data, Key.up) ? -1 : 1)
        refresh()
        return { consume: true }
      }
      if (matchesKey(data, Key.tab)) {
        cycleAction(config, state, 1)
        refresh()
        return { consume: true }
      }
      if (matchesKey(data, Key.alt('a'))) {
        selectAll(config, state)
        refresh()
        return { consume: true }
      }
      if (matchesKey(data, Key.alt('n'))) {
        selectOnlyCurrent(config, state)
        refresh()
        return { consume: true }
      }
      if (matchesKey(data, Key.alt(Key.space))) {
        toggleCurrent(config, state)
        refresh()
        return { consume: true }
      }

      const actionIndex = actionShortcutIndex(config, data)
      if (actionIndex !== undefined) {
        state.actionIndex = actionIndex
        refresh()
        return { consume: true }
      }

      for (let index = 0; index < Math.min(9, optionCount(config)); index++) {
        if (matchesKey(data, altKey(String(index + 1)))) {
          toggleIndex(config, state, index)
          refresh()
          return { consume: true }
        }
      }

      return undefined
    })
  })
}

class MinimalChooseWidget {
  private cachedWidth?: number
  private cachedLines?: string[]

  constructor(
    private config: PickerConfig,
    private state: ChooserState,
    private theme: Theme
  ) {}

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) return this.cachedLines

    this.cachedWidth = width
    this.cachedLines = renderChoiceRows(this.config, this.state, this.theme, {
      width,
      footer: true
    })
    return this.cachedLines
  }

  handleSelectInput(data: string): void {
    const list = createChoiceSelectList(this.config, this.state, this.theme)
    list.handleInput(data)
    const selected = list.getSelectedItem()
    if (!selected) return
    this.state.optionIndex = Number(selected.value)
    if (!this.config.allowMultiple) selectOnlyCurrent(this.config, this.state)
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cachedLines = undefined
  }
}

function renderChoiceRows(
  config: PickerConfig,
  state: ChooserState,
  theme: Theme,
  options: { width?: number; footer: boolean }
): string[] {
  const width = options.width ?? 100
  const list = createChoiceSelectList(config, state, theme)

  const questionLines = wrapTextWithAnsi(
    theme.fg('toolOutput', config.question),
    Math.max(20, width)
  )
  const lines = [
    ...questionLines,
    '',
    ...list.render(width).map((line) => truncateToWidth(line, width))
  ]
  if (options.footer) lines.push(renderChoiceFooter(config, state, theme, width))
  return lines
}

function createChoiceSelectList(config: PickerConfig, state: ChooserState, theme: Theme) {
  const items = displayOptions(config).map((option, index) => {
    const selected = isSelectedIndex(config, state, index)
    const number = selected
      ? theme.fg('accent', `${index + 1}`)
      : theme.fg('toolOutput', `${index + 1}`)
    const marker = selected ? theme.fg('muted', ' selected') : ''
    const checkbox = selected ? theme.fg('accent', '[x]') : theme.fg('muted', '[ ]')
    return {
      value: String(index),
      label: config.allowMultiple
        ? `${number} ${checkbox} ${option.label}`
        : `${number} ${option.label}${marker}`,
      description: option.description
    }
  })

  const list = new SelectList(items, MAX_VISIBLE_OPTIONS, selectListTheme(theme), {
    minPrimaryColumnWidth: 28,
    maxPrimaryColumnWidth: 48
  })
  list.setSelectedIndex(state.optionIndex)
  return list
}

function formatChooseCall(args: unknown, theme: Theme): string {
  const safeArgs = (args ?? {}) as { question?: unknown; options?: unknown }
  const count = Array.isArray(safeArgs.options) ? safeArgs.options.length : 0
  const question = typeof safeArgs.question === 'string' ? safeArgs.question : ''
  const suffix = count ? theme.fg('dim', ` (${count} options)`) : ''
  return `${theme.fg('toolTitle', theme.bold('choose'))}${question ? ` ${theme.fg('muted', question)}` : ''}${suffix}`
}

function selectListTheme(theme: Theme) {
  return {
    selectedPrefix: (text: string) => theme.fg('accent', text),
    selectedText: (text: string) => theme.fg('accent', text),
    description: (text: string) => theme.fg('muted', text),
    scrollInfo: (text: string) => theme.fg('muted', text),
    noMatch: (text: string) => theme.fg('muted', text)
  }
}

function renderChoiceFooter(
  config: PickerConfig,
  state: ChooserState,
  theme: Theme,
  width: number
): string {
  const total = optionCount(config)
  const position = `${state.optionIndex + 1}/${total}`
  const action = currentAction(config, state)
  const hint = config.allowMultiple
    ? `  (${position}) ${action} · ↑↓ move · Space/1-9 toggle · Enter confirm · Esc cancel · type comment`
    : `  (${position}) ${action} · ↑↓/1-9 select · Enter confirm · Esc cancel · type comment`
  return truncateToWidth(theme.fg('dim', hint), width)
}

function optionCount(config: PickerConfig): number {
  return displayOptions(config).length
}

function displayOptions(config: PickerConfig): Option[] {
  return explicitNoneIndex(config) === undefined
    ? [...config.options, { label: NONE_OPTION_LABEL, description: NONE_OPTION_DESCRIPTION }]
    : config.options
}

function explicitNoneIndex(config: PickerConfig): number | undefined {
  const normalizedNone = normalizeOptionLabel(NONE_OPTION_LABEL)
  const index = config.options.findIndex(
    (option) => normalizeOptionLabel(option.label) === normalizedNone
  )
  return index >= 0 ? index : undefined
}

function noneIndex(config: PickerConfig): number {
  return explicitNoneIndex(config) ?? config.options.length
}

function normalizeOptionLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, ' ').trim()
}

function isNoneIndex(config: PickerConfig, index: number): boolean {
  return index === noneIndex(config)
}

function isSelectedIndex(config: PickerConfig, state: ChooserState, index: number): boolean {
  return !isNoneIndex(config, index) && state.selected.has(index)
}

function move(config: PickerConfig, state: ChooserState, delta: number): void {
  const total = optionCount(config)
  state.optionIndex = (state.optionIndex + delta + total) % total
  if (!config.allowMultiple) selectOnlyCurrent(config, state)
}

function cycleAction(config: PickerConfig, state: ChooserState, delta: number): void {
  state.actionIndex = (state.actionIndex + delta + config.actions.length) % config.actions.length
}

function toggleCurrent(config: PickerConfig, state: ChooserState): void {
  toggleIndex(config, state, state.optionIndex)
}

function toggleIndex(config: PickerConfig, state: ChooserState, index: number): void {
  state.optionIndex = index
  if (isNoneIndex(config, index)) {
    state.selected.clear()
    return
  }
  if (!config.allowMultiple) {
    state.selected.clear()
    state.selected.add(index)
    return
  }
  if (state.selected.has(index)) state.selected.delete(index)
  else state.selected.add(index)
}

function selectAll(config: PickerConfig, state: ChooserState): void {
  if (!config.allowMultiple) return selectOnlyCurrent(config, state)
  state.selected.clear()
  config.options.forEach((_, index) => state.selected.add(index))
}

function selectOnlyCurrent(config: PickerConfig, state: ChooserState): void {
  state.selected.clear()
  if (!isNoneIndex(config, state.optionIndex)) state.selected.add(state.optionIndex)
}

function sortedSelection(selected: Set<number>): number[] {
  return [...selected].sort((a, b) => a - b)
}

function currentResult(
  config: PickerConfig,
  state: ChooserState,
  cancelled: boolean,
  comment?: string,
  active = false,
  selectedIndexes = sortedSelection(state.selected)
): ChooseResult {
  return {
    question: config.question,
    action: currentAction(config, state),
    options: config.options,
    selectedIndexes,
    comment,
    cancelled,
    active,
    optionIndex: state.optionIndex
  }
}

function currentAction(config: PickerConfig, state: ChooserState): string {
  return config.actions[state.actionIndex] ?? DEFAULT_ACTIONS[0]
}

function actionShortcutIndex(config: PickerConfig, data: string): number | undefined {
  const shortcuts = ['d', 's', 'e']
  for (let index = 0; index < Math.min(shortcuts.length, config.actions.length); index++) {
    if (matchesKey(data, altKey(shortcuts[index] ?? ''))) return index
  }
  return undefined
}

function parseEditorChoice(text: string, fallback: Set<number>, config: PickerConfig) {
  const trimmed = text.trim()
  if (!trimmed) return { selectedIndexes: sortedSelection(fallback), comment: undefined }

  const leading = trimmed.match(/^((?:#?\d+\s*(?:(?:,|\+|&|and)\s*)?)+)(.*)$/i)
  if (!leading) return { selectedIndexes: sortedSelection(fallback), comment: trimmed }

  const parsed = [...leading[1].matchAll(/#?(\d+)/g)]
    .map((match) => Number(match[1]) - 1)
    .filter((index) => Number.isInteger(index) && index >= 0 && index < optionCount(config))

  const uniqueParsed = [...new Set(parsed)]
  const selectedIndexes = uniqueParsed.includes(noneIndex(config))
    ? []
    : uniqueParsed.length > 0
      ? uniqueParsed.sort((a, b) => a - b)
      : sortedSelection(fallback)
  const comment = leading[2]?.trim() || undefined
  return { selectedIndexes, comment }
}

function errorResult(message: string, question: string, options: Option[]) {
  const details: ChooseResult = {
    question,
    action: '',
    options,
    selectedIndexes: [],
    cancelled: true
  }
  return toolText(message, details)
}
