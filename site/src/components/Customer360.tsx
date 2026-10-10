import { useEffect, useState } from 'react'
import { formatCell, runSql, sqlString, type QueryResult } from '../lib/duckdb'
import type { Lineage } from '../lib/lineage'
import { LineageBadge } from './LineageBadge'
import { ResultTable } from './ResultTable'
import { Section } from './Section'

const PAGE = 25

const FILTERS: Array<{ label: string; where: string }> = [
  { label: 'All customers', where: 'TRUE' },
  { label: 'In both cores', where: "source_systems = 'core_a+core_b'" },
  { label: 'Fuzzy matches', where: 'match_tier = 2' },
  { label: 'Mortgage + dormant checking', where: 'has_mortgage AND checking_dormant_180d' },
  { label: 'Core A only', where: "source_systems = 'core_a'" },
  { label: 'Core B only', where: "source_systems = 'core_b'" },
]

const COLUMNS = [
  'customer_key', 'full_name', 'source_systems', 'match_tier', 'match_confidence', 'open_accounts',
  'has_checking', 'has_savings', 'has_mortgage', 'has_cd', 'deposit_balance', 'loan_balance',
  'checking_dormant_180d', 'customer_since', 'state',
] as const

const SYSTEM_BADGE: Record<string, string> = {
  core_a: 'bg-amber-100 text-amber-900',
  core_b: 'bg-sky-100 text-sky-900',
  'core_a+core_b': 'bg-violet-100 text-violet-900',
}

export function Customer360({ lineage }: { lineage: Lineage | null }) {
  const [filter, setFilter] = useState(0)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState<number | null>(null)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<QueryResult | null>(null)
  const [error, setError] = useState('')

  const where = `${FILTERS[filter].where}${search.trim() ? ` AND full_name ILIKE ${sqlString(`%${search.trim()}%`)}` : ''}`

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const count = await runSql(`SELECT count(*) AS n FROM customer_360 WHERE ${where}`)
        const r = await runSql(
          `SELECT ${COLUMNS.join(', ')} FROM customer_360 WHERE ${where} ORDER BY customer_key LIMIT ${PAGE} OFFSET ${page * PAGE}`,
        )
        if (cancelled) return
        setTotal(Number(count.rows[0].n))
        setResult(r)
        setError('')
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [where, page])

  useEffect(() => {
    if (!selected) {
      setAccounts(null)
      return
    }
    runSql(
      `SELECT source_system, product_type, source_account_id, balance, is_open, opened_on, last_txn_ts, txn_count_90d, is_dormant_180d
       FROM account_360 WHERE customer_key = ${sqlString(selected)} ORDER BY source_system, product_type`,
    ).then(setAccounts)
  }, [selected])

  const pages = total === null ? 0 : Math.ceil(total / PAGE)

  return (
    <Section id="customer360" title="Customer 360" subtitle="The table the answers come from: one row per real person, assembled from both cores. Click a row to see that customer's accounts across systems.">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {FILTERS.map((f, i) => (
          <button
            key={f.label}
            type="button"
            onClick={() => {
              setFilter(i)
              setPage(0)
              setSelected(null)
            }}
            className={`rounded-full border px-3 py-1 text-xs ${i === filter ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white hover:bg-slate-100'}`}
          >
            {f.label}
          </button>
        ))}
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(0)
          }}
          placeholder="search name…"
          className="ml-auto w-full rounded-md border border-slate-300 px-3 py-1 text-sm sm:w-48"
        />
      </div>
      {error && <pre className="mb-2 whitespace-pre-wrap rounded-md bg-red-50 p-3 text-xs text-red-700">{error}</pre>}
      {result ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs uppercase tracking-wide text-slate-600">
                {result.columns.map((c) => (
                  <th key={c.name} className="whitespace-nowrap px-3 py-2 font-medium">
                    {c.name.replace(/_/g, ' ')}
                    <LineageBadge column={c.name} lineage={lineage} table="customer_360" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => {
                const key = String(row.customer_key)
                const isSel = key === selected
                return (
                  <tr
                    key={key}
                    onClick={() => setSelected(isSel ? null : key)}
                    className={`cursor-pointer border-t border-slate-100 ${isSel ? 'bg-violet-50' : 'hover:bg-slate-50'}`}
                  >
                    {result.columns.map((c) => {
                      const v = row[c.name]
                      let cell: React.ReactNode = formatCell(v, c.kind)
                      if (c.name === 'source_systems') {
                        cell = <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${SYSTEM_BADGE[String(v)] ?? ''}`}>{String(v).replace('core_a+core_b', 'A + B').replace('core_a', 'A').replace('core_b', 'B')}</span>
                      } else if (c.kind === 'boolean') {
                        cell = v ? <span className={c.name === 'checking_dormant_180d' ? 'font-semibold text-red-600' : 'text-emerald-700'}>●</span> : <span className="text-slate-300">·</span>
                      }
                      return (
                        <td key={c.name} className={`whitespace-nowrap px-3 py-1.5 font-mono text-xs tabular-nums ${c.kind === 'number' || c.kind === 'integer' ? 'text-right' : ''}`}>
                          {cell}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Loading the gold layer into DuckDB-WASM…</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600">
        {total !== null && <span>{total.toLocaleString()} customers match</span>}
        {pages > 1 && (
          <span className="flex items-center gap-1">
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40">‹</button>
            page {page + 1} of {pages}
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40">›</button>
          </span>
        )}
      </div>
      {selected && accounts && (
        <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Accounts for {selected} across both cores</h3>
            <button type="button" onClick={() => setSelected(null)} className="text-xs text-slate-500 hover:text-slate-800">close</button>
          </div>
          <ResultTable result={accounts} lineage={lineage} table="account_360" />
        </div>
      )}
    </Section>
  )
}
