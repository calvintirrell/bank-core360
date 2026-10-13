// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let engineResolve: () => void = () => {}
vi.mock('../lib/duckdb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/duckdb')>()),
  ready: vi.fn(() => new Promise<void>((resolve) => { engineResolve = resolve })),
  runSql: vi.fn(),
}))
vi.mock('../lib/lakehouse', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/lakehouse')>()),
  loadReplay: vi.fn(async () => ({ schema_version: 1, questions: [] })),
  loadAgentPrompt: vi.fn(async () => 'PROMPT'),
  loadAgentTool: vi.fn(async () => ({ name: 'run_sql', description: 'd', input_schema: {}, strict: true })),
}))
vi.mock('../lib/anthropic', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/anthropic')>()),
  PROXY_URL: 'https://proxy.test',
  fetchQuota: vi.fn(async () => null),
}))
vi.mock('../lib/agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/agent')>()),
  askLive: vi.fn(async () => ({ question: 'q', route: 'proxy', model: 'm', steps: [], explanation: 'Done.', calls: 1, usage: { input_tokens: 1, output_tokens: 1 }, stopReason: 'end_turn', pending: false, followUps: [] })),
}))

import { askLive } from '../lib/agent'
import { AsOfProvider } from '../lib/AsOfContext'
import { ModeProvider } from '../lib/ModeContext'
import { AgentPanel } from './AgentPanel'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const mount = () =>
  render(
    <ModeProvider>
      <AsOfProvider>
        <AgentPanel lineage={null} asOf="2026-10-31" latestAsOf="2026-10-31" />
      </AsOfProvider>
    </ModeProvider>,
  )

describe('AgentPanel Enter key', () => {
  it('does nothing while the query engine is still loading, then asks once it is ready', async () => {
    mount()
    const input = screen.getByPlaceholderText(/Ask anything/)
    fireEvent.change(input, { target: { value: 'How many customers?' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(askLive).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Loading engine…' })).toBeTruthy()
    engineResolve()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy())
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(askLive).toHaveBeenCalledTimes(1))
    expect((askLive as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('How many customers?')
    await waitFor(() => expect(screen.getByText('Done.')).toBeTruthy())
  })
})
