import { apiErrorMessage, env, fetchText, requireEnv } from '../../shared/http'
import type { ExaSearchRequest, WebSearchBackend, WebSearchResult } from '../shared/types'

const DATE_UNSUPPORTED_CATEGORIES = new Set(['company', 'people'])
const EXCLUDE_DOMAINS_UNSUPPORTED_CATEGORIES = new Set(['company', 'people'])
const DEFAULT_NUM_RESULTS = 8
const DEFAULT_CONTEXT_MAX = 10000

interface ExaSearchResponse {
  results?: Array<Record<string, unknown>>
  output?: { content?: unknown }
}

function getBaseUrl(): string {
  return env('EXA_ENDPOINT_URL') || 'https://api.exa.ai'
}

function compactRequestValue(value: unknown): unknown {
  if (value === undefined) return undefined
  if (typeof value === 'string' && value.trim() === '') return undefined

  if (Array.isArray(value)) {
    const entries = value.map(compactRequestValue).filter((entry) => entry !== undefined)
    return entries.length > 0 ? entries : undefined
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, compactRequestValue(entry)] as const)
      .filter(([, entry]) => entry !== undefined)
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }

  return value
}

function cleanObject(value: Record<string, unknown>): Record<string, unknown> {
  return (compactRequestValue(value) as Record<string, unknown> | undefined) ?? {}
}

function formatSynthesis(output: unknown): string | undefined {
  if (typeof output === 'string') return output
  if (output === undefined || output === null) return undefined
  return JSON.stringify(output, null, 2)
}

export function buildExaSearchRequest(
  params: Partial<ExaSearchRequest> & { numResults?: number }
): Record<string, unknown> {
  const contents = cleanObject({
    text: cleanObject({
      maxCharacters: params.contextMaxCharacters ?? DEFAULT_CONTEXT_MAX,
      includeHtmlTags: params.includeHtmlTags,
      verbosity: params.textVerbosity,
      includeSections: params.includeSections,
      excludeSections: params.excludeSections
    }),
    highlights:
      params.highlights === true ? true : params.highlights ? params.highlights : undefined,
    summary: params.summary,
    maxAgeHours: params.maxAgeHours,
    livecrawlTimeout: params.livecrawlTimeout
  })

  const category = params.category
  const request = cleanObject({
    query: params.query,
    numResults: params.maxResults ?? params.numResults ?? DEFAULT_NUM_RESULTS,
    type: params.type ?? 'auto',
    category,
    userLocation: params.userLocation,
    includeDomains: params.includeDomains,
    includeText: params.includeText,
    excludeText: params.excludeText,
    moderation: params.moderation,
    additionalQueries: params.additionalQueries,
    systemPrompt: params.systemPrompt,
    outputSchema: params.outputSchema,
    contents
  })

  if (!category || !EXCLUDE_DOMAINS_UNSUPPORTED_CATEGORIES.has(category)) {
    request.excludeDomains = params.excludeDomains
  }
  if (!category || !DATE_UNSUPPORTED_CATEGORIES.has(category)) {
    request.startPublishedDate = params.startPublishedDate
    request.endPublishedDate = params.endPublishedDate
  }

  return cleanObject(request)
}

function normalizeResult(result: Record<string, unknown>): WebSearchResult {
  return {
    title: (result.title as string) || 'Untitled',
    url: result.url as string,
    author: (result.author as string) || undefined,
    publishedDate: (result.publishedDate as string) || undefined,
    text: (result.text as string) || '',
    highlights: (result.highlights as string[]) || undefined,
    summary: (result.summary as string) || undefined
  }
}

export const exaSearchBackend = {
  id: 'exa',

  async search(params, signal) {
    const apiKey = requireEnv('EXA_API_KEY')
    if (!apiKey.ok) throw new Error(apiKey.message)

    const response = await fetchText(
      `${getBaseUrl()}/search`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey.value
        },
        body: JSON.stringify(buildExaSearchRequest(params))
      },
      { signal, timeoutMs: 60_000 }
    )

    if (!response.ok) throw new Error(apiErrorMessage(response.status, response.text))

    const data = JSON.parse(response.text) as ExaSearchResponse
    return {
      backend: 'exa',
      results: (data.results ?? []).map(normalizeResult),
      output: formatSynthesis(data.output?.content)
    }
  }
} satisfies WebSearchBackend<'exa'>
