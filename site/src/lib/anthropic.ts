import type Anthropic from '@anthropic-ai/sdk'

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (default)', proxy: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', proxy: true },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (own key only)', proxy: false },
] as const
export type ModelId = (typeof MODELS)[number]['id']
export const DEFAULT_MODEL: ModelId = 'claude-opus-5-5'

/**
 * Shared demo proxy (Cloudflare Worker) that holds the project's key server-side, with an origin
 * allowlist, per-IP rate limit and daily/monthly caps counted in questions. Set VITE_PROXY_URL at
 * build time; empty disables it.
 */
export const PROXY_URL: string = (import.meta.env.VITE_PROXY_URL as string | undefined) ?? ''

export function proxyAllowsModel(model: ModelId): boolean {
  return MODELS.find((m) => m.id === model)?.proxy ?? false
}

/**
 * Client factory. With a key: direct to api.anthropic.com from the browser (key never leaves the
 * tab except to Anthropic). Without a key: through the shared proxy, which ignores the dummy key.
 * The SDK is imported on first use so it stays out of the initial page bundle.
 */
export async function makeClient(apiKey: string): Promise<Anthropic> {
  const { default: Client } = await import('@anthropic-ai/sdk')
  if (apiKey) return new Client({ apiKey, dangerouslyAllowBrowser: true })
  if (!PROXY_URL) throw new Error('No API key entered and no shared proxy configured for this build.')
  return new Client({ apiKey: 'proxy', baseURL: PROXY_URL, dangerouslyAllowBrowser: true })
}

/** Thrown when the shared proxy's daily or monthly demo cap has been reached. */
export class DemoCapError extends Error {}

/** Maps SDK errors from the proxy into friendlier ones; passes everything else through. */
export function translateError(e: unknown): unknown {
  const status = (e as { status?: number } | null)?.status
  const message = e instanceof Error ? e.message : ''
  if (status === 429 && /daily demo cap/i.test(message)) return new DemoCapError('Daily demo limit reached.')
  if (status === 429 && /monthly demo cap/i.test(message)) return new DemoCapError('Monthly demo limit reached.')
  if (status === 429 && /already used its/i.test(message)) return new Error('This question used up its call allowance. Ask it again to start a fresh one.')
  if (status === 503 && /switched off/i.test(message)) return new Error('The shared demo proxy is switched off right now.')
  return e
}

export type Quota = {
  unit?: 'questions' | 'calls'
  calls_per_question?: number
  cap_today: number
  used_today: number
  remaining_today: number
  cap_month: number
  remaining_month: number
  disabled: boolean
  resets_at_utc: string
}

export async function fetchQuota(): Promise<Quota | null> {
  if (!PROXY_URL) return null
  try {
    const r = await fetch(`${PROXY_URL}/quota`)
    return r.ok ? ((await r.json()) as Quota) : null
  } catch {
    return null
  }
}

export function routeLabel(apiKey: string): string {
  return apiKey ? 'your key, direct to api.anthropic.com' : 'shared demo proxy (rate-limited, daily cap)'
}
