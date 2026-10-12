/** Test doubles for the Worker: an in-memory KV, a switchable rate limiter, a captured upstream. */
import { vi } from 'vitest'
import type { Env } from '../src/index'

export const ORIGIN = 'https://calvintirrell.github.io'

export function makeEnv(over: Partial<Record<keyof Env, unknown>> = {}) {
  const store = new Map<string, string>()
  const kv = {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => {
      store.set(k, v)
    }),
    delete: vi.fn(async (k: string) => {
      store.delete(k)
    }),
  }
  const env = {
    ANTHROPIC_API_KEY: 'sk-test',
    ALLOWED_ORIGINS: `${ORIGIN},http://localhost:5173`,
    ALLOWED_MODELS: 'claude-opus-5-5,claude-sonnet-5-5',
    MAX_TOKENS_CAP: '2048',
    DAILY_CAP: '8',
    MONTHLY_CAP: '240',
    CALLS_PER_QUESTION: '5',
    RATE_LIMITER: { limit: vi.fn(async () => ({ success: true })) },
    USAGE: kv,
    ...over,
  } as unknown as Env
  return { env, store, kv }
}

export function makeCtx() {
  const pending: Promise<unknown>[] = []
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p), passThroughOnUnhandledRejection: () => {} } as unknown as ExecutionContext
  return { ctx, settle: () => Promise.all(pending) }
}

export const today = () => new Date().toISOString().slice(0, 10)
export const month = () => new Date().toISOString().slice(0, 7)

export function stubUpstream(status = 200, body: unknown = { id: 'msg_1', type: 'message', stop_reason: 'end_turn', content: [] }) {
  const fetchMock = vi.fn(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'request-id': 'req_test', 'x-should-not-leak': '1' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

export function messagesRequest(extraHeaders: Record<string, string> = {}, body: Record<string, unknown> = {}) {
  return new Request('https://proxy.test/v1/messages', {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', 'x-demo-call': '1', ...extraHeaders },
    body: JSON.stringify({
      model: 'claude-opus-5-5',
      max_tokens: 100,
      system: 'test',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 'run_sql', description: 'd', input_schema: { type: 'object', properties: { sql: { type: 'string' } }, required: ['sql'] } }],
      ...body,
    }),
  })
}
