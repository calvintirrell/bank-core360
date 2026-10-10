import { describe, expect, it } from 'vitest'
import { fromToolResult, replayRun, toToolResult } from './agent'

describe('tool result conversions', () => {
  it('round-trips a query result through the compact tool shape', () => {
    const q = {
      columns: [
        { name: 'k', kind: 'text' as const },
        { name: 'n', kind: 'integer' as const },
        { name: 'bal', kind: 'number' as const },
        { name: 'd', kind: 'date' as const },
      ],
      rows: [{ k: 'C1', n: 3n, bal: 12.5, d: new Date('2026-09-30T00:00:00Z') }],
      ms: 1,
    }
    const t = toToolResult(q)
    expect(t).toEqual({ columns: ['k', 'n', 'bal', 'd'], rows: [['C1', 3, 12.5, '2026-09-30']], row_count: 1 })
    const back = fromToolResult(t)
    expect(back.columns.map((c) => c.kind)).toEqual(['text', 'integer', 'number', 'date'])
    expect(back.rows[0].k).toBe('C1')
  })
  it('replay without a transcript is marked pending and uses the hand-authored SQL', () => {
    const run = replayRun({ id: 'x', question: 'q?', fingerprint: 'f', sql: 'SELECT 1', result: { columns: ['a'], rows: [[1]], row_count: 1 }, agent: null })
    expect(run.pending).toBe(true)
    expect(run.route).toBe('replay')
    expect(run.steps[0].sql).toBe('SELECT 1')
  })
})
