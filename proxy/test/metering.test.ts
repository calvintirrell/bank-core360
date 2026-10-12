/** 8B: a question is charged only when the upstream call succeeds, never for an SDK retry. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { _resetPromptCache } from '../src/index'
import { makeCtx, makeEnv, messagesRequest, month, stubUpstream, today } from './helpers'

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

describe('question metering', () => {
  it('counts the first call of a question after a 2xx upstream response', async () => {
    const { env, store } = makeEnv()
    const upstream = stubUpstream(200)
    const res = await call(env, messagesRequest({ 'x-demo-call': '1' }))
    expect(res.status).toBe(200)
    expect(upstream.upstreamCalls).toHaveLength(1)
    expect(store.get(`qcount:${today()}`)).toBe('1')
    expect(store.get(`qcount:${month()}`)).toBe('1')
    expect(store.get(`ccount:${today()}`)).toBe('1')
    expect(res.headers.get('x-demo-remaining-today')).toBe('7')
  })

  it('does not charge a question when Anthropic fails (529 / 500 / 400)', async () => {
    for (const status of [529, 500, 400]) {
      const { env, store } = makeEnv()
      stubUpstream(status, { type: 'error', error: { type: 'overloaded_error', message: 'busy' } })
      const res = await call(env, messagesRequest({ 'x-demo-call': '1' }))
      expect(res.status).toBe(status)
      expect(store.has(`qcount:${today()}`)).toBe(false)
      expect(store.has(`ccount:${today()}`)).toBe(false)
    }
  })

  it('never counts a request the SDK marks as a retry', async () => {
    const { env, store } = makeEnv()
    stubUpstream(200)
    await call(env, messagesRequest({ 'x-demo-call': '1', 'x-stainless-retry-count': '1' }))
    expect(store.has(`qcount:${today()}`)).toBe(false)
    expect(store.has(`ccount:${today()}`)).toBe(false)
  })

  it('follow-up calls of a question add to the call ceiling but not to the question count', async () => {
    const { env, store } = makeEnv()
    stubUpstream(200)
    await call(env, messagesRequest({ 'x-demo-call': '1' }))
    await call(env, messagesRequest({ 'x-demo-call': '2' }))
    await call(env, messagesRequest({ 'x-demo-call': '3' }))
    expect(store.get(`qcount:${today()}`)).toBe('1')
    expect(store.get(`ccount:${today()}`)).toBe('3')
  })

  it('a missing or garbage x-demo-call header counts as a new question', async () => {
    const { env, store } = makeEnv()
    stubUpstream(200)
    const req = messagesRequest()
    req.headers.delete('x-demo-call')
    await call(env, req)
    await call(env, messagesRequest({ 'x-demo-call': 'banana' }))
    expect(store.get(`qcount:${today()}`)).toBe('2')
  })

  it('refuses before forwarding once the daily question cap is reached', async () => {
    const { env, store } = makeEnv({ DAILY_CAP: '2' })
    const upstream = stubUpstream(200)
    store.set(`qcount:${today()}`, '2')
    const res = await call(env, messagesRequest({ 'x-demo-call': '1' }))
    expect(res.status).toBe(429)
    expect(await res.text()).toMatch(/daily demo cap \(2 questions\)/)
    expect(upstream.upstreamCalls).toHaveLength(0)
  })

  it('refuses before forwarding once the monthly cap is reached', async () => {
    const { env, store } = makeEnv({ MONTHLY_CAP: '3' })
    const upstream = stubUpstream(200)
    store.set(`qcount:${month()}`, '3')
    const res = await call(env, messagesRequest({ 'x-demo-call': '1' }))
    expect(res.status).toBe(429)
    expect(await res.text()).toMatch(/monthly demo cap/)
    expect(upstream.upstreamCalls).toHaveLength(0)
  })

  it('enforces the hard call ceiling whatever the headers say', async () => {
    const { env, store } = makeEnv({ DAILY_CAP: '1', CALLS_PER_QUESTION: '2' })
    const upstream = stubUpstream(200)
    store.set(`ccount:${today()}`, '2')
    const res = await call(env, messagesRequest({ 'x-demo-call': '2' }))
    expect(res.status).toBe(429)
    expect(await res.text()).toMatch(/call ceiling/)
    expect(upstream.upstreamCalls).toHaveLength(0)
  })

  it('refuses a call index beyond the per-question allowance', async () => {
    const { env } = makeEnv({ CALLS_PER_QUESTION: '2' })
    const upstream = stubUpstream(200)
    const res = await call(env, messagesRequest({ 'x-demo-call': '3' }))
    expect(res.status).toBe(429)
    expect(await res.text()).toMatch(/already used its 2 API calls/)
    expect(upstream.upstreamCalls).toHaveLength(0)
  })

  it('passes only content-type and request-id back from upstream, plus the remaining counters', async () => {
    const { env } = makeEnv()
    stubUpstream(200)
    const res = await call(env, messagesRequest({ 'x-demo-call': '1' }))
    expect(res.headers.get('request-id')).toBe('req_test')
    expect(res.headers.get('x-should-not-leak')).toBeNull()
    expect(res.headers.get('access-control-allow-origin')).toBe('https://calvintirrell.github.io')
    expect(res.headers.get('x-demo-remaining-month')).toBe('239')
  })
})
