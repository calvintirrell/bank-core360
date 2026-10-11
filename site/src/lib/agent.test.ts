import { describe, expect, it } from 'vitest'
import { fromToolResult, headlineFor, replayRun, splitFollowUps, toToolResult } from './agent'

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

describe('follow-ups and headlines', () => {
  it('splits the trailing follow-ups line and ignores text without one', () => {
    const r = splitFollowUps('Answer here.\n\n- caveat\nFollow-ups: A? | B? | C? | D?')
    expect(r.explanation).toBe('Answer here.\n\n- caveat')
    expect(r.followUps).toEqual(['A?', 'B?', 'C?'])
    expect(splitFollowUps('Just an answer.').followUps).toEqual([])
  })
  it('picks a big number for a one-row aggregate and bars for a short categorical result', () => {
    expect(headlineFor({ columns: ['total'], rows: [[163]], row_count: 1 })).toEqual({ kind: 'number', label: 'total', value: 163 })
    const bars = headlineFor({ columns: ['state', 'deposits'], rows: [['KY', 2.9], ['WV', 2.8]], row_count: 2 })
    expect(bars?.kind).toBe('bars')
    expect(headlineFor({ columns: ['k', 'name', 'bal'], rows: Array.from({ length: 20 }, (_, i) => [`C${i}`, 'x', i]), row_count: 20 })).toBeNull()
  })
})
