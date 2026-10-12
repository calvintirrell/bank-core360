import { describe, expect, it } from 'vitest'
import { latestOnlyQueue } from './serial'

const tick = () => new Promise((r) => setTimeout(r, 5))

describe('latestOnlyQueue', () => {
  it('runs jobs one at a time, in order', async () => {
    const q = latestOnlyQueue<string>()
    const log: string[] = []
    const a = q('a', async () => { log.push('a start'); await tick(); log.push('a end') })
    await a
    await q('b', async () => { log.push('b start'); log.push('b end') })
    expect(log).toEqual(['a start', 'a end', 'b start', 'b end'])
  })
  it('skips a queued job that was superseded before it started, and never interleaves', async () => {
    const q = latestOnlyQueue<string>()
    const log: string[] = []
    const job = (k: string) => async () => { log.push(`${k} start`); await tick(); log.push(`${k} end`) }
    const p1 = q('v0', job('v0'))
    const p2 = q('latest', job('latest'))
    const p3 = q('v0', job('v0 again'))
    await Promise.all([p1, p2, p3])
    expect(log).toEqual(['v0 start', 'v0 end', 'v0 again start', 'v0 again end'])
  })
  it('a failing job rejects its own promise and leaves the queue usable', async () => {
    const q = latestOnlyQueue<number>()
    await expect(q(1, async () => { throw new Error('nope') })).rejects.toThrow('nope')
    let ran = false
    await q(2, async () => { ran = true })
    expect(ran).toBe(true)
  })
})
