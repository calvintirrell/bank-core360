import { describe, expect, it } from 'vitest'
import { demoStatus, translateError, type Quota } from './anthropic'

const q = (over: Partial<Quota> = {}): Quota => ({
  unit: 'questions',
  calls_per_question: 5,
  cap_today: 8,
  used_today: 2,
  remaining_today: 6,
  cap_month: 240,
  remaining_month: 200,
  disabled: false,
  resets_at_utc: '2026-10-12T23:59:59Z',
  ...over,
})

describe('demoStatus', () => {
  it('is never exhausted when the visitor uses their own key', () => {
    expect(demoStatus(q({ disabled: true, remaining_today: 0 }), true, false).exhausted).toBe(false)
  })
  it('reports the kill switch first, then the month, then the day', () => {
    expect(demoStatus(q({ disabled: true }), false, true).reason).toMatch(/paused/)
    expect(demoStatus(q({ remaining_month: 0 }), false, true).reason).toMatch(/Monthly demo limit/)
    expect(demoStatus(q({ remaining_today: 0 }), false, true).reason).toMatch(/Daily demo limit reached \(8 questions/)
    expect(demoStatus(q(), true, true).reason).toMatch(/Daily/)
  })
  it('is open with questions left, and carries the reset time from the proxy', () => {
    const s = demoStatus(q(), false, true)
    expect(s.exhausted).toBe(false)
    expect(s.resetsAt).not.toBe('')
    expect(demoStatus(q({ resets_at_utc: 'garbage' }), false, true).resetsAt).toBe('')
  })
  it('treats an unreachable proxy (null quota) as open until a cap error arrives', () => {
    expect(demoStatus(null, false, true).exhausted).toBe(false)
    expect(demoStatus(null, true, true).reason).toMatch(/Daily demo limit reached \(8 questions/)
  })
})

describe('translateError', () => {
  const err = (status: number, message: string) => Object.assign(new Error(message), { status })
  it('maps the proxy responses to sentences for the page', () => {
    expect(String(translateError(err(400, 'system prompt is not one this page serves; reload the page')))).toMatch(/Reload the page/)
    expect(String(translateError(err(503, 'cannot reach the site to verify the prompt')))).toMatch(/could not verify/)
    expect(String(translateError(err(504, 'did not answer in time')))).toMatch(/too long/)
    expect(String(translateError(err(429, 'daily demo cap (8 questions) reached')))).toMatch(/Daily demo limit/)
  })
  it('passes anything else through untouched', () => {
    const e = err(500, 'boom')
    expect(translateError(e)).toBe(e)
  })
})
