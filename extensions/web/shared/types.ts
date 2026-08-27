export type ExaSourceType =
  | 'general'
  | 'publication'
  | 'company'
  | 'news'
  | 'people'
  | 'personal_site'
  | 'financial_report'
export interface ExaOutputSchema {
  type: 'text' | 'object'
  description?: string
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export type SearchBackendId = 'exa'

export type FetchBackendId = 'local'

export interface CommonSearchRequest {
  query: string
  maxResults?: number
  includeDomains?: string[]
  excludeDomains?: string[]
  freshness?: 'day' | 'week' | 'month' | 'year'
}

export interface ExaSearchRequest extends CommonSearchRequest {
  backend: 'exa'
  type?: 'auto' | 'instant' | 'fast' | 'deep-lite' | 'deep' | 'deep-reasoning'
  sourceType?: ExaSourceType
  category?: never
  additionalQueries?: string[]
  includeText?: string[]
  excludeText?: string[]
  startPublishedDate?: string
  endPublishedDate?: string
  maxAgeHours?: number
  highlights?: boolean | { query?: string; maxCharacters?: number }
  summary?: boolean | { query?: string; schema?: unknown }
  contextMaxCharacters?: number
  includeHtmlTags?: boolean
  textVerbosity?: 'compact' | 'standard' | 'full'
  includeSections?: string[]
  excludeSections?: string[]
  livecrawlTimeout?: number
  moderation?: boolean
  systemPrompt?: string
  outputSchema?: ExaOutputSchema
  userLocation?: string
}

export type WebSearchRequest = ExaSearchRequest

export interface WebSearchResult {
  title: string
  url: string
  author?: string
  publishedDate?: string
  text?: string
  highlights?: string[]
  summary?: string
  metadata?: Record<string, unknown>
}

export interface WebSearchResponse {
  backend: SearchBackendId
  results: WebSearchResult[]
  output?: string
}

export interface WebSearchBackend<Id extends SearchBackendId> {
  readonly id: Id
  search(
    request: Extract<WebSearchRequest, { backend: Id }>,
    signal?: AbortSignal
  ): Promise<WebSearchResponse>
}

export interface CommonFetchRequest {
  url: string
  format?: 'markdown' | 'text' | 'html' | 'json'
  timeoutMs?: number
  selector?: string
}

export interface LocalFetchRequest extends CommonFetchRequest {
  backend: 'local'
  headers?: Record<string, string>
}

export type WebFetchRequest = LocalFetchRequest

export interface WebFetchResponse {
  backend: FetchBackendId
  url: string
  finalUrl?: string
  title?: string
  content: string
  format: 'markdown' | 'text' | 'html' | 'json'
  contentType?: string
  metadata?: Record<string, unknown>
}

export interface WebFetchBackend<Id extends FetchBackendId> {
  readonly id: Id
  fetch(
    request: Extract<WebFetchRequest, { backend: Id }>,
    signal?: AbortSignal
  ): Promise<WebFetchResponse>
}
