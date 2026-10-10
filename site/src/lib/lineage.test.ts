import { describe, expect, it } from 'vitest'
import { badgeText, lookupColumn, systemsOf, type Lineage } from './lineage'

const L: Lineage = {
  as_of: '2026-09-30',
  systems: { core_a: { label: 'A', conventions: '' }, core_b: { label: 'B', conventions: '' } },
  rules: { 'S-11': 'cents to dollars' },
  tables: {
    customer_360: {
      grain: 'customer',
      columns: {
        customer_key: { sources: [{ system: 'core_a', table: 'c', field: 'CIF_NO' }, { system: 'core_b', table: 'c', field: 'customer_id' }], transform: 'er', rules: [] },
        email: { sources: [{ system: 'core_b', table: 'c', field: 'email' }], transform: 'b only', rules: [] },
      },
    },
    account_360: {
      grain: 'account',
      columns: { balance: { sources: [{ system: 'core_a', table: 'a', field: 'CUR_BAL_CENTS' }], transform: 'dollars', rules: ['S-11'] } },
    },
    transactions: { grain: 'txn', columns: {} },
  },
}

describe('lineage lookups', () => {
  it('finds a column in the preferred table first, then falls through', () => {
    expect(lookupColumn(L, 'customer_key', 'account_360')?.table).toBe('customer_360')
    expect(lookupColumn(L, 'balance')?.table).toBe('account_360')
    expect(lookupColumn(L, 'count_star()')).toBeNull()
  })
  it('derives badge text from the contributing systems', () => {
    expect(badgeText(systemsOf(L.tables.customer_360.columns.customer_key))).toBe('A+B')
    expect(badgeText(systemsOf(L.tables.customer_360.columns.email))).toBe('B')
    expect(badgeText(systemsOf(L.tables.account_360.columns.balance))).toBe('A')
  })
})
