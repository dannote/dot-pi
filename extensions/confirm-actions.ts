/**
 * Confirm Actions Extension
 *
 * Prompts for confirmation before configured publish/mutate shell commands and
 * session actions that need explicit user approval.
 */

import type {
  ExtensionAPI,
  SessionBeforeSwitchEvent,
  SessionMessageEntry
} from '@earendil-works/pi-coding-agent'
import { isToolCallEventType } from '@earendil-works/pi-coding-agent'
import {
  parse as parseShell,
  type ArithmeticExpression,
  type Node,
  type Script,
  type Word,
  type WordPart
} from 'unbash'
import { notifyDesktop } from './shared/desktop-notify'
import { formatPiNotificationTitle } from './shared/project-name'
import { readLayeredSettings } from './shared/settings'

export type CommandRule = {
  argv: string[]
  label: string
  matches?: (argv: string[]) => boolean
}

const GITHUB_RULES: CommandRule[] = [
  exact(['gh', 'pr', 'create'], 'Publish GitHub PR'),
  exact(['gh', 'pr', 'edit'], 'Edit GitHub PR'),
  exact(['gh', 'pr', 'comment'], 'Publish GitHub PR comment'),
  exact(['gh', 'pr', 'review'], 'Publish GitHub PR review'),
  exact(['gh', 'issue', 'create'], 'Create GitHub issue'),
  exact(['gh', 'issue', 'edit'], 'Edit GitHub issue'),
  exact(['gh', 'issue', 'comment'], 'Publish GitHub issue comment'),
  exact(['gh', 'issue', 'close'], 'Close GitHub issue'),
  exact(['gh', 'issue', 'delete'], 'Delete GitHub issue'),
  exact(['gh', 'repo', 'create'], 'Create GitHub repo'),
  exact(['gh', 'repo', 'delete'], 'Delete GitHub repo'),
  exact(['gh', 'repo', 'archive'], 'Archive GitHub repo'),
  exact(['gh', 'repo', 'edit'], 'Edit GitHub repo'),
  exact(['gh', 'repo', 'rename'], 'Rename GitHub repo'),
  exact(['gh', 'repo', 'transfer'], 'Transfer GitHub repo'),
  matched(['gh', 'repo', 'deploy-key'], 'Mutate GitHub repo deploy keys', isMutatingGhSubcommand),
  exact(['gh', 'repo', 'set-default'], 'Change default GitHub repo'),
  exact(['gh', 'release', 'create'], 'Publish GitHub release'),
  exact(['gh', 'release', 'delete'], 'Delete GitHub release'),
  exact(['gh', 'release', 'edit'], 'Edit GitHub release'),
  matched(['gh', 'api'], 'Mutate via GitHub API', isMutatingGhApi)
]

const GITLAB_RULES: CommandRule[] = [
  exact(['glab', 'mr', 'create'], 'Publish GitLab MR'),
  exact(['glab', 'mr', 'update'], 'Edit GitLab MR'),
  exact(['glab', 'mr', 'note'], 'Publish GitLab MR comment'),
  exact(['glab', 'issue', 'create'], 'Publish GitLab issue'),
  exact(['glab', 'issue', 'update'], 'Edit GitLab issue'),
  exact(['glab', 'issue', 'note'], 'Publish GitLab issue comment'),
  exact(['glab', 'issue', 'close'], 'Close GitLab issue'),
  exact(['glab', 'issue', 'delete'], 'Delete GitLab issue'),
  exact(['glab', 'release', 'create'], 'Publish GitLab release')
]

const GMAIL_RULES: CommandRule[] = [matched(['gws', 'gmail'], 'Mutate Gmail', isMutatingGmail)]

const TWITTER_RULES: CommandRule[] = [
  matched(['bird'], 'Mutate X/Twitter', isMutatingBird),
  matched(['bunx', '@dannote/bird-premium'], 'Mutate X/Twitter', isMutatingBird)
]

const GIT_RULES: CommandRule[] = [
  matched(['git'], 'Force push', isGitForcePush),
  matched(['git'], 'Delete remote branch', isGitRemoteBranchDelete),
  matched(['git'], 'Push git commits', isGitPush),
  matched(['git'], 'Hard reset', isGitHardReset),
  matched(['git'], 'Clean working tree', isGitForcedClean),
  matched(['git'], 'Delete local branch', isGitBranchDelete)
]

const PACKAGE_PUBLISH_RULES: CommandRule[] = [
  matched(['npm'], 'Publish npm package', hasSubcommand('publish')),
  matched(['pnpm'], 'Publish npm package', hasSubcommand('publish')),
  matched(['bun'], 'Publish package', hasSubcommand('publish')),
  matched(['yarn'], 'Publish npm package', hasSubcommand('npm', 'publish'))
]

const DEPLOY_RULES: CommandRule[] = [
  exact(['vercel'], 'Deploy with Vercel'),
  matched(['netlify'], 'Deploy with Netlify', hasSubcommand('deploy')),
  matched(['firebase'], 'Deploy with Firebase', hasSubcommand('deploy')),
  matched(['fly'], 'Deploy with Fly.io', hasSubcommand('deploy')),
  matched(['wrangler'], 'Deploy with Wrangler', hasAnySubcommand(['deploy', 'publish']))
]

const EXECUTION_SURFACE_RULES: CommandRule[] = [
  matched(['bash'], 'Run shell command string', isShellCommandString),
  matched(['sh'], 'Run shell command string', isShellCommandString),
  matched(['zsh'], 'Run shell command string', isShellCommandString),
  matched(['eval'], 'Run shell eval', () => true),
  matched(['source'], 'Source shell script', () => true),
  matched(['.'], 'Source shell script', () => true),
  matched(['alias'], 'Define shell alias', () => true),
  matched(['find'], 'Run find -exec command', hasAnySubcommand(['-exec', '-execdir'])),
  matched(['xargs'], 'Run xargs protected command', isXargsProtectedCommand)
]

const RULE_GROUPS = {
  github: GITHUB_RULES,
  gitlab: GITLAB_RULES,
  gmail: GMAIL_RULES,
  twitter: TWITTER_RULES,
  git: GIT_RULES,
  publish: PACKAGE_PUBLISH_RULES,
  deploy: DEPLOY_RULES,
  execution: EXECUTION_SURFACE_RULES
} satisfies Record<string, CommandRule[]>

type RuleGroupName = keyof typeof RULE_GROUPS

type ConfirmActionGroups = Partial<Record<RuleGroupName, boolean>>

export const DEFAULT_COMMAND_RULES: CommandRule[] = buildDefaultCommandRules()

export function buildDefaultCommandRules(groups: ConfirmActionGroups = {}): CommandRule[] {
  return Object.entries(RULE_GROUPS).flatMap(([name, rules]) =>
    groups[name as RuleGroupName] === false ? [] : rules
  )
}

function exact(argv: string[], label: string): CommandRule {
  return { argv, label }
}

function matched(
  argv: string[],
  label: string,
  matches: NonNullable<CommandRule['matches']>
): CommandRule {
  return { argv, label, matches }
}

const PREFIX_WRAPPERS = new Set(['sudo', 'command', 'env', 'noglob'])
const DYNAMIC_COMMAND_RULE = exact(
  ['<dynamic>'],
  'Run shell command with dynamic protected-tool arguments'
)
const DYNAMIC_COMMAND_NAME_RULE = exact(['<dynamic-command-name>'], 'Run dynamic shell command')
const PARSE_ERROR_RULE = exact(['<parse-error>'], 'Run unparsable shell command')

export default function (pi: ExtensionAPI) {
  let commandRules = DEFAULT_COMMAND_RULES

  pi.on('session_start', (_event, ctx) => {
    commandRules = loadCommandRules(ctx.cwd, ctx.isProjectTrusted())
  })

  pi.on('tool_call', async (event, ctx) => {
    if (!isToolCallEventType('bash', event)) return

    const command = event.input.command
    const match = matchCommandRule(command, commandRules)
    if (!match) return

    if (!ctx.hasUI) {
      return { block: true, reason: `${match.label} blocked (no UI for confirmation)` }
    }

    notifyDesktop(notificationTitle(ctx.cwd), `Approve: ${match.label}`)

    const confirmed = await ctx.ui.confirm(
      `${match.label}?`,
      'Review the command before submitting.'
    )

    if (!confirmed) {
      ctx.ui.notify(`${match.label} cancelled`, 'info')
      return { block: true, reason: `User cancelled: ${match.label}` }
    }
  })

  pi.on('session_before_switch', async (event: SessionBeforeSwitchEvent, ctx) => {
    if (!ctx.hasUI) return

    if (event.reason === 'new') {
      notifyDesktop(notificationTitle(ctx.cwd), 'Approve: clear current session')

      const confirmed = await ctx.ui.confirm(
        'Clear session?',
        'This will delete all messages in the current session.'
      )

      if (!confirmed) {
        ctx.ui.notify('Clear cancelled', 'info')
        return { cancel: true }
      }
      return
    }

    const entries = ctx.sessionManager.getEntries()
    const hasUnsavedWork = entries.some(
      (e): e is SessionMessageEntry => e.type === 'message' && e.message.role === 'user'
    )

    if (hasUnsavedWork) {
      notifyDesktop(notificationTitle(ctx.cwd), 'Approve: switch session')

      const confirmed = await ctx.ui.confirm(
        'Switch session?',
        'You have messages in the current session. Switch anyway?'
      )

      if (!confirmed) {
        ctx.ui.notify('Switch cancelled', 'info')
        return { cancel: true }
      }
    }
  })

  pi.on('session_before_fork', async (event, ctx) => {
    if (!ctx.hasUI) return

    notifyDesktop(notificationTitle(ctx.cwd), `Approve: fork from ${event.entryId.slice(0, 8)}`)

    const choice = await ctx.ui.select(`Fork from entry ${event.entryId.slice(0, 8)}?`, [
      'Yes, create fork',
      'No, stay in current session'
    ])

    if (choice !== 'Yes, create fork') {
      ctx.ui.notify('Fork cancelled', 'info')
      return { cancel: true }
    }
  })
}

export function matchCommandRule(command: string, rules: CommandRule[]): CommandRule | undefined {
  const parsed = parseCommand(command)
  if (parsed.parseFailed) return PARSE_ERROR_RULE

  for (const invocation of parsed.invocations) {
    const normalized = normalizeInvocation(invocation.argv)
    const match = rules.find((rule) => {
      const comparable = normalizeToolInvocation(normalized, rule.argv)
      return startsWithArgv(comparable, rule.argv) && (rule.matches?.(comparable) ?? true)
    })
    if (match) return match

    if (invocation.dynamicName) return DYNAMIC_COMMAND_NAME_RULE
    if (invocation.dynamic && isProtectedToolInvocation(normalized)) return DYNAMIC_COMMAND_RULE
  }
}

export function parseInvocations(command: string): string[][] {
  return parseCommand(command).invocations.map((invocation) => invocation.argv)
}

type ParsedInvocation = {
  argv: string[]
  dynamic: boolean
  dynamicName: boolean
}

type ParsedCommand = {
  invocations: ParsedInvocation[]
  parseFailed: boolean
}

function parseCommand(command: string): ParsedCommand {
  try {
    const script = parseShell(command)
    return {
      invocations: collectInvocationsFromScript(script),
      parseFailed: Boolean(script.errors?.length)
    }
  } catch {
    return { invocations: [], parseFailed: true }
  }
}

function collectInvocationsFromScript(script: Script | undefined): ParsedInvocation[] {
  if (!script) return []
  return script.commands.flatMap((statement) => collectInvocationsFromNode(statement))
}

function collectInvocationsFromNode(node: Node | undefined): ParsedInvocation[] {
  if (!node) return []

  switch (node.type) {
    case 'Statement':
      return [
        ...collectInvocationsFromNode(node.command),
        ...collectInvocationsFromRedirects(node.redirects)
      ]
    case 'Command': {
      const words = [node.name, ...node.suffix].filter((word): word is Word => Boolean(word))
      const argv = words.map((word) => word.value)
      return [
        ...(argv.length > 0
          ? [
              {
                argv,
                dynamic: words.some((word) => !isStaticWord(word)),
                dynamicName: Boolean(node.name && !isStaticWord(node.name))
              }
            ]
          : []),
        ...words.flatMap(collectInvocationsFromWord),
        ...node.prefix.flatMap((assignment) => collectInvocationsFromWord(assignment.value)),
        ...collectInvocationsFromRedirects(node.redirects)
      ]
    }
    case 'Pipeline':
    case 'AndOr':
      return node.commands.flatMap((command) => collectInvocationsFromNode(command))
    case 'If':
      return [
        ...collectInvocationsFromNode(node.clause),
        ...collectInvocationsFromNode(node.then),
        ...collectInvocationsFromNode(node.else)
      ]
    case 'For':
      return [
        ...collectInvocationsFromWord(node.name),
        ...node.wordlist.flatMap(collectInvocationsFromWord),
        ...collectInvocationsFromNode(node.body)
      ]
    case 'ArithmeticFor':
      return [
        ...collectInvocationsFromArithmetic(node.initialize),
        ...collectInvocationsFromArithmetic(node.test),
        ...collectInvocationsFromArithmetic(node.update),
        ...collectInvocationsFromNode(node.body)
      ]
    case 'Select':
      return [
        ...collectInvocationsFromWord(node.name),
        ...node.wordlist.flatMap(collectInvocationsFromWord),
        ...collectInvocationsFromNode(node.body)
      ]
    case 'While':
      return [...collectInvocationsFromNode(node.clause), ...collectInvocationsFromNode(node.body)]
    case 'Function':
      return [
        ...collectInvocationsFromWord(node.name),
        ...collectInvocationsFromNode(node.body),
        ...collectInvocationsFromRedirects(node.redirects)
      ]
    case 'Subshell':
    case 'BraceGroup':
      return collectInvocationsFromNode(node.body)
    case 'CompoundList':
      return node.commands.flatMap((statement) => collectInvocationsFromNode(statement))
    case 'Case':
      return [
        ...collectInvocationsFromWord(node.word),
        ...node.items.flatMap((item) => [
          ...item.pattern.flatMap(collectInvocationsFromWord),
          ...collectInvocationsFromNode(item.body)
        ])
      ]
    case 'Coproc':
      return [
        ...collectInvocationsFromWord(node.name),
        ...collectInvocationsFromNode(node.body),
        ...collectInvocationsFromRedirects(node.redirects)
      ]
    case 'TestCommand':
      return collectInvocationsFromTestExpression(node.expression)
    case 'ArithmeticCommand':
      return collectInvocationsFromArithmetic(node.expression)
  }
}

function collectInvocationsFromRedirects(
  redirects: { target?: Word; body?: Word }[]
): ParsedInvocation[] {
  return redirects.flatMap((redirect) => [
    ...collectInvocationsFromWord(redirect.target),
    ...collectInvocationsFromWord(redirect.body)
  ])
}

function collectInvocationsFromWord(word: Word | undefined): ParsedInvocation[] {
  if (!word?.parts) return []
  return word.parts.flatMap(collectInvocationsFromWordPart)
}

function collectInvocationsFromWordPart(part: WordPart): ParsedInvocation[] {
  switch (part.type) {
    case 'CommandExpansion':
    case 'ProcessSubstitution':
      return collectInvocationsFromScript(part.script)
    case 'ArithmeticExpansion':
      return collectInvocationsFromArithmetic(part.expression)
    case 'DoubleQuoted':
    case 'LocaleString':
      return part.parts.flatMap(collectInvocationsFromWordPart)
    case 'ParameterExpansion':
      return [
        ...collectInvocationsFromWord(part.operand),
        ...collectInvocationsFromWord(part.slice?.offset),
        ...collectInvocationsFromWord(part.slice?.length),
        ...collectInvocationsFromWord(part.replace?.pattern),
        ...collectInvocationsFromWord(part.replace?.replacement)
      ]
    default:
      return []
  }
}

function collectInvocationsFromArithmetic(
  expression: ArithmeticExpression | undefined
): ParsedInvocation[] {
  if (!expression) return []

  switch (expression.type) {
    case 'ArithmeticCommandExpansion':
      return collectInvocationsFromScript(expression.script)
    case 'ArithmeticBinary':
      return [
        ...collectInvocationsFromArithmetic(expression.left),
        ...collectInvocationsFromArithmetic(expression.right)
      ]
    case 'ArithmeticUnary':
      return collectInvocationsFromArithmetic(expression.operand)
    case 'ArithmeticTernary':
      return [
        ...collectInvocationsFromArithmetic(expression.test),
        ...collectInvocationsFromArithmetic(expression.consequent),
        ...collectInvocationsFromArithmetic(expression.alternate)
      ]
    case 'ArithmeticGroup':
      return collectInvocationsFromArithmetic(expression.expression)
    case 'ArithmeticWord':
      return []
  }
}

function collectInvocationsFromTestExpression(expression: unknown): ParsedInvocation[] {
  if (!expression || typeof expression !== 'object') return []

  const invocations: ParsedInvocation[] = []
  for (const value of Object.values(expression)) {
    if (isWord(value)) invocations.push(...collectInvocationsFromWord(value))
    else if (Array.isArray(value)) {
      for (const item of value) invocations.push(...collectInvocationsFromTestExpression(item))
    } else if (value && typeof value === 'object') {
      invocations.push(...collectInvocationsFromTestExpression(value))
    }
  }
  return invocations
}

function isStaticWord(word: Word): boolean {
  return !word.parts || word.parts.every(isStaticWordPart)
}

function isStaticWordPart(part: WordPart): boolean {
  switch (part.type) {
    case 'Literal':
    case 'SingleQuoted':
    case 'AnsiCQuoted':
      return true
    case 'DoubleQuoted':
    case 'LocaleString':
      return part.parts.every(isStaticWordPart)
    default:
      return false
  }
}

function isWord(value: unknown): value is Word {
  return Boolean(
    value &&
    typeof value === 'object' &&
    'text' in value &&
    'value' in value &&
    typeof (value as Word).text === 'string'
  )
}

function isProtectedToolInvocation(argv: string[]): boolean {
  const command = argv[0]
  return Boolean(
    command &&
    ['git', 'gh', 'glab', 'gws', 'bird', 'bunx', 'npm', 'pnpm', 'bun', 'yarn'].includes(command)
  )
}

function normalizeInvocation(argv: string[]): string[] {
  let rest = dropAssignments(argv)

  while (rest.length > 0 && PREFIX_WRAPPERS.has(rest[0] ?? '')) {
    const wrapper = rest[0]
    rest = rest.slice(1)

    if (wrapper === 'sudo' || wrapper === 'env') {
      rest = dropFlagsAndAssignments(rest)
    }
  }

  return rest
}

function normalizeToolInvocation(argv: string[], ruleArgv: string[]): string[] {
  const tool = ruleArgv[0]
  if (tool !== 'gh' && tool !== 'glab') return argv
  if (argv[0] !== tool) return argv

  return [tool, ...dropCliGlobalOptions(argv.slice(1))]
}

function dropCliGlobalOptions(argv: string[]): string[] {
  let index = 0
  while (index < argv.length) {
    const arg = argv[index] ?? ''
    if (!isFlag(arg)) break
    if (arg === '--') return argv.slice(index + 1)
    index += cliGlobalFlagConsumesValue(arg) ? 2 : 1
  }
  return argv.slice(index)
}

function cliGlobalFlagConsumesValue(arg: string): boolean {
  return ['-R', '--repo', '--hostname', '--config'].includes(arg)
}

function dropAssignments(argv: string[]): string[] {
  const index = argv.findIndex((arg) => !isAssignment(arg))
  return index === -1 ? [] : argv.slice(index)
}

function dropFlagsAndAssignments(argv: string[]): string[] {
  let index = 0
  while (index < argv.length) {
    const arg = argv[index] ?? ''
    if (isAssignment(arg)) {
      index += 1
      continue
    }
    if (!isFlag(arg)) break

    index += flagConsumesValue(arg) ? 2 : 1
  }
  return argv.slice(index)
}

function flagConsumesValue(arg: string): boolean {
  return ['-u', '-g', '-h', '-p', '-C', '-c', '--user', '--group', '--host', '--prompt'].includes(
    arg
  )
}

function startsWithArgv(argv: string[], prefix: string[]): boolean {
  return prefix.length > 0 && prefix.every((part, index) => argv[index] === part)
}

function isMutatingGhApi(argv: string[]): boolean {
  const method = getOptionValue(argv, ['--method', '-X'])?.toUpperCase()
  if (method && method !== 'GET') return true
  if (method === 'GET') return false

  return argv.some((arg) => ['--field', '-f', '--raw-field', '-F'].includes(arg))
}

function isMutatingGhSubcommand(argv: string[]): boolean {
  return argv.some((arg) => ['add', 'delete', 'remove'].includes(arg))
}

function isMutatingGmail(argv: string[]): boolean {
  if (hasAnyFlag(argv, ['--dry-run'])) return false

  return argv.some((arg) =>
    [
      '+send',
      '+reply',
      '+reply-all',
      '+forward',
      'send',
      'import',
      'insert',
      'trash',
      'untrash',
      'delete',
      'batchDelete',
      'modify',
      'batchModify',
      'create',
      'update',
      'patch'
    ].includes(arg)
  )
}

function isMutatingBird(argv: string[]): boolean {
  return argv.some((arg) =>
    [
      'tweet',
      'reply',
      'delete',
      'like',
      'unlike',
      'retweet',
      'unretweet',
      'bookmark',
      'unbookmark',
      'follow',
      'unfollow'
    ].includes(arg)
  )
}

function isGitForcePush(argv: string[]): boolean {
  return (
    getGitSubcommand(argv) === 'push' && hasAnyFlag(argv, ['--force', '--force-with-lease', '-f'])
  )
}

function isGitRemoteBranchDelete(argv: string[]): boolean {
  return (
    getGitSubcommand(argv) === 'push' && (argv.includes('--delete') || argv.some(isDeleteRefspec))
  )
}

function isGitPush(argv: string[]): boolean {
  return getGitSubcommand(argv) === 'push'
}

function isGitHardReset(argv: string[]): boolean {
  return getGitSubcommand(argv) === 'reset' && hasAnyFlag(argv, ['--hard'])
}

function isGitForcedClean(argv: string[]): boolean {
  return getGitSubcommand(argv) === 'clean' && hasAnyFlag(argv, ['-f', '--force'])
}

function isGitBranchDelete(argv: string[]): boolean {
  return getGitSubcommand(argv) === 'branch' && hasAnyFlag(argv, ['-d', '-D', '--delete'])
}

function isShellCommandString(argv: string[]): boolean {
  return argv.some((arg) => arg === '-c' || arg.startsWith('-c') || hasFlag(arg, '-c'))
}

function isXargsProtectedCommand(argv: string[]): boolean {
  const commandIndex = findXargsCommandIndex(argv)
  if (commandIndex === -1) return false
  return isProtectedToolInvocation(argv.slice(commandIndex))
}

function findXargsCommandIndex(argv: string[]): number {
  let index = 1
  while (index < argv.length) {
    const arg = argv[index] ?? ''
    if (arg === '--') return index + 1 < argv.length ? index + 1 : -1
    if (!isFlag(arg)) return index
    index += flagConsumesValue(arg) || xargsFlagConsumesValue(arg) ? 2 : 1
  }
  return -1
}

function xargsFlagConsumesValue(arg: string): boolean {
  return [
    '-a',
    '--arg-file',
    '-d',
    '--delimiter',
    '-E',
    '-I',
    '--replace',
    '-i',
    '-L',
    '--max-lines',
    '-l',
    '-n',
    '--max-args',
    '-P',
    '--max-procs',
    '-s',
    '--max-chars'
  ].includes(arg)
}

function getGitSubcommand(argv: string[]): string | undefined {
  let index = 1
  while (index < argv.length) {
    const arg = argv[index] ?? ''
    if (isAssignment(arg)) {
      index += 1
      continue
    }
    if (!isFlag(arg)) return arg
    index += flagConsumesValue(arg) ? 2 : 1
  }
}

function hasSubcommand(...subcommand: string[]): (argv: string[]) => boolean {
  return (argv) => findSubcommandIndex(argv, subcommand) !== -1
}

function hasAnySubcommand(subcommands: string[]): (argv: string[]) => boolean {
  return (argv) => subcommands.some((subcommand) => findSubcommandIndex(argv, [subcommand]) !== -1)
}

function findSubcommandIndex(argv: string[], subcommand: string[]): number {
  for (let index = 1; index <= argv.length - subcommand.length; index += 1) {
    if (subcommand.every((part, offset) => argv[index + offset] === part)) return index
  }
  return -1
}

function hasAnyFlag(argv: string[], flags: string[]): boolean {
  return argv.some((arg) => flags.some((flag) => hasFlag(arg, flag)))
}

function hasFlag(arg: string, flag: string): boolean {
  if (arg === flag || arg.startsWith(`${flag}=`)) return true
  return /^-[A-Za-z]+$/.test(arg) && /^-[A-Za-z]$/.test(flag) && arg.includes(flag.slice(1))
}

function isDeleteRefspec(arg: string): boolean {
  return /^:[^:]+/.test(arg)
}

function getOptionValue(argv: string[], names: string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? ''
    for (const name of names) {
      if (arg === name) return argv[index + 1]
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1)
    }
  }
}

function isAssignment(arg: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(arg)
}

function isFlag(arg: string): boolean {
  return arg.startsWith('-') && arg !== '-'
}

function loadCommandRules(cwd: string, projectTrusted: boolean): CommandRule[] {
  const settings = readLayeredSettings(cwd, { projectTrusted })
  const groups = Object.assign({}, ...settings.map((item) => readConfirmActionGroups(item)))
  const customRules = settings.flatMap(readCommandRules)

  return [...buildDefaultCommandRules(groups), ...customRules]
}

function readConfirmActionGroups(settings: Record<string, unknown>): ConfirmActionGroups {
  if (!settings.confirmActionGroups || typeof settings.confirmActionGroups !== 'object') return {}

  const groups: ConfirmActionGroups = {}
  for (const [name, enabled] of Object.entries(settings.confirmActionGroups)) {
    if (name in RULE_GROUPS && typeof enabled === 'boolean') {
      groups[name as RuleGroupName] = enabled
    }
  }
  return groups
}

function readCommandRules(settings: Record<string, unknown>): CommandRule[] {
  const value = settings.confirmCommands
  if (!Array.isArray(value)) return []

  return value.flatMap((item) => parseRule(item))
}

function parseRule(item: unknown): CommandRule[] {
  if (!item || typeof item !== 'object') return []

  const rule = item as { argv?: unknown; command?: unknown; label?: unknown }
  const argv = Array.isArray(rule.argv)
    ? rule.argv.filter((part): part is string => typeof part === 'string' && part.length > 0)
    : typeof rule.command === 'string'
      ? rule.command.trim().split(/\s+/)
      : []

  if (argv.length === 0 || typeof rule.label !== 'string' || rule.label.length === 0) return []
  return [{ argv, label: rule.label }]
}

function notificationTitle(cwd: string): string {
  return formatPiNotificationTitle(cwd)
}
