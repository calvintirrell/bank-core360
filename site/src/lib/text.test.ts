import { describe, expect, it } from 'vitest'
import { normalizeQuestion } from './text'

describe('normalizeQuestion', () => {
  it('ignores case, punctuation, curly quotes and spacing', () => {
    const canon = 'Where is our deposit money concentrated? Top five states.'
    for (const v of ['where is our deposit money concentrated top five states', '  Where is our deposit money concentrated?  Top five states ', 'WHERE IS OUR DEPOSIT MONEY CONCENTRATED - TOP FIVE STATES!']) {
      expect(normalizeQuestion(v)).toBe(normalizeQuestion(canon))
    }
    expect(normalizeQuestion("Riverside\u2019s customers")).toBe(normalizeQuestion("riverside's customers"))
  })
  it('still tells different questions apart', () => {
    expect(normalizeQuestion('How many customers?')).not.toBe(normalizeQuestion('How many accounts?'))
  })
})
