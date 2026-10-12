import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./duckdb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./duckdb')>()),
  runSql: vi.fn(async (sql: string) => {
    if (/boom/.test(sql)) throw new Error('Binder Error: boom')
    return { columns: [{ name: 'n', kind: 'integer' as const }], rows: [{ n: 7 }], ms: 1 }
  }),
}))

import { askLive, MAX_CALLS, type MessagesClient } from './agent'
import { runSql } from './duckdb'

type Msg = { stop_reason: string; content: unknown[]; usage: { input_tokens: number; output_tokens: number } }
const toolUse = (sql: unknown, id = 'tu_1') => ({ type: 'tool_use', id, name: 'run_sql', input: sql === null ? null : { sql } })
const text = (t: string) => ({ type: 'text', text: t })
const reply = (stop_reason: string, content: unknown[]): Msg => ({ stop_reason, content, usage: { input_tokens: 10, output_tokens: 5 } })

/** A client that answers from a script and records every call's body and options. */
function fakeClient(script: Msg[]) {
  const calls: { body: Record<string, unknown>; options: Record<string, unknown> }[] = []
  const create = vi.fn(async (body: Record<string, unknown>, options: Record<string, unknown>) => {
    calls.push({ body, options })
    const next = script.shift()
    if (!next) throw new Error('script exhausted')
    return next as never
  })
  return { client: { messages: { create } } as unknown as MessagesClient, calls }
}

const opts = (client: MessagesClient, extra: Record<string, unknown> = {}) =>
  ({ apiKey: '', model: 'claude-opus-5-5' as const, prompt: 'SYSTEM', tool: { name: 'run_sql', description: 'd', input_schema: {}, strict: true }, client, ...extra })

afterEach(() => vi.clearAllMocks())

describe('askLive', () => {
  it('runs the tool loop, numbers each call for the proxy, and returns the explanation', async () => {
    const { client, calls } = fakeClient([
      reply('tool_use', [toolUse('SELECT count(*) AS n FROM customer_360')]),
      reply('end_turn', [text('Seven.\nFollow-ups: A? | B?')]),
    ])
    const run = await askLive('How many?', opts(client))
    expect(run.calls).toBe(2)
    expect(calls.map((c) => (c.options.headers as Record<string, string>)['x-demo-call'])).toEqual(['1', '2'])
    expect(calls[0].body.system).toBe('SYSTEM')
    expect(run.steps).toHaveLength(1)
    expect(run.steps[0].result?.rows).toEqual([[7]])
    expect(run.explanation).toBe('Seven.')
    expect(run.followUps).toEqual(['A?', 'B?'])
    expect(run.usage).toEqual({ input_tokens: 20, output_tokens: 10 })
  })

  it('returns a tool error to the model instead of failing the question', async () => {
    const { client, calls } = fakeClient([reply('tool_use', [toolUse('SELECT boom FROM customer_360')]), reply('end_turn', [text('Could not.')])])
    const run = await askLive('q', opts(client))
    expect(run.steps[0].error).toMatch(/boom/)
    const msgs = calls[1].body.messages as { role: string; content: { type?: string; is_error?: boolean }[] }[]
    const toolResult = msgs.find((m) => Array.isArray(m.content) && m.content[0]?.type === 'tool_result')!.content[0]
    expect(toolResult.is_error).toBe(true)
  })

  it('refuses SQL the guard rejects without running it', async () => {
    const { client } = fakeClient([reply('tool_use', [toolUse("SELECT * FROM read_parquet('https://x')")]), reply('end_turn', [text('ok')])])
    const run = await askLive('q', opts(client))
    expect(run.steps[0].error).toMatch(/read_parquet/)
    expect(runSql).not.toHaveBeenCalled()
  })

  it('survives a tool_use block with no input', async () => {
    const { client } = fakeClient([reply('tool_use', [toolUse(null)]), reply('end_turn', [text('ok')])])
    const run = await askLive('q', opts(client))
    expect(run.steps[0].sql).toBe('')
    expect(run.steps[0].error).toMatch(/Enter a query/)
  })

  it('stops at the call budget and does not run SQL whose result could never be sent', async () => {
    const script = Array.from({ length: MAX_CALLS }, (_, i) => reply('tool_use', [toolUse(`SELECT ${i}`, `tu_${i}`)]))
    const { client, calls } = fakeClient(script)
    const run = await askLive('q', opts(client))
    expect(calls).toHaveLength(MAX_CALLS)
    expect(runSql).toHaveBeenCalledTimes(MAX_CALLS - 1)
    expect(run.steps.at(-1)!.error).toMatch(/budget/)
    expect(run.explanation).toMatch(/Stopped after the maximum/)
  })

  it('aborting stops further calls and rejects with an AbortError', async () => {
    const controller = new AbortController()
    const script = [reply('tool_use', [toolUse('SELECT 1')]), reply('end_turn', [text('never')])]
    const { client, calls } = fakeClient(script)
    const p = askLive('q', opts(client, { signal: controller.signal, onUpdate: () => controller.abort() }))
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls).toHaveLength(1)
    expect(calls[0].options.signal).toBe(controller.signal)
  })

  it('reports refusals and cut-off answers plainly', async () => {
    const r1 = await askLive('q', opts(fakeClient([reply('refusal', [])]).client))
    expect(r1.explanation).toMatch(/declined/)
    const r2 = await askLive('q', opts(fakeClient([reply('max_tokens', [text('Half an answer')])]).client))
    expect(r2.explanation).toMatch(/Half an answer[\s\S]*cut off/)
  })

  it('translates proxy cap errors and passes abort errors through untouched', async () => {
    const capped = { messages: { create: vi.fn(async () => { throw Object.assign(new Error('daily demo cap (8 questions) reached'), { status: 429 }) }) } } as unknown as MessagesClient
    await expect(askLive('q', opts(capped))).rejects.toMatchObject({ message: 'Daily demo limit reached.' })
  })
})
