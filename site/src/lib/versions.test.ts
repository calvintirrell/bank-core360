import { describe, expect, it } from 'vitest'
import { versionDir, versionDirs, versionIds } from './versions'

const two = [{ as_of: '2026-09-30', dir: 'v0' }, { as_of: '2026-10-31', dir: '' }]
const three = [...two.slice(0, 1), { as_of: '2026-10-31', dir: 'v1' }, { as_of: '2026-11-30', dir: '' }]

describe('versions from the manifest', () => {
  it('names the last version latest and the earlier ones v<i>', () => {
    expect(versionIds(two)).toEqual(['v0', 'latest'])
    expect(versionIds(three)).toEqual(['v0', 'v1', 'latest'])
    expect(versionIds(undefined)).toEqual(['latest'])
    expect(versionIds([])).toEqual(['latest'])
  })
  it('maps every id to its folder, so a third batch needs no code change', () => {
    expect(versionDirs(two)).toEqual({ v0: 'v0/', latest: '' })
    expect(versionDirs(three)).toEqual({ v0: 'v0/', v1: 'v1/', latest: '' })
    expect(versionDirs(undefined)).toEqual({ latest: '' })
    expect(versionDir('v7')).toBe('v7/')
  })
})
