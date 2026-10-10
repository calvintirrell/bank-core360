import { useEffect, useState } from 'react'
import { formatCell, registerParquet, runSql, type QueryResult } from './lib/duckdb'
import { DEFAULT_MODEL, DemoCapError, MODELS, PROXY_URL, fetchQuota, ping, routeLabel, type ModelId, type Quota } from './lib/anthropic'

type BuildInfo = { run_number: string; sha: string; built_at: string }

export default function App() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Bank Core 360</h1>
        <p className="text-slate-600">
          Two mismatched banking cores, one governed customer-360 lakehouse, queryable in plain
          English with lineage on every answer. Static, running on GitHub Pages.
        </p>
        <p className="text-xs uppercase tracking-wide text-amber-700">Phase 0: scaffold and spikes</p>
      </header>
      <DuckDbSpike />
      <AgentSpike />
      <Footer />
    </main>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  )
}

function DuckDbSpike() {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [result, setResult] = useState<QueryResult | null>(null)
  const [error, setError] = useState('')
  const [ms, setMs] = useState(0)

  useEffect(() => {
    const t0 = performance.now()
    ;(async () => {
      await registerParquet('customer_360.parquet', 'customer_360.parquet')
      const r = await runSql(
        "SELECT source_systems, count(*) AS customers, round(sum(loan_balance)) AS mortgage_balance FROM 'customer_360.parquet' WHERE has_mortgage AND checking_dormant_180d GROUP BY 1 ORDER BY 1",
      )
      setResult(r)
      setMs(Math.round(performance.now() - t0))
      setState('ok')
    })().catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    })
  }, [])

  return (
    <Card title="Spike A: DuckDB-WASM over the gold layer (customers with a mortgage and a checking account dormant 180 days)">
      {state === 'loading' && <p className="text-sm text-slate-500">Loading DuckDB-WASM and querying…</p>}
      {state === 'error' && <pre className="text-sm text-red-700 whitespace-pre-wrap">{error}</pre>}
      {state === 'ok' && result && (
        <>
          <ResultTable result={result} />
          <p className="text-xs text-slate-500">SQL ran in the browser in {ms} ms (includes engine load).</p>
        </>
      )}
    </Card>
  )
}

function ResultTable({ result }: { result: QueryResult }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-slate-600">
            {result.columns.map((c) => (
              <th key={c} className="py-1.5 pr-4 font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, i) => (
            <tr key={i} className="border-b border-slate-100">
              {result.columns.map((c) => (
                <td key={c} className="py-1.5 pr-4 font-mono tabular-nums">{formatCell(row[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** The own-key field is hidden by default; append ?byok to the URL to reveal it (or it shows
 *  automatically when a key is already stored in this tab's session). */
function byokRequested(): boolean {
  return new URLSearchParams(window.location.search).has('byok')
}

function AgentSpike() {
  const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('bc360.apiKey') ?? '')
  const showByok = byokRequested() || apiKey !== '' || !PROXY_URL
  const models = showByok ? MODELS : MODELS.filter((m) => m.proxy)
  const [model, setModel] = useState<ModelId>(DEFAULT_MODEL)
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState('')
  const [error, setError] = useState('')
  const [quota, setQuota] = useState<Quota | null>(null)
  const [capHit, setCapHit] = useState(false)

  useEffect(() => {
    fetchQuota().then(setQuota)
  }, [])

  const usingProxy = !apiKey && !!PROXY_URL
  const exhausted = usingProxy && (capHit || (quota !== null && quota.remaining_today <= 0))

  async function onPing() {
    setBusy(true)
    setReply('')
    setError('')
    try {
      sessionStorage.setItem('bc360.apiKey', apiKey)
      setReply(await ping(apiKey, model))
    } catch (e) {
      if (e instanceof DemoCapError) setCapHit(true)
      else setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (usingProxy) fetchQuota().then(setQuota)
    }
  }

  return (
    <Card title="Spike B: browser → Claude">
      <p className="text-sm text-slate-600">
        {PROXY_URL
          ? 'No key needed: requests go through a shared, rate-limited demo proxy.'
          : "Enter your own key. It is kept in this tab's session storage only and sent only to api.anthropic.com."}
        {showByok && PROXY_URL && ' Paste your own key to bypass it.'}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        {showByok && (
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={PROXY_URL ? 'optional: your own sk-ant-… key' : 'sk-ant-…'}
            className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-mono"
            autoComplete="off"
          />
        )}
        <select
          value={model}
          onChange={(e) => setModel(e.target.value as ModelId)}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
        <button
          onClick={onPing}
          disabled={busy || (!apiKey && !PROXY_URL) || exhausted}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          {busy ? 'Calling…' : 'Ping'}
        </button>
      </div>
      {usingProxy && quota && !exhausted && (
        <p className="text-xs text-slate-500">
          Shared demo: {quota.remaining_today} of {quota.cap_today} queries left today.
        </p>
      )}
      {exhausted && (
        <p role="alert" className="text-sm font-medium text-red-600">
          Daily demo limit reached ({quota?.cap_today ?? 4} queries per day). Try again tomorrow after midnight UTC
          {byokRequested() ? ', or enter your own key.' : '.'}
        </p>
      )}
      {reply && (
        <p className="text-sm">
          Model replied: <span className="font-mono">{reply}</span>{' '}
          <span className="text-slate-500">via {routeLabel(apiKey)}</span>
        </p>
      )}
      {error && <pre className="text-sm text-red-700 whitespace-pre-wrap">{error}</pre>}
    </Card>
  )
}

function Footer() {
  const [info, setInfo] = useState<BuildInfo | null>(null)
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/build_info.json`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo(null))
  }, [])
  return (
    <footer className="text-xs text-slate-500">
      {info ? `Built by GitHub Actions run #${info.run_number} from ${info.sha} at ${info.built_at}` : 'Build info unavailable'}
      {' · '}
      <a className="underline" href="https://github.com/calvintirrell/bank-core360">source</a>
    </footer>
  )
}
