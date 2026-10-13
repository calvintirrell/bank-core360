import { WhyItMatters } from './WhyItMatters'
import { useEffect, useState } from 'react'
import { runSql, type QueryResult } from '../lib/duckdb'
import type { Lineage } from '../lib/lineage'
import { assertReadOnly, EXAMPLES } from '../lib/sql'
import { ResultTable } from './ResultTable'
import { Section } from './Section'

export function SqlConsole({ lineage, embedded }: { lineage: Lineage | null; embedded?: boolean }) {
  const [sql, setSql] = useState(EXAMPLES[0].sql)
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(q = sql) {
    setBusy(true)
    setError('')
    try {
      setResult(await runSql(assertReadOnly(q)))
    } catch (e) {
      setResult(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    run(EXAMPLES[0].sql)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Section id="sql" embedded={embedded} title="SQL console" subtitle="Real SQL over the gold layer, executed in your browser by DuckDB-WASM. Nothing leaves the page.">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((e) => (
          <button
            key={e.label}
            type="button"
            onClick={() => {
              setSql(e.sql)
              run(e.sql)
            }}
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-100"
          >
            {e.label}
          </button>
        ))}
      </div>
      <textarea
        aria-label="SQL query"
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run()
        }}
        spellCheck={false}
        rows={7}
        className="w-full rounded-lg border border-slate-300 bg-slate-950 p-3 font-mono text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => run()}
          disabled={busy}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Running…' : 'Run (⌘↵)'}
        </button>
        {result && (
          <span className="text-xs text-slate-500">
            {result.rows.length.toLocaleString()} row{result.rows.length === 1 ? '' : 's'} in {result.ms} ms. Tables: customer_360, account_360, transactions, review_queue (selected as-of); add _v0 or _latest for a fixed version.
          </span>
        )}
      </div>
      {error && <pre className="mt-2 whitespace-pre-wrap rounded-md bg-red-50 p-3 text-xs text-red-700">{error}</pre>}
      {result && (
        <div className="mt-3">
          <ResultTable result={result} lineage={lineage} />
          <p className="mt-1 text-xs text-slate-500">
            Badges on each column show which core the value came from: <b>A</b> legacy core, <b>B</b> acquired bank, <b>A+B</b> both. Click one for the field and transform rule.
          </p>
        </div>
      )}
      <WhyItMatters id="sql" />
    </Section>
  )
}
