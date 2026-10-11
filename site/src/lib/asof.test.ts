import { describe, expect, it } from 'vitest'
import { resolveVersion, versionDir } from './AsOfContext'

describe('as-of version', () => {
  it('defaults to latest and accepts vN from the URL', () => {
    expect(resolveVersion('')).toBe('latest')
    expect(resolveVersion('?asof=v0')).toBe('v0')
    expect(resolveVersion('?asof=junk')).toBe('latest')
    expect(versionDir('latest')).toBe('')
    expect(versionDir('v0')).toBe('v0/')
  })
})
