/**
 * bank-core360 proxy: holds the Anthropic API key so the GitHub Pages demo works with no key.
 *
 * Guards, in order: origin allowlist, per-IP rate limit, kill switch, body validation (model
 * allowlist, max_tokens cap, custom tools only, bounded size), then daily + monthly caps. Counters
 * only increment for requests that are actually forwarded upstream. The browser never sees the key; it calls this Worker with
 * the same request shape it would send to api.anthropic.com (the SDK just gets a different baseURL).
 */

export interface Env {
  ANTHROPIC_API_KEY: string
  ALLOWED_ORIGINS: string
  ALLOWED_MODELS: string
  MAX_TOKENS_CAP: string
  DAILY_CAP: string
  MONTHLY_CAP: string
  RATE_LIMITER: { limit(opts: { key: string }): Promise<{ success: boolean }> }
  USAGE: KVNamespace
}

const UPSTREAM = 'https://api.anthropic.com/v1/messages'
const MAX_BODY_BYTES = 100_000

function corsHeaders(origin: string, req: Request): Headers {
  const h = new Headers()
  h.set('Access-Control-Allow-Origin', origin)
  h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  h.set('Access-Control-Allow-Headers', req.headers.get('Access-Control-Request-Headers') ?? 'content-type, anthropic-version, x-api-key, anthropic-dangerous-direct-browser-access')
  h.set('Access-Control-Expose-Headers', 'request-id, x-demo-remaining-today, x-demo-remaining-month')
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
    if (url.pathname === '/quota' && req.method === 'GET') {
      // Lets the page show "N of M demo queries left today" before anyone clicks.
      const now = new Date().toISOString()
      const [d, m, disabled] = await Promise.all([
        env.USAGE.get(`count:${now.slice(0, 10)}`),
        env.USAGE.get(`count:${now.slice(0, 7)}`),
        env.USAGE.get('disabled'),
      ])
      const capDay = Number(env.DAILY_CAP)
      const capMonth = Number(env.MONTHLY_CAP)
      return json(
        200,
        {
          cap_today: capDay,
          used_today: Number(d ?? '0'),
          remaining_today: Math.max(0, capDay - Number(d ?? '0')),
          cap_month: capMonth,
          remaining_month: Math.max(0, capMonth - Number(m ?? '0')),
          disabled: disabled === '1',
          resets_at_utc: `${now.slice(0, 10)}T23:59:59Z`,
        },
        cors,
      )
    }
    if (req.method !== 'POST' || url.pathname !== '/v1/messages') {
      return err(404, 'not_found_error', 'POST /v1/messages only', cors)
    }
    if (!originOk) return err(403, 'permission_error', 'origin not allowed', cors)

    // Per-IP rate limit (runs before any body work, so probes are cheap).
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
    const { success } = await env.RATE_LIMITER.limit({ key: ip })
    if (!success) return err(429, 'rate_limit_error', 'too many requests, slow down', cors)

    // Kill switch: `wrangler kv key put --binding USAGE disabled 1 --remote` turns the demo off.
    if ((await env.USAGE.get('disabled')) === '1') {
      return err(503, 'api_error', 'the shared demo proxy is currently switched off; use your own key', cors)
    }

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

    // Daily + monthly caps across all users; increment only for requests we actually forward.
    const now = new Date().toISOString()
    const dayKey = `count:${now.slice(0, 10)}`
    const monthKey = `count:${now.slice(0, 7)}`
    const [usedDay, usedMonth] = await Promise.all([env.USAGE.get(dayKey), env.USAGE.get(monthKey)])
    const dayCap = Number(env.DAILY_CAP)
    const monthCap = Number(env.MONTHLY_CAP)
    const d = Number(usedDay ?? '0')
    const m = Number(usedMonth ?? '0')
    if (d >= dayCap) {
      return err(429, 'rate_limit_error', `daily demo cap (${dayCap}) reached; try again tomorrow or use your own key`, cors)
    }
    if (m >= monthCap) {
      return err(429, 'rate_limit_error', `monthly demo cap (${monthCap}) reached; use your own key`, cors)
    }
    await Promise.all([
      env.USAGE.put(dayKey, String(d + 1), { expirationTtl: 60 * 60 * 48 }),
      env.USAGE.put(monthKey, String(m + 1), { expirationTtl: 60 * 60 * 24 * 40 }),
    ])

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
    for (const name of ['content-type', 'request-id']) {
      const v = upstream.headers.get(name)
      if (v) h.set(name, v)
    }
    h.set('x-demo-remaining-today', String(dayCap - d - 1))
    h.set('x-demo-remaining-month', String(monthCap - m - 1))
    return new Response(upstream.body, { status: upstream.status, headers: h })
  },
}
