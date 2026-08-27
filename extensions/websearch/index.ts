/**
 * Web Search Extension
 *
 * Searches the web using Exa AI API.
 * Requires EXA_API_KEY environment variable.
 */

import { type ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { errorMessage } from '../shared/errors'
import type { ToolStatusDetails, TruncatedOutputDetails } from '../shared/tool-details'
import { buildExaSearchRequest } from '../web/backends/exa-search'
import { getSearchBackend } from '../web/shared/registry'
import type { ExaSearchRequest, WebSearchResult } from '../web/shared/types'
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHeadText
} from '../shared/truncate'
import {
  meta as renderMeta,
  primary,
  renderEntryList,
  renderErrorOrPartial,
  renderLines,
  renderMuted,
  renderToolCall,
  title,
  toolError,
  toolLoading,
  toolText,
  truncateText
} from '../shared/render'
import { Type } from 'typebox'

export { buildExaSearchRequest }

interface WebSearchDetails extends ToolStatusDetails, TruncatedOutputDetails {
  query: string
  results: WebSearchResult[]
  output?: string
}

type WebSearchLoadingDetails = WebSearchDetails & Required<Pick<ToolStatusDetails, 'loading'>>

function webSearchDetails(
  query: string,
  results: WebSearchResult[] = [],
  output?: string
): WebSearchDetails {
  return { query, results, output }
}

function webSearchErrorDetails(query: string): WebSearchDetails {
  return { query, results: [], error: true }
}

function webSearchLoadingDetails(query: string): WebSearchLoadingDetails {
  return { query, results: [], loading: true }
}

const DESCRIPTION = `Search the web using Exa AI - performs real-time web searches and returns content from relevant websites.

Usage notes:
- Provides up-to-date information beyond knowledge cutoff
- Search types: 'auto' (default), 'instant' (lowest latency), 'fast' (low latency), 'deep-lite', 'deep', 'deep-reasoning'
- For deep search variants, provide additionalQueries with query variations for better results
- sourceType is an optional source-type filter. Omit it for broad web search; use it only when the requested source type clearly matches one of the supported values.
- Do not combine a sourceType with domains or filters that the API does not support for that source type.
- For source-specific discovery, prefer includeDomains and precise query terms.
- Filter by domains (includeDomains/excludeDomains), text content (includeText/excludeText), and date ranges where supported
- Control content freshness with maxAgeHours (0=always fresh, 24=accept 24h cache, -1=cache only, omit=default)
- Prefer highlights for agent workflows; use full text only when needed and cap contextMaxCharacters
- Tool output is truncated to ${DEFAULT_MAX_LINES} lines or ${formatSize(DEFAULT_MAX_BYTES)}
- Use systemPrompt and outputSchema only when you need synthesized/structured output; they can increase latency and cost`

const WebSearchParams = Type.Object({
  query: Type.String({ description: 'Web search query' }),
  additionalQueries: Type.Optional(
    Type.Array(Type.String(), {
      minItems: 1,
      maxItems: 10,
      description:
        "Query variations for deep search. Only works with type='deep'. Provide 2-5 alternative phrasings for comprehensive results."
    })
  ),
  numResults: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 100,
      description: 'Number of search results to return (default: 10, max: 100)'
    })
  ),
  type: Type.Optional(
    Type.Union(
      [
        Type.Literal('auto'),
        Type.Literal('instant'),
        Type.Literal('fast'),
        Type.Literal('deep-lite'),
        Type.Literal('deep'),
        Type.Literal('deep-reasoning')
      ],
      {
        description:
          "Search type - 'auto' default, 'instant' lowest latency, 'fast' low latency, 'deep-lite' lightweight synthesis, 'deep' multi-step search, 'deep-reasoning' maximum reasoning"
      }
    )
  ),
  sourceType: Type.Optional(
    Type.Union(
      [
        Type.Literal('general'),
        Type.Literal('publication'),
        Type.Literal('company'),
        Type.Literal('news'),
        Type.Literal('people'),
        Type.Literal('personal_site'),
        Type.Literal('financial_report')
      ],
      {
        description:
          'Optional source-type filter. Use general for broad search; otherwise choose the source type that matches the request.'
      }
    )
  ),
  includeDomains: Type.Optional(
    Type.Array(Type.String(), {
      maxItems: 1200,
      description:
        "Only return results from these domains (max 1200; e.g. ['arxiv.org', 'github.com'])"
    })
  ),
  excludeDomains: Type.Optional(
    Type.Array(Type.String(), {
      maxItems: 1200,
      description: 'Exclude results from these domains (max 1200)'
    })
  ),
  includeText: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Strings that must appear in result text (1 string, up to 5 words)'
    })
  ),
  excludeText: Type.Optional(
    Type.Array(Type.String(), {
      description: 'Strings that must not appear in result text (1 string, up to 5 words)'
    })
  ),
  startPublishedDate: Type.Optional(
    Type.Union([Type.Literal(''), Type.String({ format: 'date-time' })], {
      description:
        "Only results published after this date (ISO 8601, e.g. '2025-01-01T00:00:00.000Z')"
    })
  ),
  endPublishedDate: Type.Optional(
    Type.Union([Type.Literal(''), Type.String({ format: 'date-time' })], {
      description: 'Only results published before this date (ISO 8601)'
    })
  ),
  maxAgeHours: Type.Optional(
    Type.Integer({
      minimum: -1,
      maximum: 720,
      description: 'Max age of cached content in hours. 0=always fresh, -1=cache only, omit=default'
    })
  ),
  highlights: Type.Optional(
    Type.Union([
      Type.Boolean({
        description:
          'Return relevant text snippets from each page. Prefer true for agent workflows.'
      }),
      Type.Object({
        query: Type.Optional(
          Type.String({ description: 'Custom query guiding highlight selection' })
        ),
        maxCharacters: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 }))
      })
    ])
  ),
  summary: Type.Optional(
    Type.Union([
      Type.Boolean({ description: 'Return LLM-generated summary for each page' }),
      Type.Object({
        query: Type.Optional(Type.String({ description: 'Custom query for summary generation' })),
        schema: Type.Optional(
          Type.Any({ description: 'JSON schema for structured summary output' })
        )
      })
    ])
  ),
  contextMaxCharacters: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 10000,
      description: 'Maximum full-text characters per result (default: 10000)'
    })
  ),
  includeHtmlTags: Type.Optional(
    Type.Boolean({ description: 'Preserve HTML tags in returned full text (default: false)' })
  ),
  textVerbosity: Type.Optional(
    Type.Union([Type.Literal('compact'), Type.Literal('standard'), Type.Literal('full')], {
      description: 'Full-text verbosity. Use maxAgeHours: 0 for fresh section-aware content.'
    })
  ),
  includeSections: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal('header'),
        Type.Literal('navigation'),
        Type.Literal('banner'),
        Type.Literal('body'),
        Type.Literal('sidebar'),
        Type.Literal('footer'),
        Type.Literal('metadata')
      ]),
      { description: 'Only include content from these page sections' }
    )
  ),
  excludeSections: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal('header'),
        Type.Literal('navigation'),
        Type.Literal('banner'),
        Type.Literal('body'),
        Type.Literal('sidebar'),
        Type.Literal('footer'),
        Type.Literal('metadata')
      ]),
      { description: 'Exclude content from these page sections' }
    )
  ),
  livecrawlTimeout: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 90000,
      description: 'Timeout for livecrawling in milliseconds (default: 10000)'
    })
  ),
  moderation: Type.Optional(Type.Boolean({ description: 'Filter unsafe content from results' })),
  systemPrompt: Type.Optional(
    Type.String({ description: 'Instructions guiding synthesized output and deep-search planning' })
  ),
  outputSchema: Type.Optional(
    Type.Object(
      {
        type: Type.Union([Type.Literal('text'), Type.Literal('object')]),
        description: Type.Optional(Type.String()),
        properties: Type.Optional(Type.Record(Type.String(), Type.Any())),
        required: Type.Optional(Type.Array(Type.String())),
        additionalProperties: Type.Optional(Type.Boolean())
      },
      { description: 'JSON schema for synthesized output; root type must be text or object' }
    )
  ),
  userLocation: Type.Optional(
    Type.String({
      description: "Two-letter ISO country code to bias results geographically (e.g. 'US')"
    })
  )
})

const PREVIEW_TEXT_LENGTH = 220
function formatResultsAsText(results: WebSearchResult[], output?: string): string {
  const resultText = results
    .map((r) => {
      let header = `Title: ${r.title}\nURL: ${r.url}`
      if (r.author) header += `\nAuthor: ${r.author}`
      if (r.publishedDate) header += `\nDate: ${r.publishedDate}`

      let body = ''
      if (r.summary) body += `\nSummary: ${r.summary}`
      if (r.highlights?.length)
        body += `\nHighlights:\n${r.highlights.map((h) => `- ${h}`).join('\n')}`
      if (r.text) body += `\n\n${r.text}`

      return `${header}${body}`
    })
    .join('\n\n---\n\n')

  return output ? `Synthesized output:\n${output}\n\n---\n\n${resultText}` : resultText
}

function toExaSearchRequest(params: Record<string, unknown>): ExaSearchRequest {
  return {
    ...(params as Omit<ExaSearchRequest, 'backend' | 'maxResults'>),
    backend: 'exa',
    maxResults: params.numResults as number | undefined
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'websearch',
    label: 'Web Search',
    description: DESCRIPTION,
    parameters: WebSearchParams,

    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const { query } = params

      onUpdate?.(toolLoading(webSearchLoadingDetails(query)))

      try {
        const backend = getSearchBackend('exa')
        const response = await backend.search(toExaSearchRequest(params), signal)
        const { results, output } = response

        if (signal?.aborted) {
          return toolText('Search cancelled', webSearchDetails(query))
        }

        if (results.length === 0 && !output) {
          return toolText(
            'No search results found. Try a different query.',
            webSearchDetails(query)
          )
        }

        const formatted = formatResultsAsText(results, output)
        const truncated = truncateHeadText(formatted, {
          notice: (truncation) => {
            if (truncation.firstLineExceedsLimit) {
              return `[First result line exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use highlights or lower contextMaxCharacters.]`
            }
            return `[Search output truncated: showing ${truncation.outputLines} of ${truncation.totalLines} lines. Use fewer results, highlights, or lower contextMaxCharacters.]`
          }
        })

        return toolText(truncated.text, {
          ...webSearchDetails(query, results, output),
          truncation: truncated.truncation
        } satisfies WebSearchDetails)
      } catch (err) {
        return toolError(errorMessage(err), webSearchErrorDetails(query))
      }
    },

    renderCall(params, theme) {
      const args = params ?? {}
      return renderToolCall(theme, 'web', {
        segments: [{ text: args.query }],
        tags: [
          args.type && args.type !== 'auto' ? args.type : undefined,
          args.sourceType !== 'general' ? args.sourceType : undefined
        ],
        suffix: args.numResults ? `${args.numResults} results` : undefined
      })
    },

    renderResult(result, { expanded, isPartial }, theme) {
      const details = result.details as WebSearchDetails | undefined

      const guarded = renderErrorOrPartial(result, details, { isPartial }, theme)
      if (guarded) return guarded

      const results = details?.results ?? []

      if (results.length === 0) {
        return details?.output
          ? renderLines([primary(details.output, theme)])
          : renderMuted('No results found.', theme)
      }

      let textHidden = false

      return renderEntryList(results, theme, {
        expanded,
        compactLimit: 1,
        renderEntry: (r) => {
          let metadata = renderMeta(theme.underline(r.url), theme)
          if (r.author) metadata += renderMeta(` · ${r.author}`, theme)
          if (r.publishedDate) metadata += renderMeta(` · ${r.publishedDate.split('T')[0]}`, theme)

          const body: string[] = []
          const previewText = r.summary || r.highlights?.[0]
          if (expanded) {
            if (r.summary) body.push(renderMeta('Summary: ', theme) + primary(r.summary, theme))
            if (r.text) body.push(primary(r.text, theme))
          } else if (previewText) {
            textHidden = previewText.length > PREVIEW_TEXT_LENGTH || Boolean(r.text)
            body.push(primary(truncateText(previewText, PREVIEW_TEXT_LENGTH), theme))
          } else if (r.text) {
            textHidden = true
          }

          return { header: title(r.title, theme), metadata, body }
        },
        hiddenLines: (hiddenResults) => {
          if (hiddenResults > 0) return [renderMeta(`… ${hiddenResults} more results`, theme)]
          return textHidden ? [renderMeta('… more text', theme)] : []
        }
      })
    }
  })
}
