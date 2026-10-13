import { describe, expect, it } from 'vitest'
import { matchText } from './PeopleCards'

describe('matchText', () => {
  it('names the rule that joined the two records', () => {
    expect(matchText({ source_systems: 'core_a' })).toBeNull()
    expect(matchText({ source_systems: 'core_a+core_b', match_tier: 1, match_confidence: 1 })).toBe('Matched exactly across both banks')
    expect(matchText({ source_systems: 'core_a+core_b', match_tier: 2, match_confidence: 0.874 })).toBe('Matched by similarity, 87% confident')
    expect(matchText({ source_systems: 'core_a+core_b', match_tier: 3, match_confidence: 1 })).toBe('Confirmed as the same person by a reviewer')
  })
})
