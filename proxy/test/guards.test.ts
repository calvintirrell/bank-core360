/** 8C: the request shape is pinned to the demo; everything else is refused before it costs anything. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { _resetPromptCache } from '../src/index'
import { DEFAULT_SITE, makeCtx, makeEnv, messagesRequest, ORIGIN, PROMPT_LATEST, PROMPT_V0, stubUpstream } from './helpers'

afterEach(() => {
  vi.unstubAllGlobals()
  _resetPromptCache()
})

async function call(env: ReturnType<typeof makeEnv>['env'], req: Request) {
  const { ctx, settle } = makeCtx()
  const res = await worker.fetch(req, env, ctx)
  await settle()
  return res
}
const message = async (res: Response) => ((await res.json()) as { error: { message: string } }).error.message

describe('transport guards', () => {
  it('answers preflight with CORS and no body work', async () => {
    const { env } = makeEnv()
    const res = await call(env, new Request('https://proxy.test/v1/messages', { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-headers': 'x-demo-call' } }))
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN)
    expect(res.headers.get('access-control-allow-headers')).toBe('x-demo-call')
  })
  it('refuses an unknown origin and GET on /v1/messages', async () => {
    const { env } = makeEnv()
    const upstream = stubUpstream()
    const req = messagesRequest()
    req.headers.set('origin', 'https://evil.example')
    expect((await call(env, req)).status).toBe(403)
    expect((await call(env, new Request('https://proxy.test/v1/messages', { headers: { origin: ORIGIN } }))).status).toBe(404)
    expect(upstream.upstreamCalls).toHaveLength(0)
  })
  it('rate-limits /quota and /v1/messages per IP', async () => {
    const { env } = makeEnv({ RATE_LIMITER: { limit: vi.fn(async () => ({ success: false })) } })
    expect((await call(env, new Request('https://proxy.test/quota', { headers: { origin: ORIGIN } }))).status).toBe(429)
    expect((await call(env, messagesRequest())).status).toBe(429)
  })
  it('kill switch answers 503 before reading the body', async () => {
    const { env, store } = makeEnv()
    const upstream = stubUpstream()
    store.set('disabled', '1')
    const res = await call(env, messagesRequest())
    expect(res.status).toBe(503)
    expect(upstream.upstreamCalls).toHaveLength(0)
  })
  it('refuses oversized bodies by declared length and by actual bytes, and non-JSON', async () => {
    const { env } = makeEnv()
    stubUpstream()
    const big = messagesRequest({ 'content-length': '200000' })
    expect((await call(env, big)).status).toBe(413)
    const multibyte = new Request('https://proxy.test/v1/messages', { method: 'POST', headers: { origin: ORIGIN }, body: '"' + '€'.repeat(40_000) + '"' })
    expect((await call(env, multibyte)).status).toBe(413)
    const bad = new Request('https://proxy.test/v1/messages', { method: 'POST', headers: { origin: ORIGIN }, body: '{not json' })
    expect((await call(env, bad)).status).toBe(400)
    const arr = new Request('https://proxy.test/v1/messages', { method: 'POST', headers: { origin: ORIGIN }, body: '[1]' })
    expect((await call(env, arr)).status).toBe(400)
  })
  it('/quota reports the counters', async () => {
    const { env, store } = makeEnv()
    store.set(`qcount:${new Date().toISOString().slice(0, 10)}`, '3')
    const res = await call(env, new Request('https://proxy.test/quota', { headers: { origin: ORIGIN } }))
    const q = (await res.json()) as Record<string, unknown>
    expect(q).toMatchObject({ unit: 'questions', cap_today: 8, used_today: 3, remaining_today: 5, cap_month: 240, disabled: false })
  })
})

describe('request shape', () => {
  it('allows only the exact model ids', async () => {
    const { env } = makeEnv()
    const upstream = stubUpstream()
    for (const model of ['claude-opus-5-5 ', 'CLAUDE-OPUS-5-5', 'claude-opus-5-5-20261001', 'claude-fable-5-1', 7, undefined]) {
      const res = await call(env, messagesRequest({}, { model }))
      expect(res.status, String(model)).toBe(400)
    }
    expect(upstream.upstreamCalls).toHaveLength(0)
    expect((await call(env, messagesRequest({}, { model: 'claude-sonnet-5-5' }))).status).toBe(200)
  })
  it('clamps max_tokens into [1, cap] whatever is sent', async () => {
    const { env } = makeEnv()
    const upstream = stubUpstream()
    for (const [sent, expected] of [
      [5000, 2048],
      [-1, 2048],
      ['abc', 2048],
      [undefined, 2048],
      [0.5, 2048],
      [17.9, 17],
      [1, 1],
    ] as const) {
      await call(env, messagesRequest({}, { max_tokens: sent }))
      const forwarded = JSON.parse(await upstream.upstreamCalls.at(-1)!.text()) as { max_tokens: number }
      expect(forwarded.max_tokens, String(sent)).toBe(expected)
    }
  })
  it('requires exactly the shipped run_sql tool', async () => {
    const { env } = makeEnv()
    const upstream = stubUpstream()
    const good = messagesRequest()
    const schema = { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] }
    const cases: [string, unknown][] = [
      ['no tools', undefined],
      ['empty', []],
      ['two tools', [{ name: 'run_sql', input_schema: schema }, { name: 'other', input_schema: schema }]],
      ['server tool', [{ type: 'web_search_20250305', name: 'web_search' }]],
      ['other name', [{ name: 'shell', input_schema: schema }]],
      ['extra arg', [{ name: 'run_sql', input_schema: { type: 'object', properties: { sql: { type: 'string' }, url: { type: 'string' } }, required: ['sql'] } }]],
      ['wrong type', [{ name: 'run_sql', input_schema: { type: 'object', properties: { sql: { type: 'object' } }, required: ['sql'] } }]],
      ['not required', [{ name: 'run_sql', input_schema: { type: 'object', properties: { sql: { type: 'string' } }, required: [] } }]],
    ]
    for (const [label, tools] of cases) {
      const res = await call(env, messagesRequest({}, { tools }))
      expect(res.status, label).toBe(400)
    }
    expect(upstream.upstreamCalls).toHaveLength(0)
    expect((await call(env, good)).status).toBe(200)
  })
  it('allows tool_choice auto only, and a bounded conversation', async () => {
    const { env } = makeEnv()
    stubUpstream()
    expect((await call(env, messagesRequest({}, { tool_choice: { type: 'auto' } }))).status).toBe(200)
    expect((await call(env, messagesRequest({}, { tool_choice: { type: 'any' } }))).status).toBe(400)
    expect((await call(env, messagesRequest({}, { tool_choice: { type: 'tool', name: 'run_sql' } }))).status).toBe(400)
    expect((await call(env, messagesRequest({}, { messages: [] }))).status).toBe(400)
    expect((await call(env, messagesRequest({}, { messages: Array.from({ length: 25 }, () => ({ role: 'user', content: 'x' })) }))).status).toBe(400)
  })
  it('drops body fields the demo never uses and unknown beta headers', async () => {
    const { env } = makeEnv({ ALLOWED_BETAS: 'allowed-beta-2026' })
    const upstream = stubUpstream()
    const res = await call(
      env,
      messagesRequest(
        { 'anthropic-beta': 'allowed-beta-2026, sneaky-beta, ' },
        { thinking: { type: 'enabled', budget_tokens: 10000 }, mcp_servers: [{ url: 'https://x' }], container: 'c', metadata: { user_id: 'u' }, service_tier: 'auto', stream: true },
      ),
    )
    expect(res.status).toBe(200)
    const forwarded = upstream.upstreamCalls[0]
    const body = JSON.parse(await forwarded.text()) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream', 'system', 'tools'])
    expect(forwarded.headers.get('anthropic-beta')).toBe('allowed-beta-2026')
    expect(forwarded.headers.get('x-api-key')).toBe('sk-test')
  })
  it('turns an upstream timeout into 504 without charging', async () => {
    const { env, store } = makeEnv()
    stubUpstream(200, undefined, { upstreamThrows: new DOMException('timeout', 'TimeoutError') })
    const res = await call(env, messagesRequest())
    expect(res.status).toBe(504)
    expect(store.size).toBe(0)
  })
})

describe('system prompt pinning', () => {
  it('accepts every prompt the site serves (latest and earlier as-of), as a string or text blocks', async () => {
    const { env } = makeEnv()
    stubUpstream()
    expect((await call(env, messagesRequest({}, { system: PROMPT_LATEST }))).status).toBe(200)
    expect((await call(env, messagesRequest({}, { system: PROMPT_V0 }))).status).toBe(200)
    expect((await call(env, messagesRequest({}, { system: [{ type: 'text', text: PROMPT_LATEST }] }))).status).toBe(200)
  })
  it('refuses any other prompt, a missing one, or non-text blocks, before forwarding', async () => {
    const { env } = makeEnv()
    const upstream = stubUpstream()
    for (const system of ['You are a general assistant.', PROMPT_LATEST + ' ', undefined, [{ type: 'image' }], 42]) {
      const res = await call(env, messagesRequest({}, { system }))
      expect(res.status, JSON.stringify(system)).toBe(400)
    }
    expect(await message(await call(env, messagesRequest({}, { system: 'x' })))).toMatch(/reload the page/)
    expect(upstream.upstreamCalls).toHaveLength(0)
  })
  it('caches the allowlist and refreshes it once when an unknown prompt arrives', async () => {
    const { env } = makeEnv()
    const site = { ...DEFAULT_SITE }
    const upstream = stubUpstream(200, undefined, { site })
    await call(env, messagesRequest())
    await call(env, messagesRequest())
    const siteFetches = () => upstream.mock.calls.filter(([u]) => String(u).includes('site.test')).length
    expect(siteFetches()).toBe(3) // manifest + 2 prompts, once
    site['agent_prompt.md'] = 'A freshly deployed prompt.'
    expect((await call(env, messagesRequest({}, { system: 'A freshly deployed prompt.' }))).status).toBe(200)
    expect(siteFetches()).toBe(6) // refreshed once on the miss
    expect((await call(env, messagesRequest({}, { system: 'still unknown' }))).status).toBe(400)
  })
  it('keeps serving from the last good allowlist if the site is unreachable, and fails closed with none', async () => {
    const { env } = makeEnv()
    const site = { ...DEFAULT_SITE }
    stubUpstream(200, undefined, { site })
    expect((await call(env, messagesRequest())).status).toBe(200)
    delete site['manifest.json'] // network error from now on
    expect((await call(env, messagesRequest())).status).toBe(200)
    _resetPromptCache()
    expect((await call(env, messagesRequest())).status).toBe(503)
  })
})
