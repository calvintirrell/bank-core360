/**
 * bank-core360 proxy: holds the Anthropic API key so the GitHub Pages demo works with no key.
 *
 * Guards: origin allowlist, per-IP rate limit, daily request cap, model allowlist, max_tokens cap,
 * custom tools only, bounded body size. The browser never sees the key; it calls this Worker with
 * the same request shape it would send to api.anthropic.com (the SDK just gets a different baseURL).
 */

export interface Env {
  ANTHROPIC_API_KEY: string
  ALLOWED_ORIGINS: string
  ALLOWED_MODELS: string
  MAX_TOKENS_CAP: string
  DAILY_CAP: string
  RATE_LIMITER: { limit(opts: { key: string }): Promise<{ success: boolean }> }
  USAGE: KVNamespace
}

const UPSTREAM = 'https://api.anthropic.com/v1/messages'
const MAX_BODY_BYTES = 200_000

function corsHeaders(origin: string, req: Request): Headers {
  const h = new Headers()
  h.set('Access-Control-Allow-Origin', origin)
  h.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  h.set('Access-Control-Allow-Headers', req.headers.get('Access-Control-Request-Headers') ?? 'content-type, anthropic-version, x-api-key, anthropic-dangerous-direct-browser-access')
  h.set('Access-Control-Expose-Headers', 'request-id, x-ratelimit-remaining')
  h.set('Access-Control-Max-Age', '86400')
  h.set('Vary', 'Origin')
  return h
}

function json(status: number, body: unknown, headers?: Headers): Response {
  const h = new Headers(headers)
  h.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { status, headers: h })
}

function err(status: number, type: string, message: string, headers?: Headers): Response {
  return json(status, { type: 'error', error: { type, message } }, headers)
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin') ?? ''
    const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
    const originOk = allowedOrigins.includes(origin)
    const cors = corsHeaders(originOk ? origin : allowedOrigins[0], req)

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const url = new URL(req.url)
    if (url.pathname === '/health') return json(200, { ok: true }, cors)
    if (req.method !== 'POST' || url.pathname !== '/v1/messages') {
      return err(404, 'not_found_error', 'POST /v1/messages only', cors)
    }
    if (!originOk) return err(403, 'permission_error', 'origin not allowed', cors)

    // Per-IP rate limit.
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
    const { success } = await env.RATE_LIMITER.limit({ key: ip })
    if (!success) return err(429, 'rate_limit_error', 'too many requests, slow down', cors)

    // Daily cap across all users.
    const day = new Date().toISOString().slice(0, 10)
    const key = `count:${day}`
    const used = Number((await env.USAGE.get(key)) ?? '0')
    const cap = Number(env.DAILY_CAP)
    if (used >= cap) {
      return err(429, 'rate_limit_error', `daily demo cap (${cap}) reached; try again tomorrow or use your own key`, cors)
    }
    await env.USAGE.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 })

    // Bounded, validated body.
    const raw = await req.text()
    if (raw.length > MAX_BODY_BYTES) return err(413, 'invalid_request_error', 'request too large', cors)
    let body: Record<string, unknown>
    try {
      body = JSON.parse(raw)
    } catch {
      return err(400, 'invalid_request_error', 'body must be JSON', cors)
    }

    const allowedModels = env.ALLOWED_MODELS.split(',').map((s) => s.trim())
    if (typeof body.model !== 'string' || !allowedModels.includes(body.model)) {
      return err(400, 'invalid_request_error', `model must be one of ${allowedModels.join(', ')}`, cors)
    }
    const capTokens = Number(env.MAX_TOKENS_CAP)
    body.max_tokens = Math.min(Number(body.max_tokens ?? capTokens) || capTokens, capTokens)

    // Custom (client-executed) tools only: no server tools, no MCP, no code execution on our bill.
    if (Array.isArray(body.tools)) {
      for (const t of body.tools as Array<Record<string, unknown>>) {
        if (t.type !== undefined && t.type !== 'custom') {
          return err(400, 'invalid_request_error', 'only custom tools are allowed through the demo proxy', cors)
        }
      }
    }
    delete body.mcp_servers
    delete body.container

    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': req.headers.get('anthropic-version') ?? '2023-06-01',
        ...(req.headers.get('anthropic-beta') ? { 'anthropic-beta': req.headers.get('anthropic-beta')! } : {}),
      },
      body: JSON.stringify(body),
    })

    // Stream (or pass) the upstream response through unchanged, with CORS added.
    const h = new Headers(cors)
    for (const name of ['content-type', 'request-id', 'x-ratelimit-remaining']) {
      const v = upstream.headers.get(name)
      if (v) h.set(name, v)
    }
    return new Response(upstream.body, { status: upstream.status, headers: h })
  },
}
