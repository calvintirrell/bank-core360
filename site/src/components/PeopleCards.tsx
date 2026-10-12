import { useEffect, useState } from 'react'
import { formatCell, runSql, sqlString, type QueryResult } from '../lib/duckdb'
import { Term } from './Term'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const dateFmt = (v: unknown) => (v ? formatCell(v, 'date') : '')
const monthYear = (v: unknown) => {
  const d = v instanceof Date ? v : typeof v === 'number' ? new Date(v) : null
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : ''
}

const BANK = { core_a: 'Harbor Bank', core_b: 'Riverside Bank', 'core_a+core_b': 'Both banks' } as Record<string, string>
const PRODUCT = { checking: 'checking', savings: 'savings', mortgage: 'mortgage', cd: 'CD' } as Record<string, string>

function products(r: Record<string, unknown>): string {
  const list = [r.has_checking && 'checking', r.has_savings && 'savings', r.has_mortgage && 'a mortgage', r.has_cd && 'a CD'].filter(Boolean) as string[]
  if (list.length === 0) return 'No open accounts'
  if (list.length === 1) return `Has ${list[0]}`
  return `Has ${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`
}

function matchText(r: Record<string, unknown>): string | null {
  if (r.source_systems !== 'core_a+core_b') return null
  if (Number(r.match_tier) === 1) return 'Matched exactly across both banks'
  const c = Number(r.match_confidence)
  return `Matched by similarity, ${Math.round(c * 100)}% confident`
}

/** Bank-mode rendering of a page of customer_360 rows: one card per person, facts in words. */
export function PeopleCards({ rows }: { rows: Record<string, unknown>[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<QueryResult | null>(null)
  useEffect(() => {
    if (!selected) return setAccounts(null)
    runSql(
      `SELECT source_system, product_type, balance, is_open, opened_on, last_txn_ts, days_since_last_txn, is_dormant_180d
       FROM account_360 WHERE customer_key = ${sqlString(selected)} ORDER BY is_open DESC, source_system, product_type`,
    ).then(setAccounts)
  }, [selected])

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r) => {
        const key = String(r.customer_key)
        const open = key === selected
        const where = String(r.source_systems)
        const dormant = Boolean(r.checking_dormant_180d)
        const match = matchText(r)
        return (
          <div key={key} className={`rounded-xl border bg-white p-3 shadow-sm ${open ? 'border-violet-300 lg:col-span-3 sm:col-span-2' : 'border-slate-200'}`}>
            <button type="button" onClick={() => setSelected(open ? null : key)} className="w-full text-left">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{String(r.full_name)}</div>
                  <div className="text-xs text-slate-500">
                    {String(r.city ?? '')}{r.state ? `, ${String(r.state)}` : ''} · customer since {monthYear(r.customer_since)}
                  </div>
                </div>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${where === 'core_a+core_b' ? 'bg-violet-100 text-violet-900' : where === 'core_a' ? 'bg-amber-100 text-amber-900' : 'bg-sky-100 text-sky-900'}`}>
                  {BANK[where] ?? where}
                </span>
              </div>
              <ul className="mt-2 space-y-0.5 text-sm text-slate-700">
                <li>{products(r)}</li>
                <li>
                  Deposits {money.format(Number(r.deposit_balance ?? 0))}
                  {Number(r.loan_balance) > 0 ? ` · owes ${money.format(Number(r.loan_balance))}` : ''}
                </li>
                {dormant && (
                  <li className="font-medium text-red-700">
                    A checking account has been <Term k="dormant">quiet for 6+ months</Term>
                    {r.dormant_checking_last_txn_ts ? ` (last used ${dateFmt(r.dormant_checking_last_txn_ts)})` : ''}
                    {r.dormant_checking_last_txn_ts && r.checking_last_txn_ts && String(r.checking_last_txn_ts) !== String(r.dormant_checking_last_txn_ts)
                      ? `; another checking account was used ${dateFmt(r.checking_last_txn_ts)}`
                      : ''}
                  </li>
                )}
                {match && <li className="text-slate-500">{match}</li>}
              </ul>
              <div className="mt-2 text-xs text-slate-500">{open ? 'Hide accounts' : 'Show accounts'}</div>
            </button>
            {open && accounts && (
              <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 text-sm">
                {accounts.rows.map((a, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 py-1.5">
                    <span>
                      <span className="font-medium capitalize">{PRODUCT[String(a.product_type)] ?? String(a.product_type)}</span>
                      <span className="text-slate-500"> at {BANK[String(a.source_system)]}</span>
                      {!a.is_open && <span className="ml-2 rounded bg-slate-100 px-1 text-[11px] text-slate-600">closed</span>}
                      {Boolean(a.is_dormant_180d) && <span className="ml-2 rounded bg-red-50 px-1 text-[11px] text-red-700">quiet 6+ months</span>}
                    </span>
                    <span className="tabular-nums text-slate-700">
                      {money.format(Number(a.balance))}
                      <span className="text-xs text-slate-500">{a.last_txn_ts ? ` · last used ${dateFmt(a.last_txn_ts)}` : ' · no activity on file'}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
