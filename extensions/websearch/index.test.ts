import { describe, expect, test } from 'vitest'

import { buildExaSearchRequest } from './index'

describe('buildExaSearchRequest', () => {
  test('uses current Exa search and contents parameters', () => {
    expect(
      buildExaSearchRequest({
        query: 'current ai news',
        type: 'deep-reasoning',
        highlights: true,
        maxAgeHours: 0,
        moderation: true,
        systemPrompt: 'cite sources',
        outputSchema: { type: 'object', properties: { answer: { type: 'string' } } }
      })
    ).toMatchObject({
      query: 'current ai news',
      type: 'deep-reasoning',
      moderation: true,
      systemPrompt: 'cite sources',
      outputSchema: { type: 'object' },
      contents: {
        text: { maxCharacters: 10000 },
        highlights: true,
        maxAgeHours: 0
      }
    })
  })

  test('drops empty optional placeholders while preserving meaningful falsy values', () => {
    expect(
      buildExaSearchRequest({
        query: 'object storage',
        additionalQueries: [],
        includeDomains: [],
        excludeText: [''],
        includeSections: [],
        outputSchema: { type: 'object', properties: {} },
        summary: false,
        includeHtmlTags: false,
        maxAgeHours: 0
      })
    ).toEqual({
      query: 'object storage',
      numResults: 8,
      type: 'auto',
      outputSchema: { type: 'object' },
      contents: {
        text: { maxCharacters: 10000, includeHtmlTags: false },
        summary: false,
        maxAgeHours: 0
      }
    })
  })

  test('validates output schemas and dates locally', () => {
    expect(() => buildExaSearchRequest({ query: 'x', outputSchema: {} as never })).toThrow(
      'outputSchema'
    )
    expect(() => buildExaSearchRequest({ query: 'x', startPublishedDate: 'not-a-date' })).toThrow(
      'startPublishedDate'
    )
    expect(
      buildExaSearchRequest({
        query: 'x',
        outputSchema: { type: 'text' },
        startPublishedDate: '',
        endPublishedDate: '2026-02-01T00:00:00.000Z'
      })
    ).toMatchObject({
      outputSchema: { type: 'text' },
      endPublishedDate: '2026-02-01T00:00:00.000Z'
    })
  })

  test('preserves filters for publication search', () => {
    const request = buildExaSearchRequest({
      query: 'reports',
      sourceType: 'publication',
      excludeDomains: ['example.com'],
      startPublishedDate: '2026-01-01T00:00:00.000Z'
    })

    expect(request).toMatchObject({
      category: 'publication',
      excludeDomains: ['example.com'],
      startPublishedDate: '2026-01-01T00:00:00.000Z'
    })
  })

  test('rejects unsupported structured-output schemas before calling Exa', () => {
    expect(() => buildExaSearchRequest({ query: 'x', outputSchema: { type: 'object' } })).toThrow(
      'require properties'
    )
    expect(() =>
      buildExaSearchRequest({
        query: 'x',
        outputSchema: {
          type: 'object',
          properties: Object.fromEntries(
            Array.from({ length: 11 }, (_, index) => [`field${index}`, { type: 'string' }])
          )
        }
      })
    ).toThrow('more than 10 properties')
  })

  test('drops filters unsupported by people search', () => {
    expect(
      buildExaSearchRequest({
        query: 'founders',
        sourceType: 'people',
        includeDomains: ['linkedin.com'],
        excludeDomains: ['example.com'],
        startPublishedDate: '2026-01-01T00:00:00.000Z',
        endPublishedDate: '2026-02-01T00:00:00.000Z'
      })
    ).toMatchObject({
      category: 'people',
      includeDomains: ['linkedin.com']
    })

    const request = buildExaSearchRequest({ query: 'founders', sourceType: 'people' })
    expect(request).not.toHaveProperty('excludeDomains')
    expect(request).not.toHaveProperty('startPublishedDate')
    expect(request).not.toHaveProperty('endPublishedDate')
  })
})
