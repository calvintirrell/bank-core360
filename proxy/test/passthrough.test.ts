/** 8D: what comes back is the upstream body unchanged (streams included) and never the key. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { _resetPromptCache } from '../src/index'
import { makeCtx, makeEnv, messagesRequest, ORIGIN, stubUpstream } from './helpers'

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

describe('passthrough', () => {
  it('streams an SSE body through byte for byte', async () => {
    const { env } = makeEnv()
    const sse = 'event: message_start\ndata: {"type":"message_start"}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'
    stubUpstream(200, sse)
    const res = await call(env, messagesRequest({}, { stream: true }))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(sse)
  })

  it('forwards the upstream error body and status unchanged', async () => {
    const { env } = makeEnv()
    stubUpstream(400, { type: 'error', error: { type: 'invalid_request_error', message: 'messages: text content blocks must be non-empty' } })
    const res = await call(env, messagesRequest())
    expect(res.status).toBe(400)
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/non-empty/)
  })

  it('never includes the API key in any response it produces', async () => {
    const { env, store } = makeEnv({ ANTHROPIC_API_KEY: 'sk-ant-SECRET-VALUE' })
    stubUpstream(529, { type: 'error', error: { type: 'overloaded_error', message: 'busy' } })
    const probes: Request[] = [
      messagesRequest(),
      messagesRequest({}, { model: 'nope' }),
      messagesRequest({}, { system: 'other' }),
      new Request('https://proxy.test/v1/messages', { method: 'POST', headers: { origin: 'https://evil.example' } }),
      new Request('https://proxy.test/quota', { headers: { origin: ORIGIN } }),
      new Request('https://proxy.test/anything', { headers: { origin: ORIGIN } }),
    ]
    store.set('disabled', '0')
    for (const req of probes) {
      const res = await call(env, req)
      const text = await res.text()
      expect(text).not.toContain('SECRET')
      for (const [, v] of res.headers) expect(v).not.toContain('SECRET')
    }
  })
})
