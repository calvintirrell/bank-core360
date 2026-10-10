import Anthropic from '@anthropic-ai/sdk'

export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (default)', proxy: true },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', proxy: true },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (own key only)', proxy: false },
] as const
export type ModelId = (typeof MODELS)[number]['id']
export const DEFAULT_MODEL: ModelId = 'claude-opus-5-5'

/**
 * Shared demo proxy (Cloudflare Worker) that holds the project's key server-side, with an origin
 * allowlist, per-IP rate limit and a daily cap. Set VITE_PROXY_URL at build time; empty disables it.
 */
export const PROXY_URL: string = (import.meta.env.VITE_PROXY_URL as string | undefined) ?? ''

export function proxyAllowsModel(model: ModelId): boolean {
  return MODELS.find((m) => m.id === model)?.proxy ?? false
}

/**
 * Client factory. With a key: direct to api.anthropic.com from the browser (key never leaves the
 * tab except to Anthropic). Without a key: through the shared proxy, which ignores the dummy key.
 */
export function makeClient(apiKey: string): Anthropic {
  if (apiKey) return new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  if (!PROXY_URL) throw new Error('No API key entered and no shared proxy configured for this build.')
  return new Anthropic({ apiKey: 'proxy', baseURL: PROXY_URL, dangerouslyAllowBrowser: true })
}

/** Thrown when the shared proxy's daily demo cap has been reached. */
export class DemoCapError extends Error {}

export type Quota = {
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

/** Phase 0 spike: one round trip proves the browser -> Claude path works on GitHub Pages. */
export async function ping(apiKey: string, model: ModelId = DEFAULT_MODEL): Promise<string> {
  if (!apiKey && !proxyAllowsModel(model)) {
    throw new Error(`${model} is not available through the shared proxy; enter your own key to use it.`)
  }
  const client = makeClient(apiKey)
  let res: Anthropic.Message
  try {
    res = await client.messages.create({
      model,
      max_tokens: 1024,
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: 'Reply with exactly one word: READY' }],
    })
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError && /daily demo cap/i.test(e.message)) {
      throw new DemoCapError('Daily demo limit reached.')
    }
    throw e
  }
  if (res.stop_reason === 'refusal') return `refused (${res.stop_details?.category ?? 'unknown'})`
  return res.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim()
}
