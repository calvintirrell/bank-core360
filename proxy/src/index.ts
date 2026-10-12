/**
 * bank-core360 proxy: holds the Anthropic API key so the GitHub Pages demo works with no key.
 *
 * Guards, in order: origin allowlist, per-IP rate limit (also on /quota), kill switch, bounded
 * body (content-length first, then bytes), then the request SHAPE is pinned to the demo: an
 * allowed model, max_tokens clamped, exactly one custom tool named run_sql with the shipped
 * schema, tool_choice auto, a bounded conversation, and a system prompt whose SHA-256 matches one
 * the site itself serves (fetched from PROMPT_SOURCE and cached). Unknown body fields are dropped
 * and only allowlisted anthropic-beta values pass. A spoofed Origin therefore buys bank-demo
 * questions, not a general-purpose model endpoint.
 *
 * Caps are counted in QUESTIONS: the page sends x-demo-call: 1 on the first API call of a
 * question and 2, 3, ... on its follow-ups, so only call 1 counts against the question caps. KV
 * is eventually consistent, so the client declares this rather than the Worker inferring it; the
 * abuse backstop is a hard ceiling of DAILY_CAP * CALLS_PER_QUESTION calls per day regardless of
 * headers. A call without the header counts as a question of its own. Counters increment only
 * after the upstream call succeeded (2xx), so an Anthropic outage or a rejected request never
 * costs the visitor a question, and a request the SDK marks as a retry
 * (x-stainless-retry-count > 0) is never counted at all. The browser never sees the key; it calls
 * this Worker with the same request shape it would send to api.anthropic.com (the SDK just gets a
 * different baseURL).
 */

export interface Env {
  ANTHROPIC_API_KEY: string
  ALLOWED_ORIGINS: string
  ALLOWED_MODELS: string
  ALLOWED_BETAS?: string
  MAX_TOKENS_CAP: string
  DAILY_CAP: string
  MONTHLY_CAP: string
  CALLS_PER_QUESTION: string
  /** Base URL of the site's data folder; the system prompts it serves are the only ones accepted. */
  PROMPT_SOURCE: string
  RATE_LIMITER: { limit(opts: { key: string }): Promise<{ success: boolean }> }
  USAGE: KVNamespace
}

const UPSTREAM = 'https://api.anthropic.com/v1/messages'
const MAX_BODY_BYTES = 100_000
const MAX_MESSAGES = 24
const UPSTREAM_TIMEOUT_MS = 60_000
const PROMPT_CACHE_MS = 5 * 60_000
const DAY_TTL = 60 * 60 * 48
const MONTH_TTL = 60 * 60 * 24 * 40
const TOOL_NAME = 'run_sql'
/** Body fields the demo uses; everything else (thinking, metadata, mcp_servers, container, ...) is dropped. */
const ALLOWED_BODY_KEYS = new Set(['model', 'max_tokens', 'system', 'messages', 'tools', 'tool_choice', 'stream', 'output_config', 'temperature', 'stop_sequences'])

function keys(now: string) {
  return { day: `qcount:${now.slice(0, 10)}`, month: `qcount:${now.slice(0, 7)}`, calls: `ccount:${now.slice(0, 10)}` }
}

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

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The text of a `system` field: a string, or the text blocks of an array, joined as the SDK sends them. */
function systemText(system: unknown): string | null {
  if (typeof system === 'string') return system
  if (Array.isArray(system) && system.every((b) => b && typeof b === 'object' && (b as { type?: string }).type === 'text' && typeof (b as { text?: unknown }).text === 'string')) {
    return (system as { text: string }[]).map((b) => b.text).join('')
  }
  return null
}

/** Allowed system prompts = SHA-256 of every agent_prompt.md the site serves (every as-of version). */
let promptCache: { hashes: Set<string>; fetchedAt: number } | null = null

async function loadPromptHashes(env: Env, force = false): Promise<Set<string> | null> {
  if (!force && promptCache && Date.now() - promptCache.fetchedAt < PROMPT_CACHE_MS) return promptCache.hashes
  try {
    const base = env.PROMPT_SOURCE.replace(/\/+$/, '')
    const manifest = (await (await fetch(`${base}/manifest.json`, { signal: AbortSignal.timeout(10_000) })).json()) as { versions?: { dir: string }[] }
    const dirs = manifest.versions?.map((v) => (v.dir ? `${v.dir.replace(/\/+$/, '')}/` : '')) ?? ['']
    const hashes = new Set<string>()
    for (const dir of dirs) {
      const r = await fetch(`${base}/${dir}agent_prompt.md`, { signal: AbortSignal.timeout(10_000) })
      if (r.ok) hashes.add(await sha256(await r.text()))
    }
    if (hashes.size === 0) throw new Error('no prompts found')
    promptCache = { hashes, fetchedAt: Date.now() }
    return hashes
  } catch {
    return promptCache?.hashes ?? null // stale is better than closed; nothing cached at all fails closed
  }
}

/** Resets the in-memory prompt cache (tests). */
export function _resetPromptCache(): void {
  promptCache = null
}

/** Validates the shipped run_sql tool definition: one custom tool, one string argument named sql. */
function toolShapeError(tools: unknown): string | null {
  if (!Array.isArray(tools) || tools.length !== 1) return `exactly one tool (${TOOL_NAME}) is required`
  const t = tools[0] as Record<string, unknown>
  if (t.type !== undefined && t.type !== 'custom') return 'only custom tools are allowed through the demo proxy'
  if (t.name !== TOOL_NAME) return `the only allowed tool is ${TOOL_NAME}`
  const schema = t.input_schema as { type?: string; properties?: Record<string, { type?: string }>; required?: unknown } | undefined
  const props = schema?.properties ?? {}
  const names = Object.keys(props)
  if (schema?.type !== 'object' || names.length !== 1 || names[0] !== 'sql' || props.sql?.type !== 'string') {
    return `${TOOL_NAME} must take exactly one string argument named sql`
  }
  if (!Array.isArray(schema.required) || schema.required.length !== 1 || schema.required[0] !== 'sql') return `${TOOL_NAME}.sql must be required`
  return null
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const origin = req.headers.get('Origin') ?? ''
    const allowedOrigins = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim())
    const originOk = allowedOrigins.includes(origin)
    const cors = corsHeaders(originOk ? origin : allowedOrigins[0], req)

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const url = new URL(req.url)
    if (url.pathname === '/health') return json(200, { ok: true }, cors)

    // Per-IP rate limit on everything that touches KV or upstream (runs before any body work, so probes are cheap).
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
    const { success } = await env.RATE_LIMITER.limit({ key: ip })
    if (!success) return err(429, 'rate_limit_error', 'too many requests, slow down', cors)

    if (url.pathname === '/quota' && req.method === 'GET') {
      // Lets the page show "N of M demo queries left today" before anyone clicks.
      const now = new Date().toISOString()
      const k = keys(now)
      const [d, m, disabled] = await Promise.all([env.USAGE.get(k.day), env.USAGE.get(k.month), env.USAGE.get('disabled')])
      const capDay = Number(env.DAILY_CAP)
      const capMonth = Number(env.MONTHLY_CAP)
      return json(
        200,
        {
          unit: 'questions',
          calls_per_question: Number(env.CALLS_PER_QUESTION),
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

    // Kill switch: `wrangler kv key put --binding USAGE disabled 1 --remote` turns the demo off.
    if ((await env.USAGE.get('disabled')) === '1') {
      return err(503, 'api_error', 'the shared demo proxy is currently switched off; use your own key', cors)
    }

    // Bounded body: declared size first (no read), then actual bytes.
    const declared = Number(req.headers.get('content-length') ?? '0')
    if (declared > MAX_BODY_BYTES) return err(413, 'invalid_request_error', 'request too large', cors)
    const raw = await req.text()
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return err(413, 'invalid_request_error', 'request too large', cors)
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return err(400, 'invalid_request_error', 'body must be JSON', cors)
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return err(400, 'invalid_request_error', 'body must be a JSON object', cors)
    const body: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) if (ALLOWED_BODY_KEYS.has(key)) body[key] = value

    // --- The request shape is the demo's, nothing else ---------------------------------------
    const allowedModels = env.ALLOWED_MODELS.split(',').map((s) => s.trim())
    if (typeof body.model !== 'string' || !allowedModels.includes(body.model)) {
      return err(400, 'invalid_request_error', `model must be one of ${allowedModels.join(', ')}`, cors)
    }
    const capTokens = Number(env.MAX_TOKENS_CAP)
    const requested = Math.floor(Number(body.max_tokens))
    body.max_tokens = Number.isFinite(requested) && requested >= 1 ? Math.min(requested, capTokens) : capTokens

    const toolError = toolShapeError(body.tools)
    if (toolError) return err(400, 'invalid_request_error', toolError, cors)
    if (body.tool_choice !== undefined && (body.tool_choice as { type?: string } | null)?.type !== 'auto') {
      return err(400, 'invalid_request_error', 'tool_choice must be auto', cors)
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > MAX_MESSAGES) {
      return err(400, 'invalid_request_error', `messages must hold 1 to ${MAX_MESSAGES} turns`, cors)
    }
    const system = systemText(body.system)
    if (system === null) return err(400, 'invalid_request_error', 'system prompt is required', cors)
    const systemHash = await sha256(system)
    let allowed = await loadPromptHashes(env)
    if (allowed && !allowed.has(systemHash)) allowed = await loadPromptHashes(env, true) // the site may have just shipped a new prompt
    if (!allowed) return err(503, 'api_error', 'the demo proxy cannot reach the site to verify the prompt; try again shortly', cors)
    if (!allowed.has(systemHash)) {
      return err(400, 'invalid_request_error', "system prompt is not one this page serves; reload the page to pick up the current prompt", cors)
    }
    const allowedBetas = (env.ALLOWED_BETAS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
    const betas = (req.headers.get('anthropic-beta') ?? '').split(',').map((s) => s.trim()).filter((b) => b && allowedBetas.includes(b))

    // --- Daily + monthly caps in questions. Checked before forwarding; counted only after success. ---
    const now = new Date().toISOString()
    const k = keys(now)
    const dayCap = Number(env.DAILY_CAP)
    const monthCap = Number(env.MONTHLY_CAP)
    const perQuestion = Number(env.CALLS_PER_QUESTION)
    const callIndex = Number(req.headers.get('x-demo-call') ?? '1') || 1
    const isRetry = (Number(req.headers.get('x-stainless-retry-count') ?? '0') || 0) > 0
    const [usedDay, usedMonth, usedCalls] = await Promise.all([env.USAGE.get(k.day), env.USAGE.get(k.month), env.USAGE.get(k.calls)])
    let d = Number(usedDay ?? '0')
    let m = Number(usedMonth ?? '0')
    const c = Number(usedCalls ?? '0')
    if (c >= dayCap * perQuestion) {
      return err(429, 'rate_limit_error', `daily demo cap reached (call ceiling); try again tomorrow or use your own key`, cors)
    }
    if (callIndex > perQuestion) {
      return err(429, 'rate_limit_error', `this question already used its ${perQuestion} API calls; ask it again as a new question`, cors)
    }
    if (callIndex === 1) {
      if (d >= dayCap) {
        return err(429, 'rate_limit_error', `daily demo cap (${dayCap} questions) reached; try again tomorrow or use your own key`, cors)
      }
      if (m >= monthCap) {
        return err(429, 'rate_limit_error', `monthly demo cap (${monthCap} questions) reached; use your own key`, cors)
      }
    }

    let upstream: Response
    try {
      upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': req.headers.get('anthropic-version') ?? '2023-06-01',
          ...(betas.length ? { 'anthropic-beta': betas.join(',') } : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
    } catch {
      return err(504, 'api_error', 'the model did not answer in time; try again', cors)
    }

    // Count only a forwarded call that succeeded, and never an SDK retry of one already counted.
    if (upstream.ok && !isRetry) {
      const writes = [env.USAGE.put(k.calls, String(c + 1), { expirationTtl: DAY_TTL })]
      if (callIndex === 1) {
        d += 1
        m += 1
        writes.push(env.USAGE.put(k.day, String(d), { expirationTtl: DAY_TTL }), env.USAGE.put(k.month, String(m), { expirationTtl: MONTH_TTL }))
      }
      ctx.waitUntil(Promise.all(writes))
    }

    // Stream (or pass) the upstream response through unchanged, with CORS added.
    const h = new Headers(cors)
    for (const name of ['content-type', 'request-id']) {
      const v = upstream.headers.get(name)
      if (v) h.set(name, v)
    }
    h.set('x-demo-remaining-today', String(Math.max(0, dayCap - d)))
    h.set('x-demo-remaining-month', String(Math.max(0, monthCap - m)))
    return new Response(upstream.body, { status: upstream.status, headers: h })
  },
}
