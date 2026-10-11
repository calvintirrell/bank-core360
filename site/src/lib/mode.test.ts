import { describe, expect, it } from 'vitest'
import { resolveMode } from './mode'

describe('resolveMode', () => {
  it('defaults to bank mode', () => expect(resolveMode('', null)).toBe('bank'))
  it('remembers a stored choice', () => expect(resolveMode('', 'tech')).toBe('tech'))
  it('lets the URL override storage', () => {
    expect(resolveMode('?mode=bank', 'tech')).toBe('bank')
    expect(resolveMode('?mode=tech', 'bank')).toBe('tech')
  })
  it('ignores junk', () => expect(resolveMode('?mode=xyz', 'nope')).toBe('bank'))
})
