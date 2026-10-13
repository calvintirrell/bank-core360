// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDebounced } from './useDebounced'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useDebounced', () => {
  it('settles on the last value only after the quiet period', () => {
    const { result, rerender } = renderHook(({ v }) => useDebounced(v, 250), { initialProps: { v: 'a' } })
    expect(result.current).toBe('a')
    rerender({ v: 'ab' })
    rerender({ v: 'abc' })
    act(() => vi.advanceTimersByTime(200))
    expect(result.current).toBe('a')
    act(() => vi.advanceTimersByTime(60))
    expect(result.current).toBe('abc')
  })
})
