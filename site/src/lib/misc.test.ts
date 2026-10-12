import { afterEach, describe, expect, it, vi } from 'vitest'
import { headlineFor, isAbortError, replayRun, splitFollowUps } from './agent'
import { formatCell, sqlString } from './duckdb'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('fetchQuota', () => {
  it('returns null with no proxy configured', async () => {
    const { fetchQuota } = await import('./anthropic')
    expect(await fetchQuota()).toBeNull()
  })
  it('returns the proxy quota, or null when the proxy is unreachable or errors', async () => {
    vi.stubEnv('VITE_PROXY_URL', 'https://proxy.test')
    vi.resetModules()
    const { fetchQuota } = await import('./anthropic')
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ cap_today: 8, remaining_today: 3 }), { status: 200 })))
    expect(await fetchQuota()).toMatchObject({ remaining_today: 3 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 503 })))
    expect(await fetchQuota()).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network') }))
    expect(await fetchQuota()).toBeNull()
  })
})

describe('replayRun with a transcript', () => {
  it('uses the model steps, explanation and follow-ups and is not pending', () => {
    const run = replayRun({
      id: 'x',
      question: 'q?',
      fingerprint: 'f',
      sql: 'SELECT 1',
      follow_ups: [],
      result: { columns: ['a'], rows: [[1]], row_count: 1 },
      agent: { model: 'm', calls: 2, usage: { input_tokens: 9, output_tokens: 3 }, steps: [{ sql: 'SELECT 2', result: { columns: ['b'], rows: [[2]], row_count: 1 }, error: null }], explanation: 'Two.', follow_ups: ['Next?'] },
    })
    expect(run.pending).toBe(false)
    expect(run.steps[0].sql).toBe('SELECT 2')
    expect(run.explanation).toBe('Two.')
    expect(run.followUps).toEqual(['Next?'])
    expect(run.calls).toBe(2)
  })
})

describe('headlineFor edge cases', () => {
  it('refuses bars when categories repeat, and numbers when the row is wide', () => {
    expect(headlineFor({ columns: ['state', 'n'], rows: [['KY', 1], ['KY', 2]], row_count: 2 })).toBeNull()
    expect(headlineFor({ columns: ['a', 'b', 'c', 'd'], rows: [[1, 2, 3, 4]], row_count: 1 })).toBeNull()
    expect(headlineFor(null)).toBeNull()
    expect(headlineFor({ columns: ['n'], rows: [], row_count: 0 })).toBeNull()
  })
  it('skips rank-like numeric columns when choosing the bar value', () => {
    const h = headlineFor({ columns: ['name', 'priority', 'balance'], rows: [['a', 1, 10], ['b', 2, 20]], row_count: 2 })
    expect(h?.kind === 'bars' && h.valueName).toBe('balance')
  })
})

describe('splitFollowUps', () => {
  it('finds the line when it is second to last and keeps the rest', () => {
    const r = splitFollowUps('Answer.\nFollow-ups: X? | Y?\n')
    expect(r.followUps).toEqual(['X?', 'Y?'])
    expect(r.explanation).toBe('Answer.')
    expect(splitFollowUps('Follow-ups: only').explanation).toBe('')
  })
})

describe('formatCell and sqlString', () => {
  it('formats by kind', () => {
    expect(formatCell(null)).toBe('')
    expect(formatCell(12n)).toBe('12')
    expect(formatCell(1234.5, 'number')).toBe('1,234.50')
    expect(formatCell(7, 'integer')).toBe('7')
    expect(formatCell(true, 'boolean')).toBe('true')
    expect(formatCell(new Date('2026-10-31T13:45:00Z'), 'date')).toBe('2026-10-31')
    expect(formatCell(new Date('2026-10-31T13:45:00Z'), 'timestamp')).toBe('2026-10-31 13:45')
    expect(formatCell('junk', 'date')).toBe('junk')
  })
  it('escapes quotes for SQL literals', () => {
    expect(sqlString("O'Brien")).toBe("'O''Brien'")
  })
})

describe('isAbortError', () => {
  it('recognises DOMException and Error aborts only', () => {
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true)
    expect(isAbortError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true)
    expect(isAbortError(new Error('x'))).toBe(false)
    expect(isAbortError('AbortError')).toBe(false)
  })
})
