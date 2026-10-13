// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const person = { customer_key: 'C1', full_name: 'Ada Lovelace', source_systems: 'core_a', match_tier: null, match_confidence: null, open_accounts: 1, has_checking: true, has_savings: false, has_mortgage: false, has_cd: false, deposit_balance: 10, loan_balance: 0, checking_dormant_180d: true, customer_since: new Date('2020-01-01'), state: 'KY', city: 'X', checking_last_txn_ts: null, dormant_checking_last_txn_ts: null }
const cols = Object.keys(person).map((name) => ({ name, kind: typeof person[name as keyof typeof person] === 'boolean' ? ('boolean' as const) : ('text' as const) }))
vi.mock('../lib/duckdb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/duckdb')>()),
  runSql: vi.fn(async (sql: string) => {
    if (/FROM account_360/.test(sql)) return { columns: [{ name: 'product_type', kind: 'text' as const }], rows: [{ product_type: 'checking' }], ms: 1 }
    return { columns: [...cols, { name: '_total', kind: 'integer' as const }], rows: [{ ...person, _total: 1 }], ms: 1 }
  }),
}))

import { runSql } from '../lib/duckdb'
import { AsOfProvider } from '../lib/AsOfContext'
import { ModeProvider } from '../lib/ModeContext'
import { MODE_KEY } from '../lib/mode'
import { Customer360 } from './Customer360'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Customer 360 table (technical view)', () => {
  it('rows open with the keyboard, inputs are labelled, and booleans have text alternatives', async () => {
    localStorage.setItem(MODE_KEY, 'tech')
    render(
      <ModeProvider>
        <AsOfProvider>
          <Customer360 lineage={null} />
        </AsOfProvider>
      </ModeProvider>,
    )
    const row = await screen.findByRole('row', { name: /Ada Lovelace: show accounts/ })
    expect(row.getAttribute('tabindex')).toBe('0')
    expect(screen.getByLabelText('Search customers by name')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'yes, a checking account is quiet' })).toBeTruthy()
    fireEvent.keyDown(row, { key: 'Enter' })
    await waitFor(() => expect((runSql as ReturnType<typeof vi.fn>).mock.calls.some(([sql]) => /FROM account_360 WHERE customer_key = 'C1'/.test(String(sql)))).toBe(true))
    expect(screen.getByRole('row', { name: /Ada Lovelace: hide accounts/ })).toBeTruthy()
  })

  it('sorts by a clicked header, toggling direction, and announces it', async () => {
    localStorage.setItem(MODE_KEY, 'tech')
    render(
      <ModeProvider>
        <AsOfProvider>
          <Customer360 lineage={null} />
        </AsOfProvider>
      </ModeProvider>,
    )
    const header = await screen.findByRole('button', { name: /deposit balance/i })
    fireEvent.click(header)
    await waitFor(() => expect((runSql as ReturnType<typeof vi.fn>).mock.calls.some(([sql]) => /ORDER BY deposit_balance ASC NULLS LAST, customer_key/.test(String(sql)))).toBe(true))
    expect(header.closest('th')!.getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(header)
    await waitFor(() => expect((runSql as ReturnType<typeof vi.fn>).mock.calls.some(([sql]) => /ORDER BY deposit_balance DESC NULLS LAST/.test(String(sql)))).toBe(true))
    expect(header.closest('th')!.getAttribute('aria-sort')).toBe('descending')
  })
})
