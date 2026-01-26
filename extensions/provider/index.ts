/**
 * Dynamic Provider Extension
 *
 * Registers a model provider by fetching configuration from an API endpoint.
 * The API key encodes the endpoint URL and token.
 *
 * Key format: base64(endpoint):token
 * Example: echo -n "https://my-api.com" | base64 → aHR0cHM6Ly9teS1hcGkuY29t
 * Full key: aHR0cHM6Ly9teS1hcGkuY29t:sk-xxx
 *
 * Set PROVIDER_API_KEY environment variable to enable.
 */

import type { ExtensionAPI } from '@mariozechner/pi-coding-agent'

function getApiKey(): string | undefined {
  return process.env.PROVIDER_API_KEY
}

function parseApiKey(key: string): { endpoint: string; token: string } | null {
  const colonIndex = key.indexOf(':')
  if (colonIndex === -1) return null

  try {
    const endpoint = Buffer.from(key.slice(0, colonIndex), 'base64').toString('utf-8')
    const token = key.slice(colonIndex + 1)
    if (!endpoint.startsWith('http')) return null
    return { endpoint, token }
  } catch {
    return null
  }
}

interface ModelConfig {
  id: string
  name: string
  reasoning: boolean
  input: ('text' | 'image')[]
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
  contextWindow: number
  maxTokens: number
}

type ApiType =
  | 'openai-completions'
  | 'openai-responses'
  | 'openai-codex-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'bedrock-converse-stream'

interface ProviderConfig {
  baseUrl: string
  apiKey: string
  api: ApiType
  headers?: Record<string, string>
  authHeader?: boolean
  models: ModelConfig[]
}

interface ConfigResponse {
  providers: Record<string, ProviderConfig>
}

export default async function (pi: ExtensionAPI) {
  const apiKey = getApiKey()
  if (!apiKey) {
    return
  }

  const parsed = parseApiKey(apiKey)
  if (!parsed) {
    console.error('[provider] Invalid API key format. Expected: base64(endpoint):token')
    return
  }

  try {
    const response = await fetch(`${parsed.endpoint}/setup/config?key=${parsed.token}`)

    if (!response.ok) {
      console.error(`[provider] Failed to fetch config: ${response.status}`)
      return
    }

    const config: ConfigResponse = await response.json()

    for (const [name, providerConfig] of Object.entries(config.providers)) {
      if (!providerConfig.models?.length) continue

      pi.registerProvider(name, {
        baseUrl: providerConfig.baseUrl,
        apiKey: providerConfig.apiKey,
        api: providerConfig.api,
        headers: providerConfig.headers,
        authHeader: providerConfig.authHeader,
        models: providerConfig.models
      })
    }
  } catch (error) {
    console.error(`[provider] Error: ${error}`)
  }
}
