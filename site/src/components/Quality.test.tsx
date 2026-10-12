// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AsOfProvider } from '../lib/AsOfContext'
import { ModeProvider } from '../lib/ModeContext'
import { QualityPanel } from './Quality'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const mount = () =>
  render(
    <ModeProvider>
      <AsOfProvider>
        <QualityPanel />
      </AsOfProvider>
    </ModeProvider>,
  )

describe('QualityPanel', () => {
  it('renders every check with its plain sentence when the file loads', async () => {
    const q = { as_of: '2026-10-31', passed: true, checks: [{ id: 'Q-01', title: 'Balances add up', plain: 'To the cent.', sql: 'SELECT 1', value: 0, expected: 0, passed: true }] }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(q), { status: 200 })))
    mount()
    await waitFor(() => expect(screen.getByText('Balances add up')).toBeTruthy())
    expect(screen.getByText(/1 of 1 checks passed/)).toBeTruthy()
    expect(screen.getByText('To the cent.')).toBeTruthy()
  })
  it('says so, in place, when the file is missing instead of disappearing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    mount()
    await waitFor(() => expect(screen.getByText(/could not be loaded \(quality.json: HTTP 404\)/)).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'Can these numbers be trusted?' })).toBeTruthy()
  })
})
