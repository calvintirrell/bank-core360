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

/**
 * Client factory. With a key: direct to api.anthropic.com from the browser (key never leaves the
 * tab except to Anthropic). Without a key: through the shared proxy, which ignores the dummy key.
 * The SDK is imported on first use so it stays out of the initial page bundle.
 */
export async function makeClient(apiKey: string): Promise<Anthropic> {
  const { default: Client } = await import('@anthropic-ai/sdk')
  if (apiKey) return new Client({ apiKey, dangerouslyAllowBrowser: true })
  if (!PROXY_URL) throw new Error('No API key entered and no shared proxy configured for this build.')
  // No SDK retries through the proxy: a retry re-sends the same x-demo-call header, and although the
  // proxy ignores requests marked as retries, one failed call should surface to the user, not loop.
  return new Client({ apiKey: 'proxy', baseURL: PROXY_URL, dangerouslyAllowBrowser: true, maxRetries: 0 })
}

/** Thrown when the shared proxy's daily or monthly demo cap has been reached. */
export class DemoCapError extends Error {}

/** Maps SDK errors from the proxy into friendlier ones; passes everything else through. */
export function translateError(e: unknown): unknown {
  const status = (e as { status?: number } | null)?.status
  const message = e instanceof Error ? e.message : ''
  if (status === 429 && /daily demo cap/i.test(message)) return new DemoCapError('Daily demo limit reached.')
  if (status === 429 && /monthly demo cap/i.test(message)) return new DemoCapError('Monthly demo limit reached.')
  // Reachable only if the page's call budget (agent.ts MAX_CALLS) ever exceeds the proxy's CALLS_PER_QUESTION.
  if (status === 429 && /already used its/i.test(message)) return new Error('This question used up its call allowance. Ask it again to start a fresh one.')
  if (status === 503 && /switched off/i.test(message)) return new Error('The shared demo proxy is switched off right now.')
  if (status === 503 && /verify the prompt/i.test(message)) return new Error('The shared demo proxy could not verify this page right now. Try again in a moment.')
  if (status === 400 && /reload the page/i.test(message)) return new Error('This page is out of date with the demo proxy. Reload the page and ask again.')
  if (status === 504) return new Error('The model took too long to answer. Try again.')
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

export type DemoStatus = {
  /** Live questions through the proxy are not possible right now. */
  exhausted: boolean
  /** Why, in a sentence for the page; empty when not exhausted. */
  reason: string
  /** When the daily counter resets, in the viewer's local time; empty if unknown. */
  resetsAt: string
}

/** What the Ask panel should say about the shared demo, from the proxy's quota and the last call. */
export function demoStatus(quota: Quota | null, capHit: boolean, usingProxy: boolean): DemoStatus {
  if (!usingProxy) return { exhausted: false, reason: '', resetsAt: '' }
  const resetsAt = quota?.resets_at_utc ? formatReset(quota.resets_at_utc) : ''
  const unit = quota?.unit === 'questions' || !quota ? 'questions' : 'API calls'
  if (quota?.disabled) return { exhausted: true, reason: 'The shared demo is paused right now. Cached answers for the listed questions still work.', resetsAt: '' }
  if (quota && quota.remaining_month <= 0) {
    return { exhausted: true, reason: `Monthly demo limit reached (${quota.cap_month} ${unit} a month). Cached answers for the listed questions still work.`, resetsAt: '' }
  }
  if (capHit || (quota !== null && quota.remaining_today <= 0)) {
    return {
      exhausted: true,
      reason: `Daily demo limit reached (${quota?.cap_today ?? 8} ${unit} per day). Cached answers for the listed questions still work.`,
      resetsAt,
    }
  }
  return { exhausted: false, reason: '', resetsAt }
}

function formatReset(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
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
