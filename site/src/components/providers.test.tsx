// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AsOfProvider, useAsOf } from '../lib/AsOfContext'
import { MODE_KEY } from '../lib/mode'
import { ModeProvider, useBankMode } from '../lib/ModeContext'
import { ModeToggle } from './ModeToggle'

afterEach(cleanup)
beforeEach(() => localStorage.clear())

function Probe() {
  const bank = useBankMode()
  const { version } = useAsOf()
  return <div data-testid="probe">{bank ? 'bank' : 'tech'}:{version}</div>
}

describe('ModeProvider + ModeToggle', () => {
  it('starts in bank mode, switches on click, and remembers the choice', () => {
    render(
      <ModeProvider>
        <ModeToggle />
        <Probe />
      </ModeProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toMatch(/^bank/)
    expect(screen.getByRole('button', { name: 'I run the bank' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'I build the data' }))
    expect(screen.getByTestId('probe').textContent).toMatch(/^tech/)
    expect(screen.getByRole('button', { name: 'I build the data' }).getAttribute('aria-pressed')).toBe('true')
    expect(localStorage.getItem(MODE_KEY)).toBe('tech')
  })
  it('restores a stored choice on the next visit', () => {
    localStorage.setItem(MODE_KEY, 'tech')
    render(
      <ModeProvider>
        <Probe />
      </ModeProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toMatch(/^tech/)
  })
})

describe('AsOfProvider', () => {
  it('reads ?asof=v0 from the URL and defaults to latest', () => {
    window.history.replaceState({}, '', '/?asof=v0')
    render(
      <ModeProvider>
        <AsOfProvider>
          <Probe />
        </AsOfProvider>
      </ModeProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toMatch(/:v0$/)
    cleanup()
    window.history.replaceState({}, '', '/?asof=junk')
    render(
      <ModeProvider>
        <AsOfProvider>
          <Probe />
        </AsOfProvider>
      </ModeProvider>,
    )
    expect(screen.getByTestId('probe').textContent).toMatch(/:latest$/)
  })
})
